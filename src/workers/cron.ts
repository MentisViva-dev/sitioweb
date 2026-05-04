/**
 * Cron Worker — tareas programadas + Queue consumer.
 *
 * scheduled() — llamado por Cron Triggers según wrangler.toml.
 * queueConsumer() — llamado cuando hay mensajes en Q_CHARGES, Q_EMAILS, Q_WEBHOOKS.
 */

import type { Env, ExecutionContext, ChargeJobPayload, EmailJobPayload, WebhookJobPayload } from '../types/env';
import { dbFetch, dbFetchAll, dbInsert, dbExec } from '../lib/db';
import { auditLog, AuditEvents } from '../lib/audit';
import { sendEmail, sendAdminNotification, queueEmail } from '../lib/email';
import {
  flowGetPaymentStatus, flowCancelSubscription,
  flowDeleteCustomer, FLOW_STATUS,
} from '../lib/flow';
import { hmacSha256 } from '../lib/crypto';
import {
  determineNextShipmentDate, calculateCutoffDate,
  shipmentMonthStr, formatISODate, nowISO,
} from '../lib/dates';

// =====================================================================
// SCHEDULED — entrypoint para cron triggers
// =====================================================================

export async function scheduled(event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
  const cronExpr = event.cron;
  const now = new Date(event.scheduledTime);

  try {
    if (cronExpr === '*/5 * * * *') {
      await processEmailQueueFallback(env);
    } else if (cronExpr === '0 * * * *') {
      await syncFlowSubscriptions(env);
    } else if (cronExpr === '0 */6 * * *') {
      await cleanup(env);
    } else if (cronExpr === '0 3 * * *') {
      await dailyTasks(env, now);
    } else if (cronExpr === '0 3 * * 7' || cronExpr === '0 3 * * 0') {
      // wrangler.toml usa "7" para domingo (POSIX); cron también acepta "0".
      // Aceptamos ambos para evitar drift si se renombra en wrangler.
      await weeklyTasks(env);
    } else if (cronExpr === '0 9 12 * *') {
      // El cron del día 12 es informativo; el día real del cutoff puede variar.
      // dailyTasks() hace el dispatch real cuando la fecha coincide con el cutoff.
      await maybeMonthlyCutoff(env, now);
    }
    await auditLog(env, { event_type: AuditEvents.CRON_RAN, actor_type: 'cron', details: { cron: cronExpr } });
  } catch (err) {
    console.error('[cron] failed', cronExpr, err);
    await auditLog(env, { event_type: AuditEvents.CRON_FAILED, actor_type: 'cron', details: { cron: cronExpr, error: (err as Error).message } });
  }
}

// =====================================================================
// QUEUE CONSUMER — procesa mensajes de Q_CHARGES, Q_EMAILS, Q_WEBHOOKS
// =====================================================================

export async function queueConsumer(
  batch: MessageBatch<ChargeJobPayload | EmailJobPayload | WebhookJobPayload>,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      switch (batch.queue) {
        case 'q-charges':
          await processChargeJob(env, msg.body as ChargeJobPayload);
          break;
        case 'q-emails':
          await processEmailJob(env, msg.body as EmailJobPayload);
          break;
        case 'q-webhooks':
          await processWebhookJob(env, msg.body as WebhookJobPayload);
          break;
      }
      msg.ack();
    } catch (err) {
      console.error(`[queue ${batch.queue}] msg failed`, err);
      msg.retry({ delaySeconds: 30 * (msg.attempts ?? 1) });
    }
  }
}

// =====================================================================
// MONTHLY CUTOFF — dispatch a Q_CHARGES
// =====================================================================

