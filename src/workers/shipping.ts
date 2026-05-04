/**
 * Shipping Worker — cotización, preferencia, tracking.
 *
 * Endpoints:
 *   POST /api/shipping/quote
 *   POST /api/shipping/save-preference
 *   GET  /api/shipping/preference
 *   GET  /api/shipping/cutoff-info
 *   POST /api/shipping/track
 *   GET  /api/shipping/comunas
 */

import type { Env, ExecutionContext } from '../types/env';
import type { DbUser } from '../types/db';
import { jsonOk, jsonError, Errors, readBody } from '../lib/responses';
import { dbFetch, dbFetchAll, dbExec, getConfigInt } from '../lib/db';
import { getSession } from '../lib/auth';
import { rateLimitByUser, RATE_LIMITS } from '../lib/rate-limit';
import { auditLog, AuditEvents } from '../lib/audit';
import { shipitQuote, shipitTrack, externalTrackingUrl } from '../lib/shipit';
import {
  determineNextShipmentDate, calculateCutoffDate, isInLockedWindow,
  formatDateCL, formatISODate, firstDayOfNextMonth,
} from '../lib/dates';
import { validateShippingMethod, validateAmountCLP, validateTrackingCode } from '../lib/validators';

export async function handle(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (path === '/api/shipping/comunas' && method === 'GET') return handleListComunas(env);
  if (path === '/api/shipping/cutoff-info' && method === 'GET') return handleCutoffInfo(env);

  if (method !== 'POST' && !(path === '/api/shipping/preference' && method === 'GET')) {
    return Errors.methodNotAllowed();
  }

  switch (path) {
    case '/api/shipping/quote':           return handleQuote(req, env);
    case '/api/shipping/save-preference': return handleSavePreference(req, env);
    case '/api/shipping/preference':      return handleGetPreference(req, env);
    case '/api/shipping/track':           return handleTrack(req, env);
    default:                              return Errors.notFound();
  }
}

async function handleQuote(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session || session.is_admin) return Errors.unauthorized();
  const user = await dbFetch<DbUser>(env.DB, 'SELECT comuna FROM mv_users WHERE id = ?', [session.user_id]);
  if (!user || !user.comuna) return Errors.validation('Configura primero tu dirección');

  const quotes = await shipitQuote(env, user.comuna);

  const next = determineNextShipmentDate();
  const cutoff = calculateCutoffDate(next.getUTCFullYear(), next.getUTCMonth() + 1);
  const inLocked = isInLockedWindow(new Date());
  // Si está locked, mostrar info del PRÓXIMO ciclo
  const effectiveShipDate = inLocked ? determineNextShipmentDate(firstDayOfNextMonth(new Date())) : next;
  const effectiveCutoff = inLocked
    ? calculateCutoffDate(effectiveShipDate.getUTCFullYear(), effectiveShipDate.getUTCMonth() + 1)
    : cutoff;

  return jsonOk({
    options: quotes,
    next_shipment_date: formatISODate(effectiveShipDate),
    cutoff_date: formatISODate(effectiveCutoff),
    billing_date: formatISODate(effectiveCutoff),
    is_past_cutoff: inLocked,
  });
}

