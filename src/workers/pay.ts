/**
 * Pay Worker — TODO el flujo de pagos con Flow.cl
 *
 * Endpoints:
 *   POST /api/pay/subscribe              (auth)
 *   POST /api/pay/cancel                 (auth, cancelación diferida en ventana locked)
 *   POST /api/pay/undo-cancel            (auth, revertir cancel_pending)
 *   POST /api/pay/change-card            (auth)
 *   GET  /api/pay/confirm-card-change    (return de Flow tras cambio tarjeta)
 *   POST /api/pay/refund                 (admin only)
 *   POST /api/pay/pause                  (auth)
 *   POST /api/pay/resume                 (auth)
 *   POST /api/pay/dispute                (auth, ley 20.009)
 *   POST /api/pay/callback               (PÚBLICO, webhook Flow — firma verificada)
 *   GET  /api/pay/return                 (return URL post-pago Flow)
 *
 * Resuelve hallazgos críticos auditoría: callback firma, monto validado,
 * idempotencia con UNIQUE, payment_verified solo en callback, cancelación
 * diferida en ventana locked, refund admin, change-card con confirmación.
 */

import type { Env, ExecutionContext } from '../types/env';
import type { DbUser, DbOrder } from '../types/db';
import { jsonOk, jsonError, Errors, readBody } from '../lib/responses';
import { dbFetch, dbInsert, dbExec, dbBatch, dbInsertIfNotExists } from '../lib/db';
import { getSession } from '../lib/auth';
import { rateLimitByUser, RATE_LIMITS } from '../lib/rate-limit';
import { auditLog, AuditEvents } from '../lib/audit';
import {
  flowCreateCustomer, flowGetCustomer, flowDeleteCustomer,
  flowRegisterCard, flowUnregisterCard,
  flowCreatePlan, flowCreateSubscription, flowCancelSubscription,
  flowGetPaymentStatus, flowRefund, flowListSubscriptions,
  parseCommerceOrder, buildCommerceOrder, buildDynamicPlanId,
  verifyCallbackSignature, FLOW_STATUS,
} from '../lib/flow';
import { sendAdminNotification, queueEmail, buildEmailLayout } from '../lib/email';
import {
  determineNextShipmentDate, calculateTrialDays,
  isInLockedWindow, firstDayOfNextMonth, formatDateCL, formatISODate,
  shipmentMonthStr, nowISO,
} from '../lib/dates';
import { validatePlanName, validateAmountCLP } from '../lib/validators';

export async function handle(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  // Callback es público (Flow lo invoca)
  if (path === '/api/pay/callback') return handleCallback(req, env, ctx);
  if (path === '/api/pay/return') return handleReturn(req, env);
  if (path === '/api/pay/confirm-card-change') return handleConfirmCardChange(req, env);

  if (req.method !== 'POST') return Errors.methodNotAllowed();

  switch (path) {
    case '/api/pay/subscribe':       return handleSubscribe(req, env, ctx);
    case '/api/pay/cancel':          return handleCancel(req, env, ctx);
    case '/api/pay/undo-cancel':     return handleUndoCancel(req, env);
    case '/api/pay/change-card':     return handleChangeCard(req, env);
    case '/api/pay/refund':          return handleRefund(req, env, ctx);
    case '/api/pay/pause':           return handlePause(req, env);
    case '/api/pay/resume':          return handleResume(req, env);
    case '/api/pay/dispute':         return handleDispute(req, env);
    default:                         return Errors.notFound();
  }
}

// =====================================================================
// SUBSCRIBE — crea suscripción Flow
// =====================================================================

