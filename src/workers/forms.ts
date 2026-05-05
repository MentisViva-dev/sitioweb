/**
 * Forms Worker — formularios públicos.
 *
 * Endpoints:
 *   POST /api/forms/contact
 *   POST /api/forms/survey
 *   POST /api/forms/newsletter
 */

import type { Env, ExecutionContext } from '../types/env';
import { jsonOk, jsonError, Errors, readBody } from '../lib/responses';
import { dbInsert, dbFetch, dbExec } from '../lib/db';
import { rateLimitByIp, rateLimitByEmail, RATE_LIMITS } from '../lib/rate-limit';
import { auditLog } from '../lib/audit';
import { verifyRecaptcha } from '../lib/recaptcha';
import { validateEmail, validateName, sanitizeText, validatePhoneCL } from '../lib/validators';
import { getClientIp, getUserAgent } from '../lib/auth';
import { sendAdminNotification, queueEmail, buildEmailLayout } from '../lib/email';
import { randomToken } from '../lib/crypto';

export async function handle(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);

  // Confirmación double opt-in — GET con token
  if (url.pathname === '/api/forms/newsletter/confirm' && req.method === 'GET') {
    return handleNewsletterConfirm(req, env);
  }

  if (req.method !== 'POST') return Errors.methodNotAllowed();
  switch (url.pathname) {
    case '/api/forms/contact':    return handleContact(req, env);
    case '/api/forms/survey':     return handleSurvey(req, env);
    case '/api/forms/newsletter': return handleNewsletter(req, env);
    default:                      return Errors.notFound();
  }
}

async function handleContact(req: Request, env: Env): Promise<Response> {
  const rl = await rateLimitByIp(env, req, 'contact', RATE_LIMITS.CONTACT_FORM.max, RATE_LIMITS.CONTACT_FORM.window);
  if (!rl.allowed) return Errors.rateLimited(Math.ceil(rl.resetAt - Date.now() / 1000));

  const body = await readBody(req);
  // Honeypot
  if (body['website']) return jsonOk({ message: 'OK' });

  // reCAPTCHA
  const captcha = await verifyRecaptcha(env, String(body['recaptcha_token'] ?? ''), 'contact', getClientIp(req));
  if (!captcha.ok) return Errors.forbidden();

  const emailV = validateEmail(body['email']);
  if (!emailV.ok) return Errors.validation(emailV.error);
  const nameV = validateName(body['nombre']);
  if (!nameV.ok) return Errors.validation(nameV.error);
  const mensaje = sanitizeText(body['mensaje'], 5000);
  if (mensaje.length < 5) return Errors.validation('Mensaje muy corto');

  let phone: string | null = null;
  if (body['telefono'] && body['telefono'] !== '') {
    const v = validatePhoneCL(body['telefono']);
    if (v.ok) phone = v.value;
  }

  const source = String(body['source'] ?? 'unknown').slice(0, 50);
  const formId = await dbInsert(
    env.DB,
    `INSERT INTO mv_forms (form_type, source, nombre, email, telefono, mensaje, ip_address, user_agent, recaptcha_score)
     VALUES ('contact', ?, ?, ?, ?, ?, ?, ?, ?)`,
    [source, nameV.value, emailV.value, phone, mensaje, getClientIp(req), getUserAgent(req), captcha.score],
  );

  await sendAdminNotification(
    env,
    `Nuevo contacto desde ${source}: ${nameV.value}`,
    `<p><strong>Email:</strong> ${emailV.value}</p>
     <p><strong>Teléfono:</strong> ${phone ?? 'sin'}</p>
     <p><strong>Mensaje:</strong></p>
     <pre style="white-space:pre-wrap;background:#f5f5f5;padding:12px;border-radius:8px">${escapeHtml(mensaje)}</pre>`,
    '📩',
  );
  await auditLog(env, { event_type: 'form.contact', actor_type: 'user', request: req, details: { source, form_id: formId } });
  return jsonOk({ message: 'Mensaje enviado. Te contactaremos pronto.' });
}

async function handleSurvey(req: Request, env: Env): Promise<Response> {
  const body = await readBody(req);
  const token = String(body['survey_token'] ?? '');
  if (!token) return Errors.validation('Token de encuesta requerido');

  const rl = await rateLimitByEmail(env, token, 'survey', RATE_LIMITS.SURVEY_SUBMIT.max, RATE_LIMITS.SURVEY_SUBMIT.window);
  if (!rl.allowed) return Errors.rateLimited(Math.ceil(rl.resetAt - Date.now() / 1000));

  const responses = body['responses'];
  if (!responses) return Errors.validation('Respuestas requeridas');

  const responsesJson = typeof responses === 'string' ? responses : JSON.stringify(responses);
  if (responsesJson.length > 10_000) return Errors.validation('Respuestas demasiado largas');

  await dbInsert(
    env.DB,
    'INSERT INTO mv_surveys (survey_token, responses, ip_address) VALUES (?, ?, ?)',
    [token, responsesJson, getClientIp(req)],
  );
  return jsonOk({ message: 'Encuesta registrada' });
}

