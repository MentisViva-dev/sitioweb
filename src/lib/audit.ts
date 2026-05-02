/**
 * Audit log a mv_audit_log.
 *
 * Llamar `auditLog` en cada acción significativa:
 *   login, logout, password_change, email_change, subscribe, cancel,
 *   refund, plan_change, card_change, admin_action.
 *
 * NO loguear datos sensibles (password, token, número de tarjeta).
 * El parámetro `details` se serializa a JSON pero se pasa por sanitizer.
 */

import type { Env } from '../types/env';
import type { ActorType } from '../types/db';
import { dbInsert } from './db';
import { getClientIp, getUserAgent } from './auth';

export interface AuditLogParams {
  event_type: string;       // 'login', 'subscribe', etc.
  actor_type: ActorType;
  actor_id?: number | null;
  target_user_id?: number | null;
  details?: Record<string, unknown>;
  request?: Request;        // para extraer IP + UA automáticamente
  ip?: string;
  user_agent?: string;
}

const SENSITIVE_KEYS = new Set([
  'password', 'password_hash', 'token', 'secret', 'api_key',
  'card_number', 'cvv', 'reset_token', 'verify_token',
  'session_token', 'flow_token', 'authorization',
]);

function sanitizeDetails(details: unknown): unknown {
  if (details == null) return null;
  if (typeof details !== 'object') return details;
  if (Array.isArray(details)) return details.map(sanitizeDetails);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    const lk = k.toLowerCase();
    if (SENSITIVE_KEYS.has(lk) || lk.includes('password') || lk.includes('token') || lk.includes('secret')) {
      out[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      out[k] = sanitizeDetails(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function auditLog(env: Env, params: AuditLogParams): Promise<void> {
  try {
    let ip = params.ip ?? null;
    let ua = params.user_agent ?? null;
    if (params.request) {
      ip ??= getClientIp(params.request);
      ua ??= getUserAgent(params.request);
    }
    const details = sanitizeDetails(params.details ?? null);

    await dbInsert(
      env.DB,
      `INSERT INTO mv_audit_log
        (event_type, actor_type, actor_id, target_user_id, ip_address, user_agent, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        params.event_type,
        params.actor_type,
        params.actor_id ?? null,
        params.target_user_id ?? null,
        ip,
        ua ? ua.slice(0, 500) : null,
        details ? JSON.stringify(details) : null,
      ],
    );
  } catch (err) {
    // Audit log NUNCA debe fallar el request principal
    console.error('[auditLog] failed:', err);
  }
}

// =====================================================================
// Helpers tipados para los eventos más comunes
// =====================================================================

export const AuditEvents = {
  LOGIN_SUCCESS:        'login.success',
  LOGIN_FAILED:         'login.failed',
  LOGIN_RATE_LIMITED:   'login.rate_limited',
  LOGOUT:               'logout',
  LOGOUT_ALL:           'logout.all',
  REGISTER:             'auth.register',
  EMAIL_VERIFIED:       'auth.email_verified',
  PASSWORD_RESET_REQ:   'auth.password_reset_request',
  PASSWORD_RESET_DONE:  'auth.password_reset_done',
  PASSWORD_CHANGED:     'auth.password_changed',
  EMAIL_CHANGE_REQ:     'auth.email_change_request',
  EMAIL_CHANGE_DONE:    'auth.email_change_done',
  SECURITY_QUESTION_CHANGED: 'auth.security_question_changed',

  PROFILE_UPDATED:      'profile.updated',
  PROFILE_EXPORTED:     'profile.exported',
  ACCOUNT_DELETION_REQ: 'profile.deletion_request',
  ACCOUNT_DELETED:      'profile.deleted',

  SUBSCRIBE:            'subscription.created',
  SUBSCRIBE_FAILED:     'subscription.failed',
  CANCEL_IMMEDIATE:     'subscription.cancelled_immediate',
  CANCEL_DEFERRED:      'subscription.cancelled_deferred',
  CANCEL_UNDONE:        'subscription.cancel_undone',
  PLAN_CHANGED:         'subscription.plan_changed',
  PAUSED:               'subscription.paused',
  RESUMED:              'subscription.resumed',

  CARD_CHANGE_REQ:      'payment.card_change_request',
  CARD_CHANGE_DONE:     'payment.card_change_done',
  CARD_CHANGE_FAILED:   'payment.card_change_failed',

  PAYMENT_CALLBACK:     'payment.callback',
  PAYMENT_CALLBACK_INVALID_SIG: 'payment.callback.invalid_signature',
  PAYMENT_CALLBACK_DUPLICATE:   'payment.callback.duplicate',
  PAYMENT_CALLBACK_AMOUNT_MISMATCH: 'payment.callback.amount_mismatch',
  PAYMENT_PAID:         'payment.paid',
  PAYMENT_FAILED:       'payment.failed',
  PAYMENT_REFUNDED:     'payment.refunded',
  PAYMENT_DISPUTED:     'payment.disputed',

  SHIPPING_PREFERENCE_SAVED: 'shipping.preference_saved',
  SHIPPING_LOCKED:           'shipping.locked',
  SHIPPING_UNLOCKED:         'shipping.unlocked',
  ROSTER_GENERATED:          'shipping.roster_generated',
  PACKAGE_SHIPPED:           'shipping.package_shipped',

  ADMIN_LOGIN:          'admin.login',
  ADMIN_LOGOUT:         'admin.logout',
  ADMIN_CONTENT_PUB:    'admin.content_published',
  ADMIN_REFUND:         'admin.refund',
  ADMIN_USER_EDITED:    'admin.user_edited',

  CRON_RAN:             'cron.executed',
  CRON_FAILED:          'cron.failed',
  EMAIL_SENT:           'email.sent',
  EMAIL_FAILED:         'email.failed',
  WEBHOOK_FORWARDED:    'webhook.forwarded',
  WEBHOOK_FAILED:       'webhook.failed',
} as const;

export type AuditEvent = typeof AuditEvents[keyof typeof AuditEvents];