async function handleSubscribe(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const session = await getSession(req, env);
  if (!session || session.is_admin) return Errors.unauthorized();
  const userId = session.user_id;

  const rl = await rateLimitByUser(env, userId, 'subscribe', 5, 600);
  if (!rl.allowed) return Errors.rateLimited(Math.ceil(rl.resetAt - Date.now() / 1000));

  const body = await readBody(req);

  // Cargar usuario completo
  const user = await dbFetch<DbUser>(
    env.DB,
    `SELECT id, email, nombre, apellido, rut, telefono, plan_nombre, plan_status,
       flow_customer_id, flow_subscription_id,
       shipping_method, shipping_cost, shipping_service_type, payment_pending
     FROM mv_users WHERE id = ?`,
    [userId],
  );
  if (!user) return Errors.unauthorized();

  if (user.payment_pending) return Errors.paymentPending();

  // Validar plan
  const planName = String(body['plan'] ?? '').trim();
  const allowedPlans = await loadAllowedPlans(env);
  const planV = validatePlanName(planName, Object.keys(allowedPlans));
  if (!planV.ok) return Errors.validation(planV.error);
  const plan = allowedPlans[planV.value];
  if (!plan) return Errors.validation('Plan no disponible');

  // Verificar shipping configurado
  if (!user.shipping_method || !user.shipping_cost || user.shipping_cost <= 0) {
    return Errors.validation('Selecciona un método de envío primero');
  }

  // Total = plan + shipping
  const totalAmount = plan.amount + user.shipping_cost;
  const validation = validateAmountCLP(totalAmount, { min: 1, max: 500_000 });
  if (!validation.ok) return Errors.validation(validation.error);

  // Si ya tiene suscripción activa con OTRO plan, primero cancelar la vieja en Flow
  if (user.flow_subscription_id && user.plan_nombre !== planName) {
    await flowCancelSubscription(env, user.flow_subscription_id);
    // No esperamos refund por ahora — eso va a §refund admin con prorrateo
  }

  // Asegurar customer Flow
  let customerId = user.flow_customer_id;
  if (!customerId) {
    const externalId = `mv_${userId}`;
    const fullName = `${user.nombre} ${user.apellido ?? ''}`.trim();
    const cr = await flowCreateCustomer(env, externalId, user.email, fullName);
    if (!cr.customerId) {
      // Buscar por externalId si ya existía
      // (en prod podríamos paginar /customer/list, simplificamos: error)
      return jsonError('No se pudo crear cliente en Flow', 502, { code: 'FLOW_CUSTOMER_FAIL' });
    }
    customerId = cr.customerId;
    await dbExec(env.DB, 'UPDATE mv_users SET flow_customer_id = ? WHERE id = ?', [customerId, userId]);
  }

  // Calcular trial_days hasta el próximo cutoff
  const trialDays = calculateTrialDays(new Date());

  // Crear plan dinámico (idempotente)
  const dynamicPlanId = buildDynamicPlanId(planName, totalAmount);
  await flowCreatePlan(env, dynamicPlanId, `${planName} - Mentis Viva`, totalAmount, {
    trial_period_days: trialDays,
    urlCallback: `${env.API_URL}/api/pay/callback`,
  });

  // Crear suscripción
  const sub = await flowCreateSubscription(env, dynamicPlanId, customerId, trialDays);
  if (!sub.subscriptionId) {
    await auditLog(env, { event_type: AuditEvents.SUBSCRIBE_FAILED, actor_type: 'user', actor_id: userId, request: req, details: { reason: sub.message } });
    return jsonError('No se pudo crear suscripción', 502, { code: 'FLOW_SUB_FAIL', details: sub.message });
  }

  // Crear orden + actualizar usuario en BATCH
  const nextShipment = determineNextShipmentDate();
  const shipmentMonth = shipmentMonthStr(nextShipment);

  // Insertar orden (status = 'active' espera callback que la pasará a 'paid')
  const orderId = await dbInsert(
    env.DB,
    `INSERT INTO mv_orders
      (user_id, plan_nombre, monto, shipping_monto, status, payment_method, payment_id,
       shipping_method, shipment_month, flow_subscription_id)
     VALUES (?, ?, ?, ?, 'active', 'flow_subscription', '', ?, ?, ?)`,
    [userId, planName, totalAmount, user.shipping_cost, user.shipping_method, shipmentMonth, sub.subscriptionId],
  );

  // ⚠️ NO seteamos payment_verified=1 aquí. Solo el callback lo hace.
  await dbExec(
    env.DB,
    `UPDATE mv_users SET plan_nombre = ?, plan_status = 'active', flow_subscription_id = ?,
       next_shipment_date = ? WHERE id = ?`,
    [planName, sub.subscriptionId, formatISODate(nextShipment), userId],
  );

  await auditLog(env, {
    event_type: AuditEvents.SUBSCRIBE,
    actor_type: 'user',
    actor_id: userId,
    request: req,
    details: { plan: planName, monto: totalAmount, order_id: orderId, subscription_id: sub.subscriptionId },
  });
  await sendAdminNotification(
    env,
    `Nueva suscripción: ${user.nombre} ${user.apellido ?? ''}`,
    `<p><strong>Plan:</strong> ${planName}</p>
     <p><strong>Total:</strong> $${totalAmount.toLocaleString('es-CL')}</p>
     <p><strong>Email:</strong> ${user.email}</p>`,
    '🎉',
  );

  return jsonOk({
    message: 'Suscripción creada. El cobro se confirmará por callback.',
    plan: planName,
    total_amount: totalAmount,
    next_shipment_date: formatISODate(nextShipment),
    trial_days: trialDays,
    subscription_id: sub.subscriptionId,
    order_id: orderId,
  });
}

