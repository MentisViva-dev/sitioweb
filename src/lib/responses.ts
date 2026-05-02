/**
 * Helpers de respuestas HTTP estándar.
 * Todas las APIs devuelven JSON con shape consistente: { ok: true, ... } o { ok: false, error, code }.
 */

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'X-Content-Type-Options': 'nosniff',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Credentials': 'true',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, If-Unmodified-Since, X-Recaptcha-Token',
  'Access-Control-Max-Age': '600',
};

export interface SuccessBody {
  ok: true;
  [key: string]: unknown;
}

export interface ErrorBody {
  ok: false;
  error: string;
  code?: string;
  details?: unknown;
}

/** Resuelve el origen permitido para CORS según ENVIRONMENT */
function corsOrigin(env: { SITE_URL?: string; ENVIRONMENT?: string }, requestOrigin: string | null): string {
  // En producción: solo SITE_URL
  if (env.ENVIRONMENT === 'production') {
    return env.SITE_URL || 'https://mentisviva.cl';
  }
  // En staging/dev: refleja el origin si está en allowlist
  const allowed = [
    env.SITE_URL || 'https://mentisviva.cl',
    'https://staging.mentisviva.cl',
    'http://localhost:8788',
    'http://localhost:3000',
    'http://127.0.0.1:8788',
  ];
  if (requestOrigin && allowed.includes(requestOrigin)) return requestOrigin;
  return env.SITE_URL || 'https://mentisviva.cl';
}

export function jsonOk<T extends Record<string, unknown>>(
  body: T,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  const payload: SuccessBody = { ok: true, ...body };
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

export function jsonError(
  message: string,
  status = 400,
  options: { code?: string; details?: unknown; extraHeaders?: Record<string, string> } = {},
): Response {
  const body: ErrorBody = { ok: false, error: message };
  if (options.code) body.code = options.code;
  if (options.details !== undefined) body.details = options.details;
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...(options.extraHeaders ?? {}) },
  });
}

/** Envuelve cualquier Response con headers CORS */
export function withCors(
  response: Response,
  env: { SITE_URL?: string; ENVIRONMENT?: string },
  requestOrigin: string | null,
): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', corsOrigin(env, requestOrigin));
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** Maneja preflight OPTIONS */
export function corsPreflightResponse(
  env: { SITE_URL?: string; ENVIRONMENT?: string },
  requestOrigin: string | null,
): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': corsOrigin(env, requestOrigin),
      ...CORS_HEADERS,
    },
  });
}

/** Errores comunes con códigos predefinidos */
export const Errors = {
  unauthorized: () => jsonError('No autenticado', 401, { code: 'UNAUTHORIZED' }),
  sessionExpired: () =>
    jsonError('Tu sesión expiró. Inicia sesión nuevamente.', 401, { code: 'SESSION_EXPIRED' }),
  forbidden: () => jsonError('No tienes permisos para esta acción', 403, { code: 'FORBIDDEN' }),
  notFound: (resource = 'Recurso') => jsonError(`${resource} no encontrado`, 404, { code: 'NOT_FOUND' }),
  validation: (msg: string, details?: unknown) =>
    jsonError(msg, 422, { code: 'VALIDATION_ERROR', details }),
  rateLimited: (retryAfterSec = 60) =>
    new Response(JSON.stringify({ ok: false, error: 'Demasiados intentos. Intenta más tarde.', code: 'RATE_LIMITED' }), {
      status: 429,
      headers: { ...JSON_HEADERS, 'Retry-After': String(retryAfterSec) },
    }),
  conflict: (msg: string) => jsonError(msg, 409, { code: 'CONFLICT' }),
  paymentPending: () =>
    jsonError('Tienes un pago en progreso. Complétalo o espera 30 minutos.', 409, {
      code: 'PAYMENT_PENDING',
    }),
  shippingLocked: (unlockDate: string) =>
    jsonError(
      `Tu envío de este mes ya está confirmado. Podrás cambiar a partir del ${unlockDate}.`,
      409,
      { code: 'SHIPPING_LOCKED', details: { unlock_date: unlockDate } },
    ),
  internal: (msg = 'Error interno') => jsonError(msg, 500, { code: 'INTERNAL_ERROR' }),
  badRequest: (msg: string) => jsonError(msg, 400, { code: 'BAD_REQUEST' }),
  methodNotAllowed: () => jsonError('Método no permitido', 405, { code: 'METHOD_NOT_ALLOWED' }),
};

/** Lee body JSON con manejo de errores. Devuelve null si no hay JSON válido. */
export async function readJsonBody<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Lee body de FormData o JSON indistintamente. */
export async function readBody(
  req: Request,
): Promise<Record<string, string | File | null>> {
  const contentType = req.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const json = await readJsonBody(req);
    if (!json) return {};
    const result: Record<string, string | File | null> = {};
    for (const [k, v] of Object.entries(json)) {
      result[k] = v == null ? null : typeof v === 'string' ? v : String(v);
    }
    return result;
  }
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const form = await req.formData();
    const result: Record<string, string | File | null> = {};
    for (const [k, v] of form.entries()) {
      result[k] = v as string | File;
    }
    return result;
  }
  return {};
}
