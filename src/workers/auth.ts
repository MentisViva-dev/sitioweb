/**
 * Auth Worker
 *
 * Endpoints:
 *   POST /api/auth/register
 *   POST /api/auth/login
 *   POST /api/auth/logout
 *   POST /api/auth/logout-all
 *   POST /api/auth/verify
 *   POST /api/auth/resend-verification
 *   POST /api/auth/forgot-password
 *   POST /api/auth/get-reset-question
 *   POST /api/auth/reset-password
 *   POST /api/auth/change-password
 *   POST /api/auth/change-email/request
 *   POST /api/auth/change-email/confirm
 *   POST /api/auth/change-security
 *   GET  /api/auth/check
 *
 * Resuelve hallazgos auditoría: timing attacks, enumeration, rate limits,
 * password policy, single-use tokens, all-session logout, etc.
 */

import type { Env, ExecutionContext } from '../types/env';
import type { DbUser } from '../types/db';
import { jsonOk, jsonError, Errors, readBody } from '../lib/responses';
import { dbFetch, dbInsert, dbExec } from '../lib/db';
import {
  hashPassword, verifyPassword, randomToken, sha256, jitter,
  DUMMY_PASSWORD_HASH, constantTimeEqual,
} from '../lib/crypto';
import {
  validateEmail, validatePassword, validateName, validateRUT,
  validatePhoneCL, validateAddress, validatePostalCode, validateLatLng,
  validateSecurityQuestion, validateSecurityAnswer,
} from '../lib/validators';
import { rateLimitByIp, rateLimitByEmail, rateLimitLogin, RATE_LIMITS, rateLimitByUser } from '../lib/rate-limit';
import {
  issueUserToken, makeAuthCookie, makeLogoutCookie, readCookie,
  verifyToken, revokeToken, revokeAllUserSessions, getSession, getClientIp,
} from '../lib/auth';
import { auditLog, AuditEvents } from '../lib/audit';
import { verifyRecaptcha } from '../lib/recaptcha';
import { sendVerificationEmail, sendPasswordResetEmail, queueEmail, buildEmailLayout, sendAdminNotification } from '../lib/email';
import { addDays, nowISO } from '../lib/dates';

export async function handle(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method !== 'POST' && path !== '/api/auth/check') {
    return Errors.methodNotAllowed();
  }

  switch (path) {
    case '/api/auth/register':                return handleRegister(req, env, ctx);
    case '/api/auth/login':                   return handleLogin(req, env, ctx);
    case '/api/auth/logout':                  return handleLogout(req, env);
    case '/api/auth/logout-all':              return handleLogoutAll(req, env);
    case '/api/auth/verify':                  return handleVerify(req, env, ctx);
    case '/api/auth/resend-verification':     return handleResendVerification(req, env, ctx);
    case '/api/auth/forgot-password':         return handleForgotPassword(req, env, ctx);
    case '/api/auth/get-reset-question':      return handleGetResetQuestion(req, env);
    case '/api/auth/reset-password':          return handleResetPassword(req, env, ctx);
    case '/api/auth/change-password':         return handleChangePassword(req, env, ctx);
    case '/api/auth/change-email/request':    return handleChangeEmailRequest(req, env, ctx);
    case '/api/auth/change-email/confirm':    return handleChangeEmailConfirm(req, env, ctx);
    case '/api/auth/change-security':         return handleChangeSecurity(req, env, ctx);
    case '/api/auth/check':                   return handleCheck(req, env);
    default:                                  return Errors.notFound();
  }
}

// =====================================================================
// REGISTER
// =====================================================================