// =====================================================================
// CANCEL — con cancelación diferida en ventana locked
// =====================================================================

async function handleCancel(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const session = await getSession(req, env);
  if (!session || session.is_admin) return Errors.unauthorized();
  const userId = session.user_id;

  const user = await dbFetch<DbUser>(
    env.DB,
    `SELECT id, email, nombre, plan_nombre, plan_status, flow_customer_id, flow_subscription_id,
       shipping_locked, next_shipment_date, payment_pending
     FROM mv_users WHERE id = ?`,
    [userId],
  );
  if (!user) return Errors.unauthorized();
  if (user.payment_pending) return Errors.paymentPending();
  if (user.plan_status === 'none' || !user.flow_subscription_id) {
    return Errors.validation('No tienes suscripción activa para cancelar');
  }

  // Verificar si hay orden pagada/activa del mes actual
  const currentMonth = shipmentMonthStr(new Date());
  const paidThisMonth = await dbFetch<{ id: number; monto: number; status: string }>(
    env.DB,
    `SELECT id, monto, status FROM mv_orders
     WHERE user_id = ? AND shipment_month = ? AND status IN ('paid','active')
     ORDER BY id DESC LIMIT 1`,
    [userId, currentMonth],
  );

  // Verificar si está en ventana locked (cutoff → día 25)
  const inLocked = isInLockedWindow(new Date());

  // CANCELACIÓN DIFERIDA: si está en ventana locked y hay orden cobrada, programar cancel
  if ((user.shipping_locked || inLocked) && paidThisMonth) {
    const effectiveDate = formatISODate(firstDayOfNextMonth(new Date()));
    await dbExec(
      env.DB,
      'UPDATE mv_users SET plan_status = ?, cancel_effective_date = ? WHERE id = ?',
      ['cancel_pending', effectiveDate, userId],
    );
    await queueEmail(env, {
      to: user.email,
      subject: '📅 Cancelación programada - Mentis Viva',
      html: buildEmailLayout(
        'Tu cancelación está programada',
        `<p>Hola ${user.nombre},</p>
         <p>Tu suscripción se cancelará el <strong>${formatDateCL(effectiveDate)}</strong>.</p>
         <p>Tu caja de este mes ya está pagada y se despachará el 25.</p>
         <p>Si cambias de opinión antes de esa fecha, puedes reactivar desde tu cuenta.</p>`,
      ),
    });
    await sendAdminNotification(
      env,
      `Cancelación diferida: ${user.nombre}`,
      `<p>Usuario ${user.email} cancelará a partir del ${effectiveDate}. Despacho de este mes se mantiene.</p>`,
      '📅',
    );
    await auditLog(env, {
      event_type: AuditEvents.CANCEL_DEFERRED,
      actor_type: 'user',
      actor_id: userId,
      request: req,
      details: { effective_date: effectiveDate, plan: user.plan_nombre },
    });
    return jsonOk({
      deferred: true,
      effective_date: effectiveDate,
      message: 'Cancelación programada. Recibirás tu caja de este mes; no se cobrará el próximo.',
    });
  }

  // CANCELACIÓN INMEDIATA: fuera de ventana locked o sin orden cobrada
  if (user.flow_subscription_id) {
    await flowCancelSubscription(env, user.flow_subscription_id);
  }
  // Cancelar TODAS las subs activas/trial del customer (defensa contra duplicados)
  if (user.flow_customer_id) {
    const subs = await flowListSubscriptions(env, user.flow_customer_id);
    if (Array.isArray(subs.data)) {
      for (const s of subs.data as Array<Record<string, unknown>>) {
        const sid = s['subscriptionId'];
        const status = Number(s['status'] ?? 0);
        if (typeof sid === 'string' && (status === 1 || status === 4)) {
          await flowCancelSubscription(env, sid);
        }
      }
    }
    // Borrar customer (Flow no permite reusar tras cancel completo en algunos flujos)
    await flowDeleteCustomer(env, user.flow_customer_id);
  }

  await dbBatch(env.DB, [
    env.DB.prepare(
      `UPDATE mv_users SET plan_status = 'none', plan_nombre = NULL, flow_customer_id = NULL,
         flow_subscription_id = NULL, shipping_method = NULL, shipping_cost = 0,
         shipping_service_type = NULL, next_shipment_date = NULL, cancel_effective_date = NULL
       WHERE id = ?`,
    ).bind(userId),
    env.DB.prepare(
      `UPDATE mv_orders SET status = 'cancelled' WHERE user_id = ? AND status IN ('active','paid')`,
    ).bind(userId),
    env.DB.prepare(
      `UPDATE mv_shipment_roster SET status = 'skipped'
       WHERE user_id = ? AND status IN ('queued','notified','confirmed')`,
    ).bind(userId),
  ]);

  await queueEmail(env, {
    to: user.email,
    subject: 'Suscripción cancelada - Mentis Viva',
    html: buildEmailLayout(
      'Lamentamos verte partir',
      `<p>Hola ${user.nombre},</p>
       <p>Tu suscripción ha sido cancelada. Esperamos verte de vuelta pronto.</p>
       <p>Si quieres compartir feedback, responde a este correo.</p>`,
    ),
  });
  await sendAdminNotification(
    env,
    `Cancelación: ${user.nombre} - ${user.plan_nombre}`,
    `<p><strong>Email:</strong> ${user.email}</p><p><strong>Plan:</strong> ${user.plan_nombre}</p>`,
    '⚠️',
  );
  await auditLog(env, {
    event_type: AuditEvents.CANCEL_IMMEDIATE,
    actor_type: 'user',
    actor_id: userId,
    request: req,
    details: { plan: user.plan_nombre },
  });

  return jsonOk({ message: 'Suscripción cancelada' });
}

