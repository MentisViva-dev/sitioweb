/**
 * Sistema de autenticación con tokens HMAC + cookies HttpOnly + sesiones en KV.
 *
 * Flujo:
 *   1. Login exitoso → emisión de token (HMAC firmado).
 *   2. Token va en cookie HttpOnly + Secure + SameSite=Strict.
 *   3. Hash del token + user_id se guardan en KV (TTL 30 días).
 *   4. En cada request, leer cookie, verificar HMAC, buscar en KV.
 *   5. Logout: revoca en KV.
 *
 * NO usar localStorage. Las cookies HttpOnly previenen XSS theft.
 */

import type { Env, AuthSession } from '../types/env';
import type { DbUser, DbAdmin } from '../types/db';
import { hmacSha256, verifyHmacSha256, randomToken, sha256 } from './crypto';
import { dbFetch } from './db';

// Token format: base64(payload) . hex(hmac_signature)
// payload = JSON { user_id, type, created_at, jti }

interface TokenPayload {
  uid: number;          // user_id
  typ: 'user' | 'admin';
  iat: number;          // issued at (unix seconds)
  jti: string;          // unique token id (random)
  gen: number;          // session_generation snapshot — must match DB at verify time
  v: 1;                 // version
}

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días
const COOKIE_NAME = 'mv_auth';
const ADMIN_COOKIE_NAME = 'mv_admin_auth';

// =====================================================================
// Emisión de token
// =====================================================================

export async function issueUserToken(env: Env, userId: number): Promise<string> {
  return issueToken(env, userId, 'user');
}

export async function issueAdminToken(env: Env, adminId: number): Promise<string> {
  return issueToken(env, adminId, 'admin');
}

async function issueToken(env: Env, id: number, type: 'user' | 'admin'): Promise<string> {
  const gen = await getCurrentSessionGeneration(env, id, type);
  const payload: TokenPayload = {
    uid: id,
    typ: type,
    iat: Math.floor(Date.now() / 1000),
    jti: randomToken(8),
    gen,
    v: 1,
  };
  const payloadStr = JSON.stringify(payload);
  const payloadB64 = btoa(payloadStr);
  const sig = await hmacSha256(env.MV_TOKEN_SECRET, payloadB64);
  const token = `${payloadB64}.${sig}`;

  // Guardar en KV: hash(token) → { uid, typ, iat, gen }
  const tokenHash = await sha256(token);
  await env.KV.put(
    `session:${tokenHash}`,
    JSON.stringify({ uid: id, typ: type, iat: payload.iat, jti: payload.jti, gen }),
    { expirationTtl: SESSION_TTL_SECONDS },
  );

  return token;
}

// =====================================================================
// Session generation — revocación masiva sin listar KV
// =====================================================================

/** Lee session_generation actual de la BD (defecto 1 si NULL). */
export async function getCurrentSessionGeneration(
  env: Env,
  id: number,
  type: 'user' | 'admin',
): Promise<number> {
  const table = type === 'admin' ? 'mv_admins' : 'mv_users';
  const row = await dbFetch<{ session_generation: number | null }>(
    env.DB,
    `SELECT session_generation FROM ${table} WHERE id = ?`,
    [id],
  );
  return row?.session_generation ?? 1;
}

/**
 * Revoca todas las sesiones activas de un usuario/admin incrementando
 * session_generation. Cualquier token emitido antes (con gen menor) fallará
 * la verificación en el próximo request. Inmediato y barato (1 UPDATE).
 */
export async function revokeAllSessions(env: Env, userId: number, isAdmin: boolean): Promise<void> {
  const table = isAdmin ? 'mv_admins' : 'mv_users';
  // Usar dbExec en vez de import circular — construir queries simples.
  await env.DB.prepare(
    `UPDATE ${table} SET session_generation = COALESCE(session_generation, 1) + 1 WHERE id = ?`,
  ).bind(userId).run();
  // Mantener compat: marcar también el blacklist key para tokens v1 viejos
  // (legacy revokeAllUserSessions mecanismo) por si quedaron emitidos.
  await env.KV.put(
    `user_revoked_at:${isAdmin ? 'admin' : 'user'}:${userId}`,
    String(Math.floor(Date.now() / 1000)),
    { expirationTtl: SESSION_TTL_SECONDS },
  );
}

// =====================================================================
// Verificación de token
// =====================================================================

export interface VerifyResult {
  valid: boolean;
  user_id?: number;
  type?: 'user' | 'admin';
  jti?: string;
}

export async function verifyToken(env: Env, token: string): Promise<VerifyResult> {
  if (!token) return { valid: false };
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false };
  const [payloadB64, sig] = parts as [string, string];

  // 1. Verificar firma HMAC (constant-time)
  const validSig = await verifyHmacSha256(env.MV_TOKEN_SECRET, payloadB64, sig);
  if (!validSig) return { valid: false };

  // 2. Decodificar payload
  let payload: TokenPayload;
  try {
    payload = JSON.parse(atob(payloadB64)) as TokenPayload;
  } catch {
    return { valid: false };
  }
  if (payload.v !== 1 || !payload.uid || !payload.typ) return { valid: false };

  // 3. Verificar que existe en KV (no revocado, no expirado)
  const tokenHash = await sha256(token);
  const session = await env.KV.get(`session:${tokenHash}`);
  if (!session) return { valid: false };

  // 4. Verificar generation — debe coincidir con la BD
  // Tokens viejos (sin `gen`) fallan: forzamos re-login post-deploy de migration 0003.
  if (typeof payload.gen !== 'number') return { valid: false };
  const dbGen = await getCurrentSessionGeneration(env, payload.uid, payload.typ);
  if (payload.gen !== dbGen) return { valid: false };

  return { valid: true, user_id: payload.uid, type: payload.typ, jti: payload.jti };
}