async function maybeMonthlyCutoff(env: Env, now: Date): Promise<void> {
  // Calcular cutoff del mes ACTUAL
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const cutoff = calculateCutoffDate(year, month);

  // Solo correr si HOY es el día del cutoff
  if (formatISODate(now) !== formatISODate(cutoff)) {
    return;
  }

  // Lock para evitar doble ejecución
  const lockKey = `cutoff:${year}-${month}`;
  const existing = await env.KV.get(lockKey);
  if (existing) return;
  await env.KV.put(lockKey, nowISO(), { expirationTtl: 86400 });

  // 1. Lock shipping para todos los activos
  await dbExec(env.DB, `UPDATE mv_users SET shipping_locked = 1 WHERE plan_status = 'active' AND shipping_locked = 0`);

  // 2. Despachar cobros: encolar 1 mensaje por usuario activo
  const users = await dbFetchAll<{ id: number }>(
    env.DB,
    `SELECT id FROM mv_users WHERE plan_status = 'active' AND payment_verified IN (0, 1) AND email_bouncing = 0`,
  );
  const shipMonth = shipmentMonthStr(determineNextShipmentDate(now));
  for (const u of users) {
    await env.Q_CHARGES.send({
      user_id: u.id,
      shipment_month: shipMonth,
      attempt: 0,
      triggered_at: nowISO(),
    });
  }

  // 3. Build roster (snapshot de despachos)
  await buildRoster(env, shipMonth);

  await auditLog(env, { event_type: 'cron.monthly_cutoff', actor_type: 'cron', details: { users: users.length, ship_month: shipMonth } });
  await sendAdminNotification(env, `🚚 Cutoff mensual ejecutado`, `<p>${users.length} usuarios encolados para cobro y despacho de ${shipMonth}.</p>`, '🚚');
}