async function handleUndoCancel(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session || session.is_admin) return Errors.unauthorized();
  const result = await dbExec(
    env.DB,
    `UPDATE mv_users SET plan_status = 'active', cancel_effective_date = NULL
     WHERE id = ? AND plan_status = 'cancel_pending'`,
    [session.user_id],
  );
  if (result === 0) return Errors.validation('No tienes cancelación pendiente');
  await auditLog(env, { event_type: AuditEvents.CANCEL_UNDONE, actor_type: 'user', actor_id: session.user_id, request: req });
  return jsonOk({ message: 'Cancelación revertida. Tu suscripción continúa.' });
}

// =====================================================================
// CHANGE CARD — flujo Flow + callback de confirmación real
// =====================================================================

async function handleChangeCard(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session || session.is_admin) return Errors.unauthorized();
  const userId = session.user_id;

  const rl = await rateLimitByUser(env, userId, 'change_card', RATE_LIMITS.CHANGE_CARD.max, RATE_LIMITS.CHANGE_CARD.window);
  if (!rl.allowed) return Errors.rateLimited(Math.ceil(rl.resetAt - Date.now() / 1000));

  const user = await dbFetch<DbUser>(
    env.DB,
    'SELECT flow_customer_id, payment_pending FROM mv_users WHERE id = ?',
    [userId],
  );
  if (!user || !user.flow_customer_id) return Errors.validation('No tienes cliente Flow registrado');
  if (user.payment_pending) return Errors.paymentPending();

  // Unregister + verificar respuesta
  const unreg = await flowUnregisterCard(env, user.flow_customer_id);
  if (!unreg || (unreg.status !== undefined && unreg.status !== 0)) {
    // Algunos endpoints Flow no devuelven 'status' en éxito. Verificamos heurística.
    if (unreg.message && /error|fail/i.test(unreg.message)) {
      return jsonError('No se pudo desregistrar tu tarjeta actual', 502, { code: 'FLOW_UNREGISTER_FAIL' });
    }
  }

  // Setear payment_pending por 30 min
  await dbExec(
    env.DB,
    'UPDATE mv_users SET payment_pending = 1, payment_pending_expires = ? WHERE id = ?',
    [new Date(Date.now() + 30 * 60 * 1000).toISOString(), userId],
  );

  // Register
  const returnUrl = `${env.API_URL}/api/pay/confirm-card-change?u=${userId}`;
  const reg = await flowRegisterCard(env, user.flow_customer_id, returnUrl);
  if (!reg.url || !reg.token) {
    await dbExec(env.DB, 'UPDATE mv_users SET payment_pending = 0 WHERE id = ?', [userId]);
    return jsonError('No se pudo iniciar registro de tarjeta', 502, { code: 'FLOW_REGISTER_FAIL' });
  }

  await auditLog(env, { event_type: AuditEvents.CARD_CHANGE_REQ, actor_type: 'user', actor_id: userId, request: req });
  return jsonOk({ redirect: `${reg.url}?token=${reg.token}` });
}

