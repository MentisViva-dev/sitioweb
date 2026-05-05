/**
 * Monitoring — usage limits + email queue health.
 *
 * Detecta proximidad a los límites del free tier de Cloudflare antes de que
 * un día normal se convierta en outage. Envía email al admin (no bloquea
 * peticiones — sólo observabilidad).
 *
 * Free-tier reference (CF Workers, abril 2026):
 *   - Workers requests:  100k/día (3M/mes aprox.)
 *   - D1 reads:          5M/mes (≈ 167k/día)
 *   - D1 writes:         100k/día
 *   - KV reads:          100k/día
 *   - KV writes:         1k/día
 *
 * Counters:
 *   - usage:requests:YYYY-MM         → contador mensual de fetch (mayor utilidad de "Workers")
 *   - usage:d1_reads:YYYY-MM-DD      → opcional (no instrumentado todavía: D1 hace varias reads por request)
 *   - usage:kv_reads:YYYY-MM-DD      → ídem
 *
 * Para el alert principal (Workers requests) usamos el counter mensual.
 * Para D1/KV — sin un dashboard interno o exporter, usamos heurísticas
 * conservadoras basadas en el counter de requests (~3 D1 reads por request,
 * ~2 KV reads). Mejor que nada hasta integrar Cloudflare Analytics API.
 *
 * Race condition: KV no es atómico. getWithMetadata + put puede perder
 * incrementos bajo concurrencia. Aceptable para alertas (margen ±5%).
 * Si se necesita exactitud: migrar a Durable Object counter.
 */

import type { Env } from '../types/env';
import { dbFetch } from '../lib/db';
import { sendAdminNotification } from '../lib/email';

// ---------------------------------------------------------------------------
// Free-tier limits (sintonizados a abril 2026 — revisar si CF cambia política)
// ---------------------------------------------------------------------------
const LIMITS = {
  WORKERS_MONTHLY: 100_000 * 30,    // 3M/mes (100k/día × 30)
  D1_READS_DAILY: 167_000,          // 5M/mes / 30
  KV_READS_DAILY: 100_000,
  EMAIL_QUEUE_STUCK: 50,            // pending > 50 por > 24h
};

const THRESHOLDS = {
  WORKERS: 0.80,                    // 80%
  D1: 0.90,                         // 90%
  KV: 0.90,                         // 90%
};

// ---------------------------------------------------------------------------
// Increment helper — KV-based counter (NOT atomic; documented race)
// ---------------------------------------------------------------------------

/**
 * Incrementa un counter en KV. No-atómico: bajo concurrencia podemos perder
 * algunos incrementos. Aceptable para monitoring (no billing).
 *
 * key esperada: "usage:<scope>:<period>" — p.ej. "usage:requests:2026-05"
 */
export async function incrementUsageCounter(
  env: Env,
  key: string,
  ttlSeconds = 60 * 60 * 24 * 32,
): Promise<void> {
  try {
    const current = await env.KV_CACHE.get(key);
    const next = (current ? parseInt(current, 10) : 0) + 1;
    await env.KV_CACHE.put(key, String(next), { expirationTtl: ttlSeconds });
  } catch (err) {
    // Counter no debe romper requests
    console.error('[monitoring] increment failed', key, err);
  }
}

/** Llave del counter mensual de requests para el mes actual (UTC). */
export function monthlyRequestsKey(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `usage:requests:${y}-${m}`;
}

// ---------------------------------------------------------------------------
// Check usage limits — invocado desde cron diario
// ---------------------------------------------------------------------------

interface AlertEntry {
  metric: string;
  current: number;
  limit: number;
  percent: number;
}