async function buildRoster(env: Env, shipmentMonth: string): Promise<void> {
  const users = await dbFetchAll<{
    id: number; plan_nombre: string; shipping_method: string; shipping_cost: number;
    direccion: string | null; numero: string | null; depto: string | null;
    comuna: string | null; ciudad: string | null; region: string | null;
    codigo_postal: string | null; telefono: string | null;
  }>(
    env.DB,
    `SELECT id, plan_nombre, shipping_method, shipping_cost, direccion, numero, depto,
       comuna, ciudad, region, codigo_postal, telefono
     FROM mv_users WHERE plan_status = 'active' AND payment_verified = 1`,
  );
  for (const u of users) {
    const address = JSON.stringify({
      direccion: u.direccion, numero: u.numero, depto: u.depto,
      comuna: u.comuna, ciudad: u.ciudad, region: u.region,
      codigo_postal: u.codigo_postal, telefono: u.telefono,
    });
    await dbExec(
      env.DB,
      `INSERT OR IGNORE INTO mv_shipment_roster
         (user_id, shipment_month, plan_nombre, shipping_method, shipping_cost, shipping_address, status)
       VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
      [u.id, shipmentMonth, u.plan_nombre, u.shipping_method, u.shipping_cost, address],
    );
  }
}

// =====================================================================
// PROCESS CHARGE JOB — un cobro por usuario
// =====================================================================

async function processChargeJob(env: Env, payload: ChargeJobPayload): Promise<void> {
  const { user_id, shipment_month, attempt: _attempt } = payload;
  const user = await dbFetch<{
    flow_subscription_id: string | null; email: string; nombre: string;
    plan_nombre: string | null; shipping_cost: number; shipping_method: string | null;
    plan_status: string;
  }>(
    env.DB,
    `SELECT flow_subscription_id, email, nombre, plan_nombre, shipping_cost, shipping_method, plan_status
     FROM mv_users WHERE id = ?`,
    [user_id],
  );
  if (!user || user.plan_status !== 'active' || !user.flow_subscription_id) return;

  // Verificar si ya hay orden para este shipment_month (idempotencia)
  const existing = await dbFetch<{ id: number }>(
    env.DB,
    `SELECT id FROM mv_orders WHERE user_id = ? AND shipment_month = ? AND status IN ('active','paid')`,
    [user_id, shipment_month],
  );
  if (existing) return; // ya procesado

  const totalAmount = (user.shipping_cost ?? 0); // El plan se cobra automáticamente vía Flow subscription
  // Crear orden "active" — Flow envía callback que la pasa a "paid"
  await dbInsert(
    env.DB,
    `INSERT INTO mv_orders
       (user_id, plan_nombre, monto, shipping_monto, status, payment_method,
        payment_id, shipping_method, shipment_month, flow_subscription_id)
     VALUES (?, ?, ?, ?, 'active', 'flow_subscription', '', ?, ?, ?)`,
    [user_id, user.plan_nombre, totalAmount, user.shipping_cost, user.shipping_method, shipment_month, user.flow_subscription_id],
  );

  // Avisar usuario
  await env.Q_EMAILS.send({
    to: user.email,
    subject: `📦 Tu próxima caja sale el 25 - Mentis Viva`,
    html: `<p>Hola ${user.nombre},</p><p>Tu cobro mensual fue procesado y tu caja se despachará el 25.</p>`,
    idempotency_key: `charge_notify:${user_id}:${shipment_month}`,
  });
}

// =====================================================================
// PROCESS EMAIL JOB
// =====================================================================

async function processEmailJob(env: Env, payload: EmailJobPayload): Promise<void> {
  const result = await sendEmail(env, payload);
  if (!result.ok) {
    throw new Error(`Email failed: ${result.error}`);
  }
}

async function processEmailQueueFallback(env: Env): Promise<void> {
  // Fallback para emails que estén en la tabla mv_email_queue (importados de PHP legacy)
  const emails = await dbFetchAll<{
    id: number; to_email: string; subject: string; html_body: string; attempts: number; max_attempts: number;
  }>(
    env.DB,
    `SELECT id, to_email, subject, html_body, attempts, max_attempts FROM mv_email_queue
     WHERE status = 'pending' AND attempts < max_attempts ORDER BY id ASC LIMIT 10`,
  );
  for (const e of emails) {
    const result = await sendEmail(env, { to: e.to_email, subject: e.subject, html: e.html_body });
    if (result.ok) {
      await dbExec(env.DB, `UPDATE mv_email_queue SET status = 'sent', sent_at = ? WHERE id = ?`, [nowISO(), e.id]);
    } else {
      const newAttempts = e.attempts + 1;
      await dbExec(
        env.DB,
        `UPDATE mv_email_queue SET attempts = ?, status = ?, error_message = ? WHERE id = ?`,
        [newAttempts, newAttempts >= e.max_attempts ? 'failed' : 'pending', result.error?.slice(0, 500) ?? null, e.id],
      );
    }
  }
}

// =====================================================================
// PROCESS WEBHOOK JOB (forward a contable.mentisviva.cl)
// =====================================================================

async function processWebhookJob(env: Env, payload: WebhookJobPayload): Promise<void> {
  const ts = String(Math.floor(Date.now() / 1000));
  const bodyStr = JSON.stringify(payload.payload);
  const sig = await hmacSha256(env.MV_FORWARD_SECRET, ts + '.' + bodyStr);

  let resp: Response;
  try {
    resp = await fetch(payload.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MV-Timestamp': ts,
        'X-MV-Signature': sig,
        ...(payload.headers ?? {}),
      },
      body: bodyStr,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new Error(`webhook network: ${(err as Error).message}`);
  }
  if (!resp.ok) {
    throw new Error(`webhook http_${resp.status}`);
  }
  await auditLog(env, { event_type: AuditEvents.WEBHOOK_FORWARDED, actor_type: 'cron', details: { endpoint: payload.endpoint, url: payload.url } });
}

// =====================================================================
// SYNC FLOW (cada hora)
// =====================================================================

async function syncFlowSubscriptions(env: Env): Promise<void> {
  // Reconciliar órdenes "active" sin payment confirmado en > 2h
  const stale = await dbFetchAll<{ id: number; user_id: number; payment_id: string }>(
    env.DB,
    `SELECT id, user_id, payment_id FROM mv_orders
     WHERE status = 'active' AND created_at < datetime('now', '-2 hours') LIMIT 50`,
  );
  for (const o of stale) {
    if (!o.payment_id) continue;
    const status = await flowGetPaymentStatus(env, o.payment_id);
    if (status?.status === FLOW_STATUS.PAID) {
      await dbExec(env.DB, `UPDATE mv_orders SET status = 'paid' WHERE id = ?`, [o.id]);
    } else if (status?.status === FLOW_STATUS.REJECTED) {
      await dbExec(env.DB, `UPDATE mv_orders SET status = 'failed' WHERE id = ?`, [o.id]);
    }
  }
}

// =====================================================================
// CLEANUP (cada 6h)
// =====================================================================

async function cleanup(env: Env): Promise<void> {
  await dbExec(env.DB, `UPDATE mv_users SET payment_pending = 0, payment_pending_expires = NULL WHERE payment_pending = 1 AND payment_pending_expires < ?`, [nowISO()]);
  await dbExec(env.DB, `UPDATE mv_users SET verify_token = NULL, verify_token_expires = NULL WHERE verify_token_expires < ?`, [nowISO()]);
  await dbExec(env.DB, `UPDATE mv_users SET reset_token = NULL, reset_token_expires = NULL WHERE reset_token_expires < ?`, [nowISO()]);
  await dbExec(env.DB, `UPDATE mv_users SET email_change_token = NULL, email_change_new_email = NULL, email_change_expires = NULL WHERE email_change_expires < ?`, [nowISO()]);
  await dbExec(env.DB, `UPDATE mv_users SET deletion_token = NULL, deletion_expires = NULL WHERE deletion_expires < ?`, [nowISO()]);
  await dbExec(env.DB, `DELETE FROM mv_audit_log WHERE created_at < datetime('now', '-365 days')`);
}

// =====================================================================
// DAILY TASKS (03:00 UTC)
// =====================================================================

async function dailyTasks(env: Env, now: Date): Promise<void> {
  // 1. Si HOY es día 26: unlock shipping de todos los suscriptores
  const day = now.getUTCDate();
  if (day === 26) {
    await dbExec(env.DB, `UPDATE mv_users SET shipping_locked = 0 WHERE shipping_locked = 1`);
  }

  // 2. Procesar cancelaciones diferidas vencidas
  const pending = await dbFetchAll<{ id: number; flow_customer_id: string | null; flow_subscription_id: string | null; email: string; nombre: string }>(
    env.DB,
    `SELECT id, flow_customer_id, flow_subscription_id, email, nombre FROM mv_users
     WHERE plan_status = 'cancel_pending' AND cancel_effective_date <= date('now')`,
  );
  for (const u of pending) {
    if (u.flow_subscription_id) await flowCancelSubscription(env, u.flow_subscription_id);
    if (u.flow_customer_id) await flowDeleteCustomer(env, u.flow_customer_id);
    await dbExec(
      env.DB,
      `UPDATE mv_users SET plan_status = 'none', plan_nombre = NULL, flow_customer_id = NULL,
        flow_subscription_id = NULL, shipping_method = NULL, shipping_cost = 0,
        next_shipment_date = NULL, cancel_effective_date = NULL WHERE id = ?`,
      [u.id],
    );
    await queueEmail(env, {
      to: u.email,
      subject: 'Suscripción finalizada - Mentis Viva',
      html: `<p>Hola ${u.nombre},</p><p>Tu suscripción finalizó como solicitaste.</p>`,
    });
  }

  // 3. Reactivar suscripciones pausadas vencidas
  const toResume = await dbFetchAll<{ id: number; email: string; nombre: string }>(
    env.DB,
    `SELECT id, email, nombre FROM mv_users WHERE plan_status = 'paused' AND paused_until <= date('now')`,
  );
  for (const u of toResume) {
    await dbExec(env.DB, `UPDATE mv_users SET plan_status = 'active', paused_until = NULL WHERE id = ?`, [u.id]);
    await queueEmail(env, { to: u.email, subject: 'Tu suscripción se reactivó - Mentis Viva', html: `<p>Hola ${u.nombre},</p><p>Tu pausa terminó. Tu próxima caja sale el 25.</p>` });
  }

  // 4. Avisos de cobro próximo (5 días antes del cutoff)
  // (omitido por brevedad — implementar similar a PHP cron.php notify_upcoming_payment)

  // 5. Verificar si HOY es día del cutoff y disparar el flujo
  await maybeMonthlyCutoff(env, now);
}

async function weeklyTasks(env: Env): Promise<void> {
  // Rotar audit_log si crece mucho, archivar emails enviados de >90 días
  await dbExec(env.DB, `DELETE FROM mv_email_queue WHERE status = 'sent' AND sent_at < datetime('now', '-90 days')`);
}