async function handleConfirmCardChange(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const userId = parseInt(url.searchParams.get('u') ?? '0', 10);
  if (!userId) {
    return new Response('', { status: 302, headers: { Location: `${env.SITE_URL}/cuenta.html?card_change_failed=1` } });
  }

  const user = await dbFetch<{ flow_customer_id: string | null; email: string; nombre: string }>(
    env.DB,
    'SELECT flow_customer_id, email, nombre FROM mv_users WHERE id = ?',
    [userId],
  );
  if (!user || !user.flow_customer_id) {
    return new Response('', { status: 302, headers: { Location: `${env.SITE_URL}/cuenta.html?card_change_failed=1` } });
  }

  // Verificar que la tarjeta efectivamente quedó registrada en Flow
  const customer = await flowGetCustomer(env, user.flow_customer_id);
  const hasCard = customer && customer['creditCardType'] && customer['last4CardDigits'];

  await dbExec(env.DB, 'UPDATE mv_users SET payment_pending = 0, payment_pending_expires = NULL WHERE id = ?', [userId]);

  if (!hasCard) {
    await queueEmail(env, {
      to: user.email,
      subject: 'Cambio de tarjeta no se completó - Mentis Viva',
      html: buildEmailLayout(
        'No pudimos registrar tu tarjeta',
        `<p>Hola ${user.nombre},</p><p>Intenta nuevamente desde tu cuenta. Si el problema persiste, contáctanos.</p>`,
      ),
    });
    await auditLog(env, { event_type: AuditEvents.CARD_CHANGE_FAILED, actor_type: 'user', actor_id: userId, request: req });
    return new Response('', { status: 302, headers: { Location: `${env.SITE_URL}/cuenta.html?card_change_failed=1` } });
  }

  await auditLog(env, { event_type: AuditEvents.CARD_CHANGE_DONE, actor_type: 'user', actor_id: userId, request: req });
  return new Response('', { status: 302, headers: { Location: `${env.SITE_URL}/cuenta.html?card_changed=1` } });
}

// =====================================================================
// REFUND (admin only)
// =====================================================================

async function handleRefund(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const session = await getSession(req, env);
  if (!session || !session.is_admin) return Errors.forbidden();
  // Refund es destructivo: requerimos rol explícito superadmin/admin (denyByDefault).
  // Antes existía el bug `if (session.admin_role && !allowed.includes)` que permitía pasar
  // si admin_role venía undefined.
  if (!session.admin_role || !['superadmin', 'admin'].includes(session.admin_role)) return Errors.forbidden();

  const body = await readBody(req);
  const orderId = parseInt(String(body['order_id'] ?? '0'), 10);
  const reason = String(body['reason'] ?? '').slice(0, 500);
  if (!orderId) return Errors.validation('order_id requerido');

  const order = await dbFetch<DbOrder>(
    env.DB,
    'SELECT id, user_id, monto, status, payment_id FROM mv_orders WHERE id = ?',
    [orderId],
  );
  if (!order) return Errors.notFound('Orden');
  if (order.status === 'refunded') return Errors.conflict('Orden ya reembolsada');
  if (order.status !== 'paid') return Errors.validation('Solo órdenes pagadas pueden reembolsarse');

  const commerceOrder = buildCommerceOrder(order.id);
  const refundResult = await flowRefund(env, commerceOrder, order.monto);

  if (refundResult.status !== undefined && refundResult.status !== 0 && refundResult.message) {
    return jsonError('Flow rechazó el refund', 502, { code: 'FLOW_REFUND_FAIL', details: refundResult.message });
  }

  await dbExec(
    env.DB,
    `UPDATE mv_orders SET status = 'refunded', refunded_at = ?, refunded_by_admin_id = ?,
       refund_reason = ?, refund_flow_id = ?, refund_amount = ? WHERE id = ?`,
    [nowISO(), session.admin_id ?? null, reason || null, String(refundResult['flowRefundId'] ?? ''), order.monto, orderId],
  );

  await auditLog(env, {
    event_type: AuditEvents.PAYMENT_REFUNDED,
    actor_type: 'admin',
    actor_id: session.admin_id ?? null,
    target_user_id: order.user_id,
    request: req,
    details: { order_id: orderId, amount: order.monto, reason },
  });
  return jsonOk({ message: 'Reembolso procesado', order_id: orderId });
}