// =====================================================================
// Cookies
// =====================================================================

export function makeAuthCookie(token: string, env: Env, isAdmin = false): string {
  const cookieName = isAdmin ? ADMIN_COOKIE_NAME : COOKIE_NAME;
  const isProd = env.ENVIRONMENT === 'production';
  const parts = [
    `${cookieName}=${token}`,
    `Path=/`,
    `Max-Age=${SESSION_TTL_SECONDS}`,
    `SameSite=Strict`,
    `HttpOnly`,
  ];
  if (isProd) parts.push('Secure');
  // Domain para que funcione entre api.mentisviva.cl y mentisviva.cl si se necesita
  if (isProd) parts.push('Domain=.mentisviva.cl');
  return parts.join('; ');
}

export function makeLogoutCookie(env: Env, isAdmin = false): string {
  const cookieName = isAdmin ? ADMIN_COOKIE_NAME : COOKIE_NAME;
  const isProd = env.ENVIRONMENT === 'production';
  const parts = [
    `${cookieName}=`,
    `Path=/`,
    `Max-Age=0`,
    `SameSite=Strict`,
    `HttpOnly`,
  ];
  if (isProd) parts.push('Secure');
  if (isProd) parts.push('Domain=.mentisviva.cl');
  return parts.join('; ');
}

export function readCookie(req: Request, name = COOKIE_NAME): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const pair of header.split(';')) {
    const trimmed = pair.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1);
    }
  }
  return null;
}

// =====================================================================
// Helper combinado: extraer y validar sesión del request
// =====================================================================

export async function getSession(req: Request, env: Env): Promise<AuthSession | null> {
  // 1. Probar cookie de usuario
  const userToken = readCookie(req, COOKIE_NAME);
  if (userToken) {
    const result = await verifyToken(env, userToken);
    if (result.valid && result.type === 'user' && result.user_id) {
      const user = await dbFetch<DbUser>(
        env.DB,
        'SELECT id, email, nombre, apellido, plan_nombre, plan_status FROM mv_users WHERE id = ?',
        [result.user_id],
      );
      if (user) {
        return {
          user_id: user.id,
          email: user.email,
          nombre: user.nombre,
          apellido: user.apellido,
          plan_nombre: user.plan_nombre,
          plan_status: user.plan_status,
          is_admin: false,
        };
      }
    }
  }

  // 2. Probar cookie de admin (override)
  const adminToken = readCookie(req, ADMIN_COOKIE_NAME);
  if (adminToken) {
    const result = await verifyToken(env, adminToken);
    if (result.valid && result.type === 'admin' && result.user_id) {
      const admin = await dbFetch<DbAdmin>(
        env.DB,
        'SELECT id, username, email, role, active FROM mv_admins WHERE id = ? AND active = 1',
        [result.user_id],
      );
      if (admin) {
        return {
          user_id: admin.id,
          email: admin.email,
          nombre: admin.username,
          apellido: null,
          plan_nombre: null,
          plan_status: 'none',
          is_admin: true,
          admin_id: admin.id,
          admin_role: admin.role,
        };
      }
    }
  }

  return null;
}

// =====================================================================
// Logout
// =====================================================================

export async function revokeToken(env: Env, token: string): Promise<void> {
  const tokenHash = await sha256(token);
  await env.KV.delete(`session:${tokenHash}`);
}

/**
 * Revoca todas las sesiones de un usuario. Implementación basada en
 * session_generation (migration 0003): incrementa el contador, los tokens
 * viejos fallan en `verifyToken` automáticamente.
 *
 * Wrapper de compatibilidad: redirige a `revokeAllSessions(env, userId, isAdmin)`.
 */
export async function revokeAllUserSessions(env: Env, userId: number, type: 'user' | 'admin' = 'user'): Promise<void> {
  await revokeAllSessions(env, userId, type === 'admin');
}

/** Verifica si el usuario tuvo "logout all" después de la emisión del token. */
export async function isTokenStillValid(env: Env, type: 'user' | 'admin', userId: number, tokenIat: number): Promise<boolean> {
  const revokedAt = await env.KV.get(`user_revoked_at:${type}:${userId}`);
  if (!revokedAt) return true;
  return tokenIat > parseInt(revokedAt, 10);
}

// =====================================================================
// Rate limit por sesión
// =====================================================================

export function getClientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '0.0.0.0'
  );
}

export function getUserAgent(req: Request): string {
  return req.headers.get('user-agent')?.slice(0, 500) ?? 'unknown';
}