async function handleNewsletter(req: Request, env: Env): Promise<Response> {
  const rl = await rateLimitByIp(env, req, 'newsletter', RATE_LIMITS.NEWSLETTER.max, RATE_LIMITS.NEWSLETTER.window);
  if (!rl.allowed) return Errors.rateLimited(Math.ceil(rl.resetAt - Date.now() / 1000));

  const body = await readBody(req);
  if (body['website']) return jsonOk({ message: 'OK' });
  const emailV = validateEmail(body['email']);
  if (!emailV.ok) return Errors.validation(emailV.error);
  const nameV = body['nombre'] ? validateName(body['nombre']) : { ok: true as const, value: null };
  if (!nameV.ok) return Errors.validation(nameV.error);

  const source = String(body['source'] ?? 'footer').slice(0, 50);

  // Si ya existe el email pero no está confirmado, regenerar token y reenviar.
  // INSERT OR IGNORE no actualiza tokens; necesitamos UPSERT lógico.
  const existing = await dbFetch<{ id: number; confirmed: number }>(
    env.DB,
    'SELECT id, confirmed FROM mv_subscribers_newsletter WHERE email = ?',
    [emailV.value],
  );

  const confirmToken = randomToken(32);
  const unsubToken = randomToken(32);

  if (existing) {
    if (existing.confirmed === 1) {
      // Ya confirmado — no hacer nada, mismo mensaje genérico.
      return jsonOk({ message: 'Revisa tu email para confirmar la suscripción.' });
    }
    // Refrescar tokens para reenvío de double opt-in
    await dbExec(
      env.DB,
      `UPDATE mv_subscribers_newsletter
         SET confirm_token = ?, unsubscribe_token = ?, source = ?, ip_address = ?
       WHERE id = ?`,
      [confirmToken, unsubToken, source, getClientIp(req), existing.id],
    );
  } else {
    await dbInsert(
      env.DB,
      `INSERT INTO mv_subscribers_newsletter
         (email, nombre, source, confirmed, confirm_token, unsubscribe_token, ip_address)
       VALUES (?, ?, ?, 0, ?, ?, ?)`,
      [emailV.value, nameV.value, source, confirmToken, unsubToken, getClientIp(req)],
    );
  }

  // Email de double opt-in
  const confirmUrl = `${env.SITE_URL}/confirmar-newsletter?token=${encodeURIComponent(confirmToken)}`;
  await queueEmail(env, {
    to: emailV.value,
    subject: 'Confirma tu suscripción - Mentis Viva',
    html: buildEmailLayout(
      'Confirma tu suscripción',
      `<p>Hola${nameV.value ? ' ' + escapeHtml(nameV.value) : ''},</p>
       <p>Para terminar tu suscripción al boletín de Mentis Viva, confirma tu email.</p>
       <p style="color:#6c757d;font-size:0.85rem">Si no fuiste tú, ignora este mensaje.</p>`,
      { label: 'Confirmar suscripción', url: confirmUrl },
    ),
    idempotency_key: `newsletter_confirm:${confirmToken}`,
  });

  return jsonOk({ message: 'Revisa tu email para confirmar la suscripción.' });
}

/**
 * GET /api/forms/newsletter/confirm?token=X
 *
 * Confirma double opt-in. Devuelve JSON `{ ok, confirmed: true|false }` —
 * el frontend lee el resultado y muestra una página de éxito o error.
 *
 * Como es un enlace que el usuario abre directamente en el navegador, también
 * aceptamos respuesta HTML mínima si se pide con `Accept: text/html` o si la
 * URL contiene `redirect=1`. Por simplicidad mantenemos JSON; la página estática
 * en `/confirmar-newsletter` puede leer el query param `result=ok|error`.
 */
async function handleNewsletterConfirm(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  if (!token) return jsonError('Token requerido', 400, { code: 'MISSING_TOKEN' });

  const sub = await dbFetch<{ id: number; email: string; confirmed: number }>(
    env.DB,
    'SELECT id, email, confirmed FROM mv_subscribers_newsletter WHERE confirm_token = ?',
    [token],
  );
  if (!sub) {
    return jsonError('Enlace inválido o ya usado.', 400, { code: 'INVALID_TOKEN' });
  }

  if (sub.confirmed === 1) {
    return jsonOk({ message: 'Tu suscripción ya estaba confirmada.', confirmed: true, already: true });
  }

  await dbExec(
    env.DB,
    `UPDATE mv_subscribers_newsletter
       SET confirmed = 1, confirm_token = NULL
     WHERE id = ?`,
    [sub.id],
  );

  await auditLog(env, {
    event_type: 'newsletter.confirmed',
    actor_type: 'user',
    request: req,
    details: { email: sub.email },
  });

  return jsonOk({ message: '¡Suscripción confirmada!', confirmed: true });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