// =====================================================================
// PAUSE / RESUME
// =====================================================================

async function handlePause(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session || session.is_admin) return Errors.unauthorized();

  const body = await readBody(req);
  const months = Math.min(3, Math.max(1, parseInt(String(body['months'] ?? '1'), 10)));
  const pausedUntil = formatISODate(new Date(Date.now() + months * 30 * 86400_000));

  const user = await dbFetch<{ plan_status: string }>(env.DB, 'SELECT plan_status FROM mv_users WHERE id = ?', [session.user_id]);
  if (!user || user.plan_status !== 'active') return Errors.validation('Solo planes activos pueden pausarse');

  await dbExec(env.DB, 'UPDATE mv_users SET plan_status = ?, paused_until = ? WHERE id = ?', ['paused', pausedUntil, session.user_id]);
  await auditLog(env, { event_type: AuditEvents.PAUSED, actor_type: 'user', actor_id: session.user_id, request: req, details: { months, paused_until: pausedUntil } });
  return jsonOk({ message: `Suscripción pausada hasta ${formatDateCL(pausedUntil)}`, paused_until: pausedUntil });
}

async function handleResume(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session || session.is_admin) return Errors.unauthorized();
  const result = await dbExec(env.DB, "UPDATE mv_users SET plan_status = 'active', paused_until = NULL WHERE id = ? AND plan_status = 'paused'", [session.user_id]);
  if (result === 0) return Errors.validation('No tienes suscripción pausada');
  await auditLog(env, { event_type: AuditEvents.RESUMED, actor_type: 'user', actor_id: session.user_id, request: req });
  return jsonOk({ message: 'Suscripción reactivada' });
}

// =====================================================================
// DISPUTE (Ley 20.009)
// =====================================================================

async function handleDispute(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (!session || session.is_admin) return Errors.unauthorized();
  const body = await readBody(req);
  const orderId = parseInt(String(body['order_id'] ?? '0'), 10);
  const reason = String(body['reason'] ?? '').slice(0, 1000);
  if (!orderId || !reason) return Errors.validation('order_id y motivo requeridos');

  const order = await dbFetch<{ id: number; user_id: number }>(env.DB, 'SELECT id, user_id FROM mv_orders WHERE id = ? AND user_id = ?', [orderId, session.user_id]);
  if (!order) return Errors.notFound('Orden');

  const disputeId = await dbInsert(
    env.DB,
    'INSERT INTO mv_disputes (user_id, order_id, reason) VALUES (?, ?, ?)',
    [session.user_id, orderId, reason],
  );
  await sendAdminNotification(
    env,
    `🚨 Impugnación cargo: orden #${orderId}`,
    `<p><strong>Usuario:</strong> ${session.email}</p><p><strong>Orden:</strong> ${orderId}</p><p><strong>Motivo:</strong> ${reason}</p>`,
    '🚨',
  );
  await auditLog(env, { event_type: AuditEvents.PAYMENT_DISPUTED, actor_type: 'user', actor_id: session.user_id, target_user_id: session.user_id, request: req, details: { order_id: orderId, dispute_id: disputeId } });
  return jsonOk({ message: 'Impugnación registrada. Te contactaremos en menos de 15 minutos.', dispute_id: disputeId });
}

// =====================================================================
// CALLBACK Flow — PÚBLICO, firma verificada, idempotente
// =====================================================================

