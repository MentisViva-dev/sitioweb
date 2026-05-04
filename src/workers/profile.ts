/**
 * Profile Worker — perfil + ARCOP (Ley 21.719).
 *
 * Endpoints:
 *   GET   /api/profile/me
 *   PATCH /api/profile/update
 *   GET   /api/profile/orders
 *   GET   /api/profile/export       → derecho de portabilidad
 *   POST  /api/profile/request-deletion
 *   POST  /api/profile/confirm-deletion
 */

import type { Env, ExecutionContext } from '../types/env';
import type { DbUser, DbOrder } from '../types/db';
import { jsonOk, jsonError, Errors, readBody } from '../lib/responses';
import { dbFetch, dbFetchAll, dbExec, dbBatch } from '../lib/db';
import { getSession, revokeAllUserSessions } from '../lib/auth';
import { rateLimitByUser, RATE_LIMITS } from '../lib/rate-limit';
import { auditLog, AuditEvents } from '../lib/audit';
import {
  validateName, validateRUT, validatePhoneCL, validateAddress,
  validatePostalCode, validateLatLng,
} from '../lib/validators';
import { isInLockedWindow, addDays, nowISO, formatDateCL } from '../lib/dates';
import { randomToken, verifyPassword } from '../lib/crypto';
import { queueEmail, buildEmailLayout, sendAdminNotification } from '../lib/email';
import { flowDeleteCustomer, flowCancelSubscription } from '../lib/flow';

export async function handle(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  switch (`${method} ${path}`) {
    case 'GET /api/profile/me':                return handleMe(req, env);
    case 'PATCH /api/profile/update':          return handleUpdate(req, env);
    case 'POST /api/profile/update':           return handleUpdate(req, env);
    case 'GET /api/profile/orders':            return handleOrders(req, env);
    case 'GET /api/profile/export':            return handleExport(req, env);
    case 'POST /api/profile/request-deletion': return handleRequestDeletion(req, env);
    case 'POST /api/profile/confirm-deletion': return handleConfirmDeletion(req, env);
    default:                                   return Errors.notFound();
  }
}

async function handleMe(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session) return Errors.unauthorized();

  const user = await dbFetch<DbUser>(
    env.DB,
    `SELECT id, email, nombre, apellido, rut, telefono,
       direccion, numero, depto, comuna, ciudad, region, codigo_postal, lat, lng,
       plan_nombre, plan_status, payment_verified, last_payment_failed_at,
       shipping_method, shipping_cost, shipping_service_type, next_shipment_date, shipping_locked,
       cancel_effective_date, paused_until, payment_pending,
       security_question, marketing_opt_in, terms_accepted_version, data_version,
       email_bouncing, created_at
     FROM mv_users WHERE id = ?`,
    [session.user_id],
  );
  if (!user) return Errors.unauthorized();

  return jsonOk({
    user: {
      ...user,
      shipping_locked: Boolean(user.shipping_locked) || isInLockedWindow(new Date()),
      payment_verified: Boolean(user.payment_verified),
      payment_pending: Boolean(user.payment_pending),
      marketing_opt_in: Boolean(user.marketing_opt_in),
      email_bouncing: Boolean(user.email_bouncing),
    },
  });
}