async function handleRegister(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  // Rate limit por IP: 3 / 15min
  const rateIp = await rateLimitByIp(env, req, 'register', RATE_LIMITS.REGISTER.max, RATE_LIMITS.REGISTER.window);
  if (!rateIp.allowed) return Errors.rateLimited(Math.ceil((rateIp.resetAt - Date.now() / 1000)));

  const body = await readBody(req);

  // reCAPTCHA
  const captchaToken = String(body['recaptcha_token'] ?? '');
  const captcha = await verifyRecaptcha(env, captchaToken, 'register', getClientIp(req));
  if (!captcha.ok) {
    await auditLog(env, { event_type: 'auth.register.captcha_failed', actor_type: 'user', request: req, details: { reason: captcha.reason } });
    return Errors.forbidden();
  }

  // Validaciones
  const emailV = validateEmail(body['email']);
  if (!emailV.ok) return Errors.validation(emailV.error);
  const passV = validatePassword(body['password']);
  if (!passV.ok) return Errors.validation(passV.error);
  const nameV = validateName(body['nombre'], 'Nombre');
  if (!nameV.ok) return Errors.validation(nameV.error);
  const lastV = validateName(body['apellido'], 'Apellido');
  if (!lastV.ok) return Errors.validation(lastV.error);
  const sqV = validateSecurityQuestion(body['security_question']);
  if (!sqV.ok) return Errors.validation(sqV.error);
  const saV = validateSecurityAnswer(body['security_answer']);
  if (!saV.ok) return Errors.validation(saV.error);

  // Términos y privacidad obligatorios
  if (body['terms_accepted'] !== '1' && body['terms_accepted'] !== 'true') {
    return Errors.validation('Debes aceptar los términos y condiciones');
  }

  // Validaciones opcionales
  let rutCanon: string | null = null;
  if (body['rut'] && body['rut'] !== '') {
    const v = validateRUT(body['rut']);
    if (!v.ok) return Errors.validation(v.error);
    rutCanon = v.value;
  }
  let phoneCanon: string | null = null;
  if (body['telefono'] && body['telefono'] !== '') {
    const v = validatePhoneCL(body['telefono']);
    if (!v.ok) return Errors.validation(v.error);
    phoneCanon = v.value;
  }

  // Email enumeration mitigation: comportamiento idéntico para email existente y no
  const existing = await dbFetch<{ id: number; email_verified: number }>(
    env.DB,
    'SELECT id, email_verified FROM mv_users WHERE email = ?',
    [emailV.value],
  );

  if (existing) {
    if (!existing.email_verified) {
      // Reenviar verificación silenciosamente
      const token = randomToken(32);
      const expires = addDays(new Date(), 2).toISOString();
      await dbExec(
        env.DB,
        'UPDATE mv_users SET verify_token = ?, verify_token_expires = ? WHERE id = ?',
        [token, expires, existing.id],
      );
      await sendVerificationEmail(env, emailV.value, nameV.value, token);
    }
    // Mismo mensaje genérico
    await jitter();
    return jsonOk({ verify: true, message: 'Si el email está disponible, recibirás un enlace de verificación.' });
  }

  // Crear usuario
  const passwordHash = await hashPassword(passV.value);
  const securityAnswerHash = await sha256(saV.value);
  const verifyTok = randomToken(32);
  const verifyExp = addDays(new Date(), 2).toISOString();

  let lat: number | null = null;
  let lng: number | null = null;
  if (body['lat'] != null && body['lng'] != null && body['lat'] !== '' && body['lng'] !== '') {
    const ll = validateLatLng(body['lat'], body['lng']);
    if (ll.ok) { lat = ll.value.lat; lng = ll.value.lng; }
  }

  const userId = await dbInsert(
    env.DB,
    `INSERT INTO mv_users (
      email, password_hash, email_verified, verify_token, verify_token_expires,
      nombre, apellido, rut, telefono,
      direccion, numero, depto, comuna, ciudad, region, codigo_postal, lat, lng,
      security_question, security_answer,
      terms_accepted_version, terms_accepted_at,
      marketing_opt_in, marketing_opt_in_at
    ) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      emailV.value, passwordHash, verifyTok, verifyExp,
      nameV.value, lastV.value, rutCanon, phoneCanon,
      String(body['direccion'] ?? '') || null,
      String(body['numero'] ?? '') || null,
      String(body['depto'] ?? '') || null,
      String(body['comuna'] ?? '') || null,
      String(body['ciudad'] ?? '') || null,
      String(body['region'] ?? '') || null,
      String(body['codigo_postal'] ?? '') || null,
      lat, lng,
      sqV.value, securityAnswerHash,
      env.TERMS_VERSION, nowISO(),
      body['marketing_opt_in'] === '1' ? 1 : 0,
      body['marketing_opt_in'] === '1' ? nowISO() : null,
    ],
  );

  // Enviar verificación
  await sendVerificationEmail(env, emailV.value, nameV.value, verifyTok);

  // Notificar admin
  await sendAdminNotification(
    env,
    `Nuevo registro: ${nameV.value} ${lastV.value}`,
    `<p><strong>Email:</strong> ${emailV.value}</p><p><strong>RUT:</strong> ${rutCanon ?? 'sin'}</p>`,
    '👋',
  );

  await auditLog(env, {
    event_type: AuditEvents.REGISTER,
    actor_type: 'user',
    target_user_id: userId,
    request: req,
    details: { email: emailV.value },
  });

  await jitter();
  return jsonOk({ verify: true, message: 'Si el email está disponible, recibirás un enlace de verificación.' });
}

// =====================================================================
// LOGIN
// =====================================================================

async function handleLogin(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const body = await readBody(req);
  const emailRaw = String(body['email'] ?? '').trim().toLowerCase();
  const passRaw = String(body['password'] ?? '');

  // Rate limit ANTES de tocar BD
  const rl = await rateLimitLogin(env, req, emailRaw);
  if (!rl.allowed) {
    await auditLog(env, { event_type: AuditEvents.LOGIN_RATE_LIMITED, actor_type: 'user', request: req, details: { email: emailRaw } });
    return Errors.rateLimited(Math.ceil(rl.resetAt - Date.now() / 1000));
  }

  // Validaciones básicas (no muy estrictas, no queremos enumerar)
  if (!emailRaw || !passRaw) {
    await jitter();
    return Errors.validation('Email y contraseña son requeridos');
  }

  // Buscar usuario
  const user = await dbFetch<DbUser>(
    env.DB,
    'SELECT id, email, password_hash, nombre, apellido, email_verified, plan_status FROM mv_users WHERE email = ?',
    [emailRaw],
  );

  // Timing-safe verify (siempre ejecuta verifyPassword, aunque user no exista)
  const hashToCheck = user?.password_hash ?? DUMMY_PASSWORD_HASH;
  const passOk = await verifyPassword(passRaw, hashToCheck);

  if (!user || !passOk) {
    await jitter();
    await auditLog(env, { event_type: AuditEvents.LOGIN_FAILED, actor_type: 'user', request: req, details: { email: emailRaw } });
    return jsonError('Email o contraseña incorrectos.', 401, { code: 'INVALID_CREDENTIALS' });
  }

  if (!user.email_verified) {
    await auditLog(env, { event_type: AuditEvents.LOGIN_FAILED, actor_type: 'user', target_user_id: user.id, request: req, details: { reason: 'unverified' } });
    return jsonError('Verifica tu email primero.', 401, { code: 'EMAIL_NOT_VERIFIED' });
  }

  // Emitir token + cookie
  const token = await issueUserToken(env, user.id);
  await auditLog(env, { event_type: AuditEvents.LOGIN_SUCCESS, actor_type: 'user', actor_id: user.id, target_user_id: user.id, request: req });

  return jsonOk(
    {
      user: {
        id: user.id,
        email: user.email,
        nombre: user.nombre,
        apellido: user.apellido,
        plan_status: user.plan_status,
      },
    },
    200,
    { 'Set-Cookie': makeAuthCookie(token, env) },
  );
}

// =====================================================================
// LOGOUT
// =====================================================================

async function handleLogout(req: Request, env: Env): Promise<Response> {
  const token = readCookie(req, 'mv_auth');
  if (token) {
    await revokeToken(env, token);
    const result = await verifyToken(env, token);
    if (result.user_id) {
      await auditLog(env, { event_type: AuditEvents.LOGOUT, actor_type: 'user', actor_id: result.user_id, request: req });
    }
  }
  return jsonOk({ message: 'Sesión cerrada' }, 200, { 'Set-Cookie': makeLogoutCookie(env) });
}

async function handleLogoutAll(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session) return Errors.unauthorized();
  await revokeAllUserSessions(env, session.user_id, session.is_admin ? 'admin' : 'user');
  await auditLog(env, { event_type: AuditEvents.LOGOUT_ALL, actor_type: 'user', actor_id: session.user_id, request: req });
  return jsonOk({ message: 'Todas las sesiones fueron cerradas' }, 200, { 'Set-Cookie': makeLogoutCookie(env) });
}

// =====================================================================
// VERIFY EMAIL
// =====================================================================

async function handleVerify(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const body = await readBody(req);
  const token = String(body['token'] ?? '');
  if (!token) return Errors.validation('Token requerido');

  const user = await dbFetch<{ id: number; email: string; nombre: string }>(
    env.DB,
    'SELECT id, email, nombre FROM mv_users WHERE verify_token = ? AND verify_token_expires > ?',
    [token, nowISO()],
  );

  if (!user) return jsonError('Enlace inválido o expirado.', 400, { code: 'INVALID_TOKEN' });

  // Marcar verificado + invalidar token (single-use)
  await dbExec(
    env.DB,
    'UPDATE mv_users SET email_verified = 1, verify_token = NULL, verify_token_expires = NULL WHERE id = ?',
    [user.id],
  );

  // Emitir sesión post-verificación
  const sessionToken = await issueUserToken(env, user.id);
  await auditLog(env, { event_type: AuditEvents.EMAIL_VERIFIED, actor_type: 'user', actor_id: user.id, request: req });

  return jsonOk(
    { message: 'Cuenta verificada', user: { id: user.id, email: user.email, nombre: user.nombre } },
    200,
    { 'Set-Cookie': makeAuthCookie(sessionToken, env) },
  );
}

async function handleResendVerification(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const body = await readBody(req);
  const emailV = validateEmail(body['email']);
  if (!emailV.ok) return Errors.validation(emailV.error);

  const rl = await rateLimitByEmail(env, emailV.value, 'resend_verification', RATE_LIMITS.RESEND_VERIFICATION.max, RATE_LIMITS.RESEND_VERIFICATION.window);
  if (!rl.allowed) return Errors.rateLimited(Math.ceil(rl.resetAt - Date.now() / 1000));

  const user = await dbFetch<{ id: number; nombre: string; email_verified: number }>(
    env.DB,
    'SELECT id, nombre, email_verified FROM mv_users WHERE email = ?',
    [emailV.value],
  );

  // No revelar si existe o no
  if (user && !user.email_verified) {
    const token = randomToken(32);
    const expires = addDays(new Date(), 2).toISOString();
    await dbExec(
      env.DB,
      'UPDATE mv_users SET verify_token = ?, verify_token_expires = ? WHERE id = ?',
      [token, expires, user.id],
    );
    await sendVerificationEmail(env, emailV.value, user.nombre, token);
  }
  await jitter();
  return jsonOk({ message: 'Si tu email existe y no está verificado, recibirás un enlace.' });
}

// =====================================================================
// FORGOT PASSWORD
// =====================================================================

async function handleForgotPassword(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const body = await readBody(req);
  const emailV = validateEmail(body['email']);
  if (!emailV.ok) {
    await jitter();
    return jsonOk({ message: 'Si el email existe, recibirás un enlace.' });
  }

  // Rate limit
  const rl = await rateLimitByEmail(env, emailV.value, 'forgot_password', RATE_LIMITS.FORGOT_PASSWORD.max, RATE_LIMITS.FORGOT_PASSWORD.window);
  if (!rl.allowed) return Errors.rateLimited(Math.ceil(rl.resetAt - Date.now() / 1000));

  // reCAPTCHA
  const captcha = await verifyRecaptcha(env, String(body['recaptcha_token'] ?? ''), 'forgot_password', getClientIp(req));
  if (!captcha.ok) return Errors.forbidden();

  const user = await dbFetch<{ id: number; nombre: string }>(
    env.DB,
    'SELECT id, nombre FROM mv_users WHERE email = ?',
    [emailV.value],
  );

  if (user) {
    const token = randomToken(32);
    const expires4h = new Date(Date.now() + 4 * 3600 * 1000).toISOString();
    await dbExec(
      env.DB,
      'UPDATE mv_users SET reset_token = ?, reset_token_expires = ? WHERE id = ?',
      [token, expires4h, user.id],
    );
    await sendPasswordResetEmail(env, emailV.value, user.nombre, token);
    await auditLog(env, { event_type: AuditEvents.PASSWORD_RESET_REQ, actor_type: 'user', target_user_id: user.id, request: req });
  }
  await jitter();
  return jsonOk({ message: 'Si el email existe, recibirás un enlace.' });
}

async function handleGetResetQuestion(req: Request, env: Env): Promise<Response> {
  const body = await readBody(req);
  const token = String(body['token'] ?? '');
  if (!token) return Errors.validation('Token requerido');
  const user = await dbFetch<{ security_question: string }>(
    env.DB,
    'SELECT security_question FROM mv_users WHERE reset_token = ? AND reset_token_expires > ?',
    [token, nowISO()],
  );
  if (!user) return jsonError('Enlace inválido o expirado.', 400, { code: 'INVALID_TOKEN' });
  return jsonOk({ question: user.security_question ?? '' });
}

async function handleResetPassword(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const body = await readBody(req);
  const token = String(body['token'] ?? '');
  const answerRaw = String(body['security_answer'] ?? '').trim().toLowerCase();
  const newPass = String(body['new_password'] ?? '');

  if (!token || !answerRaw || !newPass) {
    return Errors.validation('Datos incompletos');
  }
  const passV = validatePassword(newPass);
  if (!passV.ok) return Errors.validation(passV.error);

  const user = await dbFetch<{ id: number; security_answer: string; email: string; nombre: string }>(
    env.DB,
    'SELECT id, security_answer, email, nombre FROM mv_users WHERE reset_token = ? AND reset_token_expires > ?',
    [token, nowISO()],
  );
  if (!user) return jsonError('Enlace inválido o expirado.', 400, { code: 'INVALID_TOKEN' });

  // Verificar respuesta de seguridad (hash comparison, timing-safe)
  const answerHash = await sha256(answerRaw);
  if (!constantTimeEqual(answerHash, user.security_answer)) {
    // Tracking attempts
    const today = new Date().toISOString().slice(0, 10);
    const row = await dbFetch<{ attempts: number }>(
      env.DB,
      'SELECT attempts FROM mv_reset_attempts WHERE user_id = ? AND attempt_date = ?',
      [user.id, today],
    );
    const attempts = (row?.attempts ?? 0) + 1;
    await dbExec(
      env.DB,
      `INSERT INTO mv_reset_attempts (user_id, attempt_date, attempts, last_attempt_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, attempt_date) DO UPDATE SET attempts = ?, last_attempt_at = ?`,
      [user.id, today, attempts, nowISO(), attempts, nowISO()],
    );
    return jsonError('Respuesta de seguridad incorrecta.', 400, { code: 'WRONG_ANSWER', details: { remaining: Math.max(0, 3 - attempts) } });
  }

  // Cambiar password + invalidar reset_token (single-use) + invalidar todas las sesiones
  const newHash = await hashPassword(passV.value);
  await dbExec(
    env.DB,
    `UPDATE mv_users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL,
      previous_password_hash = password_hash, password_changed_at = ? WHERE id = ?`,
    [newHash, nowISO(), user.id],
  );
  await revokeAllUserSessions(env, user.id, 'user');

  await queueEmail(env, {
    to: user.email,
    subject: 'Tu contraseña fue cambiada - Mentis Viva',
    html: buildEmailLayout(
      'Contraseña actualizada',
      `<p>Hola ${user.nombre},</p><p>Tu contraseña fue cambiada exitosamente. Si no fuiste tú, contacta a contacto@mentisviva.cl inmediatamente.</p>`,
    ),
  });
  await auditLog(env, { event_type: AuditEvents.PASSWORD_RESET_DONE, actor_type: 'user', actor_id: user.id, request: req });
  return jsonOk({ message: 'Contraseña actualizada. Inicia sesión con tu nueva contraseña.' });
}

// =====================================================================
// CHANGE PASSWORD (logueado)
// =====================================================================

async function handleChangePassword(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const session = await getSession(req, env);
  if (!session) return Errors.unauthorized();

  const rl = await rateLimitByUser(env, session.user_id, 'change_password', RATE_LIMITS.CHANGE_PASSWORD.max, RATE_LIMITS.CHANGE_PASSWORD.window);
  if (!rl.allowed) return Errors.rateLimited(Math.ceil(rl.resetAt - Date.now() / 1000));

  const body = await readBody(req);
  const current = String(body['current_password'] ?? '');
  const newPass = String(body['new_password'] ?? '');
  if (!current || !newPass) return Errors.validation('Datos incompletos');
  const passV = validatePassword(newPass);
  if (!passV.ok) return Errors.validation(passV.error);

  const user = await dbFetch<{ id: number; password_hash: string; email: string; nombre: string }>(
    env.DB,
    'SELECT id, password_hash, email, nombre FROM mv_users WHERE id = ?',
    [session.user_id],
  );
  if (!user) return Errors.unauthorized();

  const ok = await verifyPassword(current, user.password_hash);
  if (!ok) {
    await auditLog(env, { event_type: 'auth.change_password.wrong_current', actor_type: 'user', actor_id: user.id, request: req });
    return jsonError('Contraseña actual incorrecta.', 400, { code: 'WRONG_PASSWORD' });
  }

  const newHash = await hashPassword(passV.value);
  await dbExec(
    env.DB,
    `UPDATE mv_users SET password_hash = ?, previous_password_hash = ?, password_changed_at = ?,
      reset_token = NULL, reset_token_expires = NULL WHERE id = ?`,
    [newHash, user.password_hash, nowISO(), user.id],
  );
  // Invalidar TODAS las sesiones, incluyendo la actual
  await revokeAllUserSessions(env, user.id, 'user');

  await queueEmail(env, {
    to: user.email,
    subject: 'Tu contraseña fue cambiada - Mentis Viva',
    html: buildEmailLayout(
      'Contraseña actualizada',
      `<p>Hola ${user.nombre},</p><p>Cambiaste tu contraseña. Por seguridad, todas tus sesiones se cerraron.</p>`,
    ),
  });
  await auditLog(env, { event_type: AuditEvents.PASSWORD_CHANGED, actor_type: 'user', actor_id: user.id, request: req });
  return jsonOk(
    { message: 'Contraseña actualizada. Por favor inicia sesión nuevamente.' },
    200,
    { 'Set-Cookie': makeLogoutCookie(env) },
  );
}

// =====================================================================
// CHANGE EMAIL (con confirmación al nuevo email)
// =====================================================================

async function handleChangeEmailRequest(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const session = await getSession(req, env);
  if (!session) return Errors.unauthorized();

  const rl = await rateLimitByUser(env, session.user_id, 'change_email', RATE_LIMITS.CHANGE_EMAIL.max, RATE_LIMITS.CHANGE_EMAIL.window);
  if (!rl.allowed) return Errors.rateLimited(Math.ceil(rl.resetAt - Date.now() / 1000));

  const body = await readBody(req);
  const password = String(body['current_password'] ?? '');
  const newEmailV = validateEmail(body['new_email']);
  if (!newEmailV.ok) return Errors.validation(newEmailV.error);
  if (!password) return Errors.validation('Confirma tu contraseña actual');

  const user = await dbFetch<{ id: number; password_hash: string; email: string }>(
    env.DB,
    'SELECT id, password_hash, email FROM mv_users WHERE id = ?',
    [session.user_id],
  );
  if (!user) return Errors.unauthorized();

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return jsonError('Contraseña incorrecta', 400, { code: 'WRONG_PASSWORD' });

  if (user.email === newEmailV.value) {
    return Errors.validation('El nuevo email es igual al actual');
  }
  // Verificar disponibilidad
  const collide = await dbFetch<{ id: number }>(env.DB, 'SELECT id FROM mv_users WHERE email = ? AND id != ?', [newEmailV.value, user.id]);
  if (collide) return Errors.conflict('Ese email ya está en uso');

  const token = randomToken(32);
  const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  await dbExec(
    env.DB,
    `UPDATE mv_users SET email_change_token = ?, email_change_new_email = ?, email_change_expires = ?,
      reset_token = NULL, reset_token_expires = NULL WHERE id = ?`,
    [token, newEmailV.value, expires, user.id],
  );

  const url = `${env.SITE_URL}/cuenta.html?confirm_email=${encodeURIComponent(token)}`;
  await queueEmail(env, {
    to: newEmailV.value,
    subject: 'Confirma tu nuevo email - Mentis Viva',
    html: buildEmailLayout(
      'Confirma tu nuevo email',
      `<p>Solicitaste cambiar el email de tu cuenta. Para confirmar haz clic en el botón.</p>
       <p style="color:#6c757d;font-size:0.85rem">Este enlace expira en 24 horas. Si tú no lo solicitaste, ignora este mensaje.</p>`,
      { label: 'Confirmar nuevo email', url },
    ),
    idempotency_key: `email_change:${token}`,
  });
  // Notificar al email viejo también (alerta de cambio)
  await queueEmail(env, {
    to: user.email,
    subject: '⚠️ Cambio de email solicitado - Mentis Viva',
    html: buildEmailLayout(
      'Solicitud de cambio de email',
      `<p>Se solicitó cambiar el email de tu cuenta a <strong>${newEmailV.value}</strong>.</p>
       <p>Si no fuiste tú, cambia tu contraseña inmediatamente y contacta a contacto@mentisviva.cl.</p>`,
    ),
  });

  await auditLog(env, { event_type: AuditEvents.EMAIL_CHANGE_REQ, actor_type: 'user', actor_id: user.id, request: req });
  return jsonOk({ message: 'Revisa el nuevo email para confirmar el cambio.' });
}

async function handleChangeEmailConfirm(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const body = await readBody(req);
  const token = String(body['token'] ?? '');
  if (!token) return Errors.validation('Token requerido');

  const user = await dbFetch<{ id: number; email_change_new_email: string; flow_customer_id: string | null; nombre: string }>(
    env.DB,
    `SELECT id, email_change_new_email, flow_customer_id, nombre
     FROM mv_users WHERE email_change_token = ? AND email_change_expires > ?`,
    [token, nowISO()],
  );
  if (!user || !user.email_change_new_email) {
    return jsonError('Enlace inválido o expirado.', 400, { code: 'INVALID_TOKEN' });
  }

  const newEmail = user.email_change_new_email;
  await dbExec(
    env.DB,
    `UPDATE mv_users SET email = ?, email_change_token = NULL, email_change_new_email = NULL,
      email_change_expires = NULL WHERE id = ?`,
    [newEmail, user.id],
  );
  // Invalidar todas las sesiones (forzar re-login)
  await revokeAllUserSessions(env, user.id, 'user');

  // TODO: sincronizar con Flow customer (en fase de pago)
  await auditLog(env, { event_type: AuditEvents.EMAIL_CHANGE_DONE, actor_type: 'user', actor_id: user.id, request: req, details: { new_email: newEmail } });
  return jsonOk(
    { message: 'Email actualizado. Inicia sesión con el nuevo email.', email: newEmail },
    200,
    { 'Set-Cookie': makeLogoutCookie(env) },
  );
}

// =====================================================================
// CHANGE SECURITY QUESTION
// =====================================================================

async function handleChangeSecurity(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const session = await getSession(req, env);
  if (!session) return Errors.unauthorized();

  const body = await readBody(req);
  const password = String(body['current_password'] ?? '');
  const sqV = validateSecurityQuestion(body['security_question']);
  if (!sqV.ok) return Errors.validation(sqV.error);
  const saV = validateSecurityAnswer(body['security_answer']);
  if (!saV.ok) return Errors.validation(saV.error);

  const user = await dbFetch<{ password_hash: string }>(
    env.DB,
    'SELECT password_hash FROM mv_users WHERE id = ?',
    [session.user_id],
  );
  if (!user) return Errors.unauthorized();
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return jsonError('Contraseña incorrecta', 400, { code: 'WRONG_PASSWORD' });

  const answerHash = await sha256(saV.value);
  await dbExec(
    env.DB,
    'UPDATE mv_users SET security_question = ?, security_answer = ? WHERE id = ?',
    [sqV.value, answerHash, session.user_id],
  );
  await auditLog(env, { event_type: AuditEvents.SECURITY_QUESTION_CHANGED, actor_type: 'user', actor_id: session.user_id, request: req });
  return jsonOk({ message: 'Pregunta de seguridad actualizada' });
}

// =====================================================================
// CHECK SESSION
// =====================================================================

async function handleCheck(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session) return jsonOk({ logged_in: false });
  return jsonOk({
    logged_in: true,
    user: {
      id: session.user_id,
      email: session.email,
      nombre: session.nombre,
      apellido: session.apellido,
      plan_nombre: session.plan_nombre,
      plan_status: session.plan_status,
      is_admin: session.is_admin,
    },
  });
}