async function handleCallback(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  if (req.method !== 'POST') return Errors.methodNotAllowed();

  // Rate limit defensivo
  const ipKey = req.headers.get('cf-connecting-ip') ?? 'unknown';
  const rlKey = `rl:flow_callback:${ipKey}`;
  const rlVal = parseInt((await env.KV_RATE_LIMIT.get(rlKey)) ?? '0', 10);
  if (rlVal > 100) return new Response('rate_limited', { status: 429 });
  await env.KV_RATE_LIMIT.put(rlKey, String(rlVal + 1), { expirationTtl: 60 });

  // Leer form data
  const formData = await req.formData();

  // 1. Verificar firma Flow (CRÍTICO — resuelve hallazgo auditoría)
  const validSig = await verifyCallbackSignature(formData, env.MV_FLOW_SECRET);
  if (!validSig) {
    await auditLog(env, { event_type: AuditEvents.PAYMENT_CALLBACK_INVALID_SIG, actor_type: 'external', request: req });
    return new Response('invalid signature', { status: 401 });
  }

  const flowToken = String(formData.get('token') ?? '');
  if (!flowToken) return new Response('no token', { status: 400 });

  // 2. Obtener status real desde Flow (no confiar en datos del POST)
  const status = await flowGetPaymentStatus(env, flowToken);
  if (!status || status.status === 0 || !status.commerceOrder) {
    return new Response('cannot get status', { status: 400 });
  }

  // 3. Parse commerceOrder para obtener order_id
  const orderId = parseCommerceOrder(String(status.commerceOrder));
  if (!orderId) return new Response('bad commerce order', { status: 400 });

  const order = await dbFetch<{ id: number; user_id: number; monto: number; status: string }>(
    env.DB,
    'SELECT id, user_id, monto, status FROM mv_orders WHERE id = ?',
    [orderId],
  );
  if (!order) return new Response('order not found', { status: 404 });

  // 4. Validar amount
  const flowAmount = parseInt(String(status.amount ?? '0'), 10);
  const amountOk = flowAmount === order.monto;

  // 5. Idempotencia: INSERT OR IGNORE en mv_payment_callbacks
  const inserted = await dbInsertIfNotExists(
    env.DB,
    `INSERT OR IGNORE INTO mv_payment_callbacks
       (flow_token, order_id, user_id, flow_status, amount, raw_payload, signature_ok, amount_ok)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      flowToken,
      orderId,
      order.user_id,
      Number(status.status ?? 0),
      flowAmount,
      JSON.stringify(status).slice(0, 4000),
      amountOk ? 1 : 0,
    ],
  );

  if (!inserted) {
    // Ya procesado: 200 OK silencioso para que Flow deje de reintentar
    await auditLog(env, { event_type: AuditEvents.PAYMENT_CALLBACK_DUPLICATE, actor_type: 'external', target_user_id: order.user_id, request: req, details: { token: flowToken, order_id: orderId } });
    return new Response('ok (duplicate)', { status: 200 });
  }

  if (!amountOk) {
    await auditLog(env, {
      event_type: AuditEvents.PAYMENT_CALLBACK_AMOUNT_MISMATCH,
      actor_type: 'external',
      target_user_id: order.user_id,
      request: req,
      details: { expected: order.monto, got: flowAmount, order_id: orderId },
    });
    await sendAdminNotification(
      env,
      `🚨 SECURITY: Amount mismatch order #${orderId}`,
      `<p>Esperado: $${order.monto}</p><p>Recibido: $${flowAmount}</p><p>Token: ${flowToken}</p>`,
      '🚨',
    );
    return new Response('amount mismatch', { status: 400 });
  }

  // 6. Actualizar estado según FLOW_STATUS
  const flowStatus = Number(status.status);
  if (flowStatus === FLOW_STATUS.PAID && order.status !== 'paid') {
    await dbBatch(env.DB, [
      env.DB.prepare(`UPDATE mv_orders SET status = 'paid', payment_id = ? WHERE id = ?`).bind(String(status.flowOrder ?? ''), orderId),
      env.DB.prepare(`UPDATE mv_users SET payment_verified = 1, last_payment_failed_at = NULL WHERE id = ?`).bind(order.user_id),
    ]);
    await auditLog(env, { event_type: AuditEvents.PAYMENT_PAID, actor_type: 'external', target_user_id: order.user_id, request: req, details: { order_id: orderId, amount: flowAmount } });

    // Notificar usuario y admin
    const user = await dbFetch<{ email: string; nombre: string }>(env.DB, 'SELECT email, nombre FROM mv_users WHERE id = ?', [order.user_id]);
    if (user) {
      await queueEmail(env, {
        to: user.email,
        subject: '✅ Pago confirmado - Mentis Viva',
        html: buildEmailLayout(
          'Pago confirmado',
          `<p>Hola ${user.nombre},</p><p>Tu cobro de $${flowAmount.toLocaleString('es-CL')} fue procesado.</p><p>Tu próxima caja se despacha el 25.</p>`,
        ),
      });
    }
  } else if (flowStatus === FLOW_STATUS.REJECTED) {
    await dbExec(env.DB, `UPDATE mv_orders SET status = 'failed' WHERE id = ?`, [orderId]);
    await dbExec(env.DB, `UPDATE mv_users SET payment_verified = 0, last_payment_failed_at = ? WHERE id = ?`, [nowISO(), order.user_id]);
    await auditLog(env, { event_type: AuditEvents.PAYMENT_FAILED, actor_type: 'external', target_user_id: order.user_id, request: req, details: { order_id: orderId } });

    const user = await dbFetch<{ email: string; nombre: string }>(env.DB, 'SELECT email, nombre FROM mv_users WHERE id = ?', [order.user_id]);
    if (user) {
      await queueEmail(env, {
        to: user.email,
        subject: '⚠️ Tu pago fue rechazado - Mentis Viva',
        html: buildEmailLayout(
          'No pudimos procesar tu pago',
          `<p>Hola ${user.nombre},</p>
           <p>Tu banco rechazó el cobro. Esto suele deberse a tarjeta vencida o fondos insuficientes.</p>
           <p>Actualiza tu tarjeta antes del próximo cobro para que tu caja siga llegando puntual.</p>`,
          { label: 'Actualizar tarjeta', url: `${env.SITE_URL}/cuenta.html?action=change_card` },
        ),
      });
    }
  } else if (flowStatus === FLOW_STATUS.CANCELLED) {
    await dbExec(env.DB, `UPDATE mv_orders SET status = 'cancelled' WHERE id = ?`, [orderId]);
  }

  // 7. Forward async a contable.mentisviva.cl (idempotente con webhook queue)
  try {
    const payload: Record<string, string> = {};
    const fdEntries = (formData as unknown as { entries(): IterableIterator<[string, FormDataEntryValue]> }).entries();
    for (const [k, v] of fdEntries) payload[k] = String(v);
    await env.Q_WEBHOOKS.send({
      endpoint: 'contable',
      url: 'https://contable.mentisviva.cl/api/flow/webhook',
      payload,
      attempt: 0,
    });
  } catch (err) {
    console.error('[callback] forward enqueue failed', err);
  }

  return new Response('ok', { status: 200 });
}