async function handleSavePreference(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session || session.is_admin) return Errors.unauthorized();
  const userId = session.user_id;

  const rl = await rateLimitByUser(env, userId, 'change_shipping', RATE_LIMITS.CHANGE_SHIPPING.max, RATE_LIMITS.CHANGE_SHIPPING.window);
  if (!rl.allowed) return Errors.rateLimited(Math.ceil(rl.resetAt - Date.now() / 1000));

  // Lock optimista de cambios concurrentes
  const userRow = await dbFetch<{ shipping_locked: number; shipping_changing: number; payment_pending: number }>(
    env.DB,
    'SELECT shipping_locked, shipping_changing, payment_pending FROM mv_users WHERE id = ?',
    [userId],
  );
  if (!userRow) return Errors.unauthorized();
  if (userRow.payment_pending) return Errors.paymentPending();
  if (userRow.shipping_changing) return Errors.conflict('Ya hay un cambio de envío en progreso. Intenta en unos segundos.');

  // Validar fecha real + flag (defensa en profundidad — resuelve hallazgo §2.5.2)
  const inLocked = isInLockedWindow(new Date());
  if (userRow.shipping_locked || inLocked) {
    const unlock = formatDateCL(firstDayOfNextMonth(new Date()));
    return Errors.shippingLocked(unlock);
  }

  const body = await readBody(req);
  const methodV = validateShippingMethod(body['shipping_method']);
  if (!methodV.ok) return Errors.validation(methodV.error);
  const costV = validateAmountCLP(body['shipping_cost'], { min: 0, max: 50_000 });
  if (!costV.ok) return Errors.validation(costV.error);
  const serviceType = String(body['shipping_service_type'] ?? methodV.value).slice(0, 50);

  // Set lock
  await dbExec(env.DB, 'UPDATE mv_users SET shipping_changing = 1 WHERE id = ?', [userId]);

  try {
    // Re-cotizar para verificar precio (mitiga precio cambiado entre quote y save)
    const user = await dbFetch<DbUser>(env.DB, 'SELECT comuna FROM mv_users WHERE id = ?', [userId]);
    if (user?.comuna) {
      const live = await shipitQuote(env, user.comuna);
      const found = live.find(q => q.courier === methodV.value);
      if (found && Math.abs(found.price - costV.value) > 100) {
        return jsonError('El precio cambió. Re-cotiza por favor.', 409, {
          code: 'PRICE_CHANGED',
          details: { new_price: found.price },
        });
      }
    }

    const next = determineNextShipmentDate();
    await dbExec(
      env.DB,
      `UPDATE mv_users SET shipping_method = ?, shipping_cost = ?, shipping_service_type = ?,
        next_shipment_date = ? WHERE id = ?`,
      [methodV.value, costV.value, serviceType, formatISODate(next), userId],
    );

    await auditLog(env, {
      event_type: AuditEvents.SHIPPING_PREFERENCE_SAVED,
      actor_type: 'user',
      actor_id: userId,
      request: req,
      details: { method: methodV.value, cost: costV.value },
    });

    return jsonOk({
      next_shipment_date: formatISODate(next),
      message: 'Preferencia de envío guardada',
    });
  } finally {
    await dbExec(env.DB, 'UPDATE mv_users SET shipping_changing = 0 WHERE id = ?', [userId]);
  }
}

async function handleGetPreference(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session || session.is_admin) return Errors.unauthorized();

  const user = await dbFetch<DbUser>(
    env.DB,
    `SELECT shipping_method, shipping_cost, shipping_service_type, next_shipment_date,
       shipping_locked FROM mv_users WHERE id = ?`,
    [session.user_id],
  );
  if (!user) return Errors.notFound('Usuario');

  const inLocked = isInLockedWindow(new Date());
  const next = determineNextShipmentDate();
  const cutoff = calculateCutoffDate(next.getUTCFullYear(), next.getUTCMonth() + 1);

  return jsonOk({
    shipping_method: user.shipping_method,
    shipping_cost: user.shipping_cost,
    shipping_service_type: user.shipping_service_type,
    next_shipment_date: user.next_shipment_date,
    shipping_locked: Boolean(user.shipping_locked) || inLocked,
    cutoff_date: formatISODate(cutoff),
    is_past_cutoff: inLocked,
  });
}

async function handleCutoffInfo(env: Env): Promise<Response> {
  const businessDays = await getConfigInt(env.DB, 'cutoff_business_days', 10);
  const shipDay = await getConfigInt(env.DB, 'shipping_day', 25);
  const next = determineNextShipmentDate(new Date(), shipDay);
  const cutoff = calculateCutoffDate(next.getUTCFullYear(), next.getUTCMonth() + 1, shipDay, businessDays);
  return jsonOk({
    next_shipment_date: formatISODate(next),
    cutoff_date: formatISODate(cutoff),
    is_past_cutoff: isInLockedWindow(new Date(), shipDay, businessDays),
    business_days: businessDays,
    ship_day: shipDay,
  });
}

async function handleTrack(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session) return Errors.unauthorized();
  const body = await readBody(req);
  const codeV = validateTrackingCode(body['tracking_code']);
  if (!codeV.ok) return Errors.validation(codeV.error);
  const courier = String(body['courier'] ?? '').toLowerCase().slice(0, 20);

  // Verificar que el tracking pertenece al usuario
  const roster = await dbFetch<{ user_id: number; shipping_method: string | null }>(
    env.DB,
    'SELECT user_id, shipping_method FROM mv_shipment_roster WHERE tracking_code = ?',
    [codeV.value],
  );
  if (!roster || (roster.user_id !== session.user_id && !session.is_admin)) {
    return Errors.notFound('Tracking');
  }

  const tracking = await shipitTrack(env, codeV.value, courier || roster.shipping_method || 'shipit');
  return jsonOk({
    tracking,
    external_url: externalTrackingUrl(courier || roster.shipping_method || 'shipit', codeV.value),
  });
}

async function handleListComunas(env: Env): Promise<Response> {
  const comunas = await dbFetchAll<{ id: number; nombre: string; region: string; is_extreme: number }>(
    env.DB,
    'SELECT id, nombre, region, is_extreme FROM mv_comunas WHERE active = 1 ORDER BY region, nombre',
  );
  return jsonOk({ comunas });
}
