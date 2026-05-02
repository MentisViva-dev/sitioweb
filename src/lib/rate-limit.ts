/**
 * Rate limiting con KV.
 *
 * Patrón: ventana deslizante por clave (acción + identificador).
 * KV key: rl:<action>:<identifier>
 * Value: array JSON de timestamps unix.
 *
 * Para mayor precisión usar Durable Objects con sliding window real,
 * pero a 200-20k usuarios KV alcanza con holgura.
 */

import type { Env } from '../types/env';
import { getClientIp } from './auth';

export interface RateLimitOptions {
  action: string;          // ej: 'login', 'register', 'password_reset'
  identifier: string;      // email, ip, user_id, etc.
  maxAttempts: number;     // máximo en la ventana
  windowSeconds: number;   // duración de la ventana
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;         // unix timestamp cuando se libera
}

export async function checkRateLimit(env: Env, opts: RateLimitOptions): Promise<RateLimitResult> {
  const key = `rl:${opts.action}:${opts.identifier}`;
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - opts.windowSeconds;

  // Leer ventana actual
  const raw = await env.KV_RATE_LIMIT.get(key);
  let timestamps: number[] = [];
  if (raw) {
    try {
      timestamps = JSON.parse(raw) as number[];
      timestamps = timestamps.filter(t => t > cutoff);
    } catch {
      timestamps = [];
    }
  }

  if (timestamps.length >= opts.maxAttempts) {
    const oldest = timestamps[0] ?? now;
    const resetAt = oldest + opts.windowSeconds;
    return { allowed: false, remaining: 0, resetAt };
  }

  // Permitir y registrar
  timestamps.push(now);
  await env.KV_RATE_LIMIT.put(key, JSON.stringify(timestamps), {
    expirationTtl: opts.windowSeconds + 60,
  });
  return {
    allowed: true,
    remaining: opts.maxAttempts - timestamps.length,
    resetAt: now + opts.windowSeconds,
  };
}

/** Rate limit por IP + acción */
export async function rateLimitByIp(
  env: Env,
  req: Request,
  action: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const ip = getClientIp(req);
  return checkRateLimit(env, { action, identifier: ip, maxAttempts, windowSeconds });
}

/** Rate limit por email + acción */
export async function rateLimitByEmail(
  env: Env,
  email: string,
  action: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  return checkRateLimit(env, {
    action,
    identifier: email.toLowerCase(),
    maxAttempts,
    windowSeconds,
  });
}

/** Rate limit por user_id (sesión activa) */
export async function rateLimitByUser(
  env: Env,
  userId: number,
  action: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  return checkRateLimit(env, {
    action,
    identifier: String(userId),
    maxAttempts,
    windowSeconds,
  });
}

/** Combined: ip+email para login (resuelve hallazgo de auditoría §1.3) */
export async function rateLimitLogin(env: Env, req: Request, email: string): Promise<RateLimitResult> {
  // Bloquea si IP o email superan límite separados
  const byIp = await rateLimitByIp(env, req, 'login_ip', 20, 900);
  if (!byIp.allowed) return byIp;
  const byEmail = await rateLimitByEmail(env, email, 'login_email', 5, 900);
  return byEmail;
}

// =====================================================================
// Constants comunes
// =====================================================================

export const RATE_LIMITS = {
  LOGIN_PER_IP:           { max: 20, window: 900 },     // 20 / 15min
  LOGIN_PER_EMAIL:        { max: 5,  window: 900 },     // 5 / 15min
  REGISTER:               { max: 3,  window: 900 },     // 3 / 15min
  FORGOT_PASSWORD:        { max: 3,  window: 3600 },    // 3 / hora
  RESET_PASSWORD:         { max: 5,  window: 900 },
  RESEND_VERIFICATION:    { max: 3,  window: 600 },
  CHANGE_PASSWORD:        { max: 2,  window: 86400 },   // 2 / día
  CHANGE_EMAIL:           { max: 3,  window: 3600 },
  PROFILE_UPDATE:         { max: 10, window: 900 },
  CHANGE_CARD:            { max: 5,  window: 3600 },
  CHANGE_SHIPPING:        { max: 5,  window: 3600 },
  REQUEST_DELETION:       { max: 1,  window: 86400 },   // 1 / día
  CONTACT_FORM:           { max: 3,  window: 3600 },
  SURVEY_SUBMIT:          { max: 1,  window: 86400 },   // 1 por encuesta/día
  NEWSLETTER:             { max: 3,  window: 3600 },
  FLOW_CALLBACK:          { max: 60, window: 60 },      // burst defense
};