async function handleReturn(req: Request, env: Env): Promise<Response> {
  // Flow redirige aquí post-pago. Redirigimos al frontend.
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  // El callback ya procesó. Aquí solo informamos al usuario.
  const status = token ? await flowGetPaymentStatus(env, token) : null;
  const queryStr = status?.status === FLOW_STATUS.PAID ? 'payment=success' : 'payment=pending';
  return new Response('', { status: 302, headers: { Location: `${env.SITE_URL}/cuenta.html?${queryStr}` } });
}

// =====================================================================
// Helpers
// =====================================================================

interface PlanInfo { amount: number; }

async function loadAllowedPlans(env: Env): Promise<Record<string, PlanInfo>> {
  // En producción: leer del CMS (mv_content). Aquí cargamos del último publicado.
  const row = await dbFetch<{ content: string }>(
    env.DB,
    'SELECT content FROM mv_content WHERE published = 1 ORDER BY version DESC LIMIT 1',
  );
  const result: Record<string, PlanInfo> = {};
  if (!row) return result;
  try {
    const data = JSON.parse(row.content) as { editorial?: { planes?: Array<{ nombre: string; precio: string }> } };
    const planes = data.editorial?.planes ?? [];
    for (const p of planes) {
      const amount = parseInt(String(p.precio ?? '0').replace(/[^\d]/g, ''), 10);
      if (p.nombre && amount > 0 && amount < 500_000) {
        result[p.nombre] = { amount };
      }
    }
  } catch {}
  return result;
}