async function handleUpdate(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session || session.is_admin) return Errors.unauthorized();
  const userId = session.user_id;

  const rl = await rateLimitByUser(env, userId, 'profile_update', RATE_LIMITS.PROFILE_UPDATE.max, RATE_LIMITS.PROFILE_UPDATE.window);
  if (!rl.allowed) return Errors.rateLimited(Math.ceil(rl.resetAt - Date.now() / 1000));

  // Optimistic locking
  const ifUnmod = req.headers.get('If-Unmodified-Since');
  const user = await dbFetch<DbUser>(
    env.DB,
    `SELECT data_version, shipping_locked, payment_pending, plan_status FROM mv_users WHERE id = ?`,
    [userId],
  );
  if (!user) return Errors.unauthorized();
  if (ifUnmod && ifUnmod !== user.data_version) {
    return jsonError('Los datos fueron modificados en otra pestaña. Recarga la página.', 412, { code: 'CONFLICT_VERSION' });
  }
  if (user.payment_pending) return Errors.paymentPending();

  const body = await readBody(req);
  const sets: string[] = [];
  const params: unknown[] = [];

  // Campos simples (siempre editables)
  for (const f of ['nombre', 'apellido']) {
    if (body[f] != null) {
      const v = validateName(body[f], f);
      if (!v.ok) return Errors.validation(v.error);
      sets.push(`${f} = ?`); params.push(v.value);
    }
  }

  // Teléfono
  if (body['telefono'] != null && body['telefono'] !== '') {
    const v = validatePhoneCL(body['telefono']);
    if (!v.ok) return Errors.validation(v.error);
    sets.push('telefono = ?'); params.push(v.value);
  }

  // RUT — solo si no hay órdenes pagadas
  if (body['rut'] != null && body['rut'] !== '') {
    const hasOrder = await dbFetch<{ id: number }>(
      env.DB,
      `SELECT id FROM mv_orders WHERE user_id = ? AND status IN ('paid','active') LIMIT 1`,
      [userId],
    );
    if (hasOrder) return Errors.validation('No puedes cambiar tu RUT después del primer cobro. Contacta soporte.');
    const v = validateRUT(body['rut']);
    if (!v.ok) return Errors.validation(v.error);
    sets.push('rut = ?'); params.push(v.value);
  }

  // Dirección — bloqueada en ventana locked
  const shippingFields = ['direccion', 'numero', 'depto', 'comuna', 'ciudad', 'region', 'codigo_postal', 'lat', 'lng'];
  const wantsShippingChange = shippingFields.some(f => body[f] != null);
  if (wantsShippingChange) {
    const lockedNow = Boolean(user.shipping_locked) || isInLockedWindow(new Date());
    if (lockedNow) {
      return Errors.shippingLocked(formatDateCL(addDays(new Date(), 30)));
    }
    if (body['direccion'] != null) {
      const v = validateAddress(body['direccion']);
      if (!v.ok) return Errors.validation(v.error);
      sets.push('direccion = ?'); params.push(v.value);
    }
    if (body['numero'] != null) { sets.push('numero = ?'); params.push(String(body['numero']).slice(0, 20)); }
    if (body['depto'] != null) { sets.push('depto = ?'); params.push(String(body['depto']).slice(0, 20)); }
    if (body['comuna'] != null) { sets.push('comuna = ?'); params.push(String(body['comuna']).slice(0, 50)); }
    if (body['ciudad'] != null) { sets.push('ciudad = ?'); params.push(String(body['ciudad']).slice(0, 50)); }
    if (body['region'] != null) { sets.push('region = ?'); params.push(String(body['region']).slice(0, 80)); }
    if (body['codigo_postal'] != null && body['codigo_postal'] !== '') {
      const v = validatePostalCode(body['codigo_postal']);
      if (!v.ok) return Errors.validation(v.error);
      sets.push('codigo_postal = ?'); params.push(v.value);
    }
    if (body['lat'] != null && body['lng'] != null) {
      const v = validateLatLng(body['lat'], body['lng']);
      if (!v.ok) return Errors.validation(v.error);
      sets.push('lat = ?'); params.push(v.value.lat);
      sets.push('lng = ?'); params.push(v.value.lng);
    }
  }

  // Marketing opt-in
  if (body['marketing_opt_in'] != null) {
    const optIn = body['marketing_opt_in'] === '1' || body['marketing_opt_in'] === 'true' ? 1 : 0;
    sets.push('marketing_opt_in = ?'); params.push(optIn);
    sets.push('marketing_opt_in_at = ?'); params.push(optIn ? nowISO() : null);
  }

  if (sets.length === 0) return Errors.validation('Nada que actualizar');

  params.push(userId);
  await dbExec(env.DB, `UPDATE mv_users SET ${sets.join(', ')} WHERE id = ?`, params);
  await auditLog(env, {
    event_type: AuditEvents.PROFILE_UPDATED,
    actor_type: 'user',
    actor_id: userId,
    request: req,
    details: { fields: sets.map(s => s.split('=')[0]?.trim()) },
  });

  // Si cambió comuna y tiene plan activo → re-cotizar shipping (en otra request)
  if (wantsShippingChange && (body['comuna'] != null || body['region'] != null) && user.plan_status === 'active') {
    return jsonOk({ message: 'Datos actualizados', recompute_shipping: true });
  }
  return jsonOk({ message: 'Datos actualizados' });
}

