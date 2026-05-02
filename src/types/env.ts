/**
 * Cloudflare Workers Environment Bindings
 *
 * Tipos para todos los bindings declarados en wrangler.toml.
 * Usar `Env` como tipo del 2do parámetro en handlers de Worker:
 *
 *   export default {
 *     async fetch(req: Request, env: Env, ctx: ExecutionContext) { ... }
 *   }
 */

import type {
  D1Database,
  KVNamespace,
  R2Bucket,
  Queue,
  Fetcher,
  ExecutionContext,
} from '@cloudflare/workers-types';

/** Mensajes que se encolan en Q_CHARGES (cobro mensual) */
export interface ChargeJobPayload {
  user_id: number;
  shipment_month: string; // YYYY-MM
  attempt: number;
  triggered_at: string;   // ISO8601
}

/** Mensajes que se encolan en Q_EMAILS */
export interface EmailJobPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
  template?: string;
  idempotency_key?: string;
}

/** Mensajes que se encolan en Q_WEBHOOKS */
export interface WebhookJobPayload {
  endpoint: string;       // 'contable', 'analytics', etc.
  url: string;
  payload: Record<string, unknown>;
  headers?: Record<string, string>;
  attempt: number;
}

/** Variables de entorno y bindings disponibles en cualquier Worker */
export interface Env {
  // ---------- Variables públicas (de wrangler.toml [vars]) ----------
  ENVIRONMENT: 'production' | 'staging' | 'development';
  SITE_URL: string;
  API_URL: string;
  ADMIN_NOTIFY_EMAIL: string;
  EMAIL_FROM: string;
  EMAIL_REPLY_TO: string;
  FLOW_API_URL: string;
  SHIPIT_API_URL: string;
  RECAPTCHA_SITE_KEY: string;
  TERMS_VERSION: string;
  PRIVACY_VERSION: string;

  // ---------- Secrets (cargados con `wrangler secret put`) ----------
  /** HMAC secret para firmar tokens de sesión */
  MV_TOKEN_SECRET: string;
  /** Flow.cl API Key */
  MV_FLOW_API_KEY: string;
  /** Flow.cl Secret (HMAC) */
  MV_FLOW_SECRET: string;
  /** reCAPTCHA v3 Secret Key */
  MV_RECAPTCHA_SECRET: string;
  /** Resend API Key (email outbound) */
  MV_RESEND_KEY: string;
  /** Shipit API Token */
  MV_SHIPIT_TOKEN: string;
  /** Shipit email cuenta */
  MV_SHIPIT_EMAIL: string;
  /** Cron secret (validar invocaciones manuales) */
  MV_CRON_SECRET: string;
  /** Forward webhook secret (firma a contable.mentisviva.cl) */
  MV_FORWARD_SECRET: string;
  /** Admin password (placeholder, mejor usar mv_admins) */
  MV_ADMIN_USER_HASH?: string;
  MV_ADMIN_PASS_HASH?: string;
  /** Sentry DSN (opcional, observabilidad) */
  MV_SENTRY_DSN?: string;

  // ---------- D1 Database ----------
  DB: D1Database;

  // ---------- KV Namespaces ----------
  /** Sesiones de usuario (token → user_id) */
  KV: KVNamespace;
  /** Rate limiting counters */
  KV_RATE_LIMIT: KVNamespace;
  /** Cache general (content.json, queries calientes) */
  KV_CACHE: KVNamespace;

  // ---------- R2 ----------
  /** Bucket de uploads (portadas, imágenes CMS) */
  R2: R2Bucket;

  // ---------- Queues ----------
  Q_CHARGES: Queue<ChargeJobPayload>;
  Q_EMAILS: Queue<EmailJobPayload>;
  Q_WEBHOOKS: Queue<WebhookJobPayload>;

  // ---------- Service Bindings (sub-Workers) ----------
  AUTH_WORKER: Fetcher;
  PAY_WORKER: Fetcher;
  SHIPPING_WORKER: Fetcher;
  PROFILE_WORKER: Fetcher;
  ADMIN_WORKER: Fetcher;
  FORMS_WORKER: Fetcher;
}

/** Re-export ExecutionContext para conveniencia */
export type { ExecutionContext };

/** Sesión autenticada extraída de cookie/token */
export interface AuthSession {
  user_id: number;
  email: string;
  nombre: string;
  apellido: string | null;
  plan_nombre: string | null;
  plan_status: 'none' | 'pending' | 'active' | 'cancelled' | 'cancel_pending' | 'paused';
  is_admin: boolean;
  admin_id?: number;
  admin_role?: 'superadmin' | 'admin' | 'editor' | 'viewer';
}

/** Resultado estándar de operaciones */
export interface OperationResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}