export async function checkUsageLimits(env: Env): Promise<{ alerts: AlertEntry[] }> {
  const alerts: AlertEntry[] = [];
  const now = new Date();

  // 1. Workers requests (mensual)
  const monthlyKey = monthlyRequestsKey(now);
  const monthlyStr = await env.KV_CACHE.get(monthlyKey);
  const monthlyReqs = monthlyStr ? parseInt(monthlyStr, 10) : 0;
  const reqRatio = monthlyReqs / LIMITS.WORKERS_MONTHLY;
  if (reqRatio >= THRESHOLDS.WORKERS) {
    alerts.push({
      metric: 'Workers requests (mensual)',
      current: monthlyReqs,
      limit: LIMITS.WORKERS_MONTHLY,
      percent: Math.round(reqRatio * 100),
    });
  }

  // 2. D1 reads (diario, heurístico: ~3 reads por request)
  // Sin dashboard nativo, estimamos. Aceptable como early-warning.
  const todayReqs = monthlyReqs / Math.max(1, now.getUTCDate());
  const estD1Reads = todayReqs * 3;
  const d1Ratio = estD1Reads / LIMITS.D1_READS_DAILY;
  if (d1Ratio >= THRESHOLDS.D1) {
    alerts.push({
      metric: 'D1 reads (diario, estimado)',
      current: Math.round(estD1Reads),
      limit: LIMITS.D1_READS_DAILY,
      percent: Math.round(d1Ratio * 100),
    });
  }

  // 3. KV reads (diario, heurístico: ~2 reads por request)
  const estKvReads = todayReqs * 2;
  const kvRatio = estKvReads / LIMITS.KV_READS_DAILY;
  if (kvRatio >= THRESHOLDS.KV) {
    alerts.push({
      metric: 'KV reads (diario, estimado)',
      current: Math.round(estKvReads),
      limit: LIMITS.KV_READS_DAILY,
      percent: Math.round(kvRatio * 100),
    });
  }

  // 4. Email queue stuck (> 50 pending por > 24h)
  const stuck = await dbFetch<{ count: number }>(
    env.DB,
    `SELECT COUNT(*) as count FROM mv_email_queue
     WHERE status = 'pending' AND created_at < datetime('now', '-1 day')`,
  );
  const stuckCount = stuck?.count ?? 0;
  if (stuckCount > LIMITS.EMAIL_QUEUE_STUCK) {
    alerts.push({
      metric: 'Email queue (pending > 24h)',
      current: stuckCount,
      limit: LIMITS.EMAIL_QUEUE_STUCK,
      percent: Math.round((stuckCount / LIMITS.EMAIL_QUEUE_STUCK) * 100),
    });
  }

  // 5. Email queue failed (intentos agotados, antiguos > 24h)
  const failed = await dbFetch<{ count: number }>(
    env.DB,
    `SELECT COUNT(*) as count FROM mv_email_queue
     WHERE status = 'failed' AND attempts >= max_attempts
       AND created_at < datetime('now', '-1 day')`,
  );
  const failedCount = failed?.count ?? 0;
  if (failedCount > 0) {
    alerts.push({
      metric: 'Email queue (failed > 24h, attempts agotados)',
      current: failedCount,
      limit: 0,
      percent: 100,
    });
  }

  // Si hay alertas, mandar email al admin
  if (alerts.length > 0) {
    await sendAlertEmail(env, alerts);
  }

  return { alerts };
}

async function sendAlertEmail(env: Env, alerts: AlertEntry[]): Promise<void> {
  const rows = alerts
    .map(
      a =>
        `<tr>
          <td style="padding:8px;border-bottom:1px solid #eee">${escapeHtml(a.metric)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${a.current.toLocaleString()}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${a.limit.toLocaleString()}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;color:${a.percent >= 90 ? '#c0392b' : '#e67e22'}">
            <strong>${a.percent}%</strong>
          </td>
        </tr>`,
    )
    .join('');

  const html = `
    <p>Se detectaron métricas cerca o sobre los límites del free tier de Cloudflare.</p>
    <table style="width:100%;border-collapse:collapse;margin-top:12px">
      <thead>
        <tr style="background:#f5f5f5">
          <th style="padding:8px;text-align:left">Métrica</th>
          <th style="padding:8px;text-align:right">Actual</th>
          <th style="padding:8px;text-align:right">Límite</th>
          <th style="padding:8px;text-align:right">%</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:16px;color:#6c757d;font-size:0.85rem">
      Counter de requests almacenado en KV (no atómico — margen ±5%).
      D1/KV son heurísticas hasta integrar Cloudflare Analytics API.
    </p>`;

  await sendAdminNotification(env, 'Alerta de límites Cloudflare', html, '⚠️');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