async function handleOrders(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session || session.is_admin) return Errors.unauthorized();
  const url = new URL(req.url);
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));

  const orders = await dbFetchAll<DbOrder>(
    env.DB,
    `SELECT id, plan_nombre, monto, shipping_monto, shipping_method, shipment_month, status,
       payment_id, refunded_at, refund_amount, created_at
     FROM mv_orders WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
    [session.user_id, limit, offset],
  );
  return jsonOk({ orders, limit, offset });
}

async function handleExport(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session) return Errors.unauthorized();

  const user = await dbFetch<DbUser>(
    env.DB,
    `SELECT id, email, nombre, apellido, rut, telefono,
       direccion, numero, depto, comuna, ciudad, region, codigo_postal,
       plan_nombre, plan_status, shipping_method, shipping_cost,
       marketing_opt_in, terms_accepted_version, terms_accepted_at, created_at
     FROM mv_users WHERE id = ?`,
    [session.user_id],
  );
  if (!user) return Errors.unauthorized();

  const orders = await dbFetchAll(env.DB, 'SELECT * FROM mv_orders WHERE user_id = ?', [session.user_id]);
  const roster = await dbFetchAll(env.DB, 'SELECT * FROM mv_shipment_roster WHERE user_id = ?', [session.user_id]);
  const surveys = await dbFetchAll(env.DB, 'SELECT * FROM mv_surveys WHERE user_id = ?', [session.user_id]);

  await auditLog(env, {
    event_type: AuditEvents.PROFILE_EXPORTED,
    actor_type: 'user',
    actor_id: session.user_id,
    request: req,
  });

  const exportData = {
    exported_at: nowISO(),
    legal_basis: 'Ley 21.719 / Ley 19.628 — Derecho de acceso y portabilidad',
    user,
    orders,
    shipment_roster: roster,
    surveys,
  };
  const json = JSON.stringify(exportData, null, 2);
  return new Response(json, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="mentisviva_export_${session.user_id}_${Date.now()}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}

async function handleRequestDeletion(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session || session.is_admin) return Errors.unauthorized();

  const rl = await rateLimitByUser(env, session.user_id, 'request_deletion', RATE_LIMITS.REQUEST_DELETION.max, RATE_LIMITS.REQUEST_DELETION.window);
  if (!rl.allowed) return Errors.rateLimited(Math.ceil(rl.resetAt - Date.now() / 1000));

  const body = await readBody(req);
  const password = String(body['current_password'] ?? '');

  const user = await dbFetch<{ id: number; password_hash: string; email: string; nombre: string }>(
    env.DB,
    'SELECT id, password_hash, email, nombre FROM mv_users WHERE id = ?',
    [session.user_id],
  );
  if (!user) return Errors.unauthorized();
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return jsonError('Contraseña incorrecta', 400, { code: 'WRONG_PASSWORD' });

  const token = randomToken(32);
  const expires = new Date(Date.now() + 7 * 86400_000).toISOString();
  await dbExec(
    env.DB,
    'UPDATE mv_users SET deletion_token = ?, deletion_requested_at = ?, deletion_expires = ? WHERE id = ?',
    [token, nowISO(), expires, user.id],
  );

  const url = `${env.SITE_URL}/cuenta.html?confirm_deletion=${encodeURIComponent(token)}`;
  await queueEmail(env, {
    to: user.email,
    subject: 'Confirma la eliminación de tu cuenta - Mentis Viva',
    html: buildEmailLayout(
      '¿Seguro que quieres eliminar tu cuenta?',
      `<p>Hola ${user.nombre},</p>
       <p>Solicitaste eliminar tu cuenta. Esta acción es irreversible:</p>
       <ul>
         <li>Se cancelarán todas tus suscripciones.</li>
         <li>Se eliminarán todos tus datos personales (nombre, RUT, dirección).</li>
         <li>Se conservarán datos contables anonimizados por obligación legal (5 años SII).</li>
       </ul>
       <p style="color:#6c757d;font-size:0.85rem">Este enlace expira en 7 días. Puedes ignorarlo si cambiaste de opinión.</p>`,
      { label: 'Confirmar eliminación', url },
    ),
    idempotency_key: `deletion:${token}`,
  });

  await auditLog(env, { event_type: AuditEvents.ACCOUNT_DELETION_REQ, actor_type: 'user', actor_id: user.id, request: req });
  return jsonOk({ message: 'Revisa tu email para confirmar la eliminación. Tienes 7 días.' });
}

async function handleConfirmDeletion(req: Request, env: Env): Promise<Response> {
  const body = await readBody(req);
  const token = String(body['token'] ?? '');
  if (!token) return Errors.validation('Token requerido');

  const user = await dbFetch<{ id: number; email: string; nombre: string; flow_customer_id: string | null; flow_subscription_id: string | null }>(
    env.DB,
    `SELECT id, email, nombre, flow_customer_id, flow_subscription_id FROM mv_users
     WHERE deletion_token = ? AND deletion_expires > ?`,
    [token, nowISO()],
  );
  if (!user) return jsonError('Enlace inválido o expirado', 400, { code: 'INVALID_TOKEN' });

  // Cancelar Flow + borrar customer
  if (user.flow_subscription_id) await flowCancelSubscription(env, user.flow_subscription_id);
  if (user.flow_customer_id) await flowDeleteCustomer(env, user.flow_customer_id);

  // Anonimizar (no DELETE total, para mantener trazabilidad contable)
  // SII Chile exige guardar facturación 5 años. Anonimizamos PII pero
  // mantenemos órdenes con user_id = el id.
  await dbBatch(env.DB, [
    env.DB.prepare(
      `UPDATE mv_users SET
        email = 'deleted_' || id || '@deleted.local',
        password_hash = '', verify_token = NULL, reset_token = NULL,
        nombre = '[ELIMINADO]', apellido = NULL, rut = NULL, telefono = NULL,
        direccion = NULL, numero = NULL, depto = NULL, comuna = NULL, ciudad = NULL,
        region = NULL, codigo_postal = NULL, lat = NULL, lng = NULL,
        security_question = NULL, security_answer = NULL,
        plan_status = 'none', plan_nombre = NULL, flow_customer_id = NULL,
        flow_subscription_id = NULL, shipping_method = NULL, shipping_cost = 0,
        shipping_service_type = NULL, next_shipment_date = NULL,
        deletion_token = NULL, deletion_requested_at = ?, deletion_expires = NULL,
        email_change_token = NULL, email_change_new_email = NULL,
        marketing_opt_in = 0
      WHERE id = ?`,
    ).bind(nowISO(), user.id),
    env.DB.prepare(`UPDATE mv_shipment_roster SET status = 'skipped' WHERE user_id = ? AND status IN ('queued','notified','confirmed')`).bind(user.id),
    env.DB.prepare(`DELETE FROM mv_sessions WHERE user_id = ?`).bind(user.id),
    env.DB.prepare(`DELETE FROM mv_user_credits WHERE user_id = ?`).bind(user.id),
  ]);

  await revokeAllUserSessions(env, user.id, 'user');
  await auditLog(env, { event_type: AuditEvents.ACCOUNT_DELETED, actor_type: 'user', actor_id: user.id, request: req });
  await sendAdminNotification(env, `Cuenta eliminada (Ley 21.719)`, `<p>Usuario ${user.email} ejerció su derecho al olvido.</p>`, '🗑️');

  return jsonOk({ message: 'Tu cuenta ha sido eliminada. Lamentamos verte partir.' });
}
