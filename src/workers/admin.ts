/**
 * Admin Worker — CMS, suscriptores, formularios, refunds.
 *
 * Endpoints:
 *   POST /api/admin/login
 *   POST /api/admin/logout
 *   GET  /api/admin/content
 *   POST /api/admin/save              (guarda content.json en mv_content como draft)
 *   POST /api/admin/publish           (publica versión actual)
 *   GET  /api/admin/subscribers
 *   GET  /api/admin/subscribers/export.csv
 *   GET  /api/admin/forms
 *   PATCH /api/admin/forms/:id
 *   GET  /api/admin/surveys
 *   GET  /api/admin/audit-log
 *   POST /api/admin/upload            (sube imagen a R2)
 *   POST /api/admin/refund            (delega a pay-worker)
 */

import type { Env, ExecutionContext } from '../types/env';
import type { DbAdmin, DbUser, DbForm } from '../types/db';
import { jsonOk, jsonError, Errors, readBody } from '../lib/responses';
import { dbFetch, dbFetchAll, dbInsert, dbExec } from '../lib/db';
import { getSession, issueAdminToken, makeAuthCookie, makeLogoutCookie, getClientIp } from '../lib/auth';
import { verifyPassword, randomToken, jitter, DUMMY_PASSWORD_HASH } from '../lib/crypto';
import { rateLimitLogin } from '../lib/rate-limit';
import { auditLog, AuditEvents } from '../lib/audit';
import { nowISO } from '../lib/dates';

export async function handle(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  if (path === '/api/admin/login' && method === 'POST') return handleLogin(req, env);

  // Resto requiere admin auth
  const session = await getSession(req, env);
  if (!session || !session.is_admin) return Errors.forbidden();

  if (path === '/api/admin/logout' && method === 'POST') return handleLogout(req, env);
  if (path === '/api/admin/content' && method === 'GET') return handleGetContent(env);
  if (path === '/api/admin/save' && method === 'POST') return handleSave(req, env, session.admin_id ?? 0);
  if (path === '/api/admin/publish' && method === 'POST') return handlePublish(req, env, session.admin_id ?? 0);
  if (path === '/api/admin/subscribers' && method === 'GET') return handleSubscribers(req, env);
  if (path === '/api/admin/subscribers/export.csv' && method === 'GET') return handleExportCsv(env);
  if (path === '/api/admin/forms' && method === 'GET') return handleForms(req, env);
  if (path.startsWith('/api/admin/forms/') && method === 'PATCH') return handleFormPatch(req, env, path);
  if (path === '/api/admin/surveys' && method === 'GET') return handleSurveys(req, env);
  if (path === '/api/admin/audit-log' && method === 'GET') return handleAuditLog(req, env);
  if (path === '/api/admin/upload' && method === 'POST') return handleUpload(req, env, session.admin_id ?? 0);
  if (path === '/api/admin/refund' && method === 'POST') return handleRefund(req, env);

  return Errors.notFound();
}

// =====================================================================
// LOGIN
// =====================================================================

async function handleLogin(req: Request, env: Env): Promise<Response> {
  const body = await readBody(req);
  const username = String(body['username'] ?? '').trim().toLowerCase();
  const password = String(body['password'] ?? '');

  // Rate limit
  const rl = await rateLimitLogin(env, req, username);
  if (!rl.allowed) return Errors.rateLimited(Math.ceil(rl.resetAt - Date.now() / 1000));

  if (!username || !password) {
    await jitter();
    return jsonError('Credenciales incorrectas', 401, { code: 'INVALID_CREDENTIALS' });
  }

  const admin = await dbFetch<DbAdmin>(
    env.DB,
    'SELECT id, username, email, password_hash, role, active FROM mv_admins WHERE (username = ? OR email = ?) AND active = 1',
    [username, username],
  );

  // Timing safe
  const hashToCheck = admin?.password_hash ?? DUMMY_PASSWORD_HASH;
  const ok = await verifyPassword(password, hashToCheck);
  if (!admin || !ok) {
    await jitter();
    await auditLog(env, { event_type: AuditEvents.LOGIN_FAILED, actor_type: 'admin', request: req, details: { username } });
    return jsonError('Credenciales incorrectas', 401, { code: 'INVALID_CREDENTIALS' });
  }

  await dbExec(env.DB, 'UPDATE mv_admins SET last_login_at = ?, last_login_ip = ? WHERE id = ?', [nowISO(), getClientIp(req), admin.id]);

  const token = await issueAdminToken(env, admin.id);
  await auditLog(env, { event_type: AuditEvents.ADMIN_LOGIN, actor_type: 'admin', actor_id: admin.id, request: req });

  return jsonOk(
    { admin: { id: admin.id, username: admin.username, email: admin.email, role: admin.role } },
    200,
    { 'Set-Cookie': makeAuthCookie(token, env, true) },
  );
}

async function handleLogout(req: Request, env: Env): Promise<Response> {
  const session = await getSession(req, env);
  if (session?.admin_id) {
    await auditLog(env, { event_type: AuditEvents.ADMIN_LOGOUT, actor_type: 'admin', actor_id: session.admin_id, request: req });
  }
  return jsonOk({ message: 'Sesión cerrada' }, 200, { 'Set-Cookie': makeLogoutCookie(env, true) });
}

// =====================================================================
// CONTENT (CMS)
// =====================================================================

async function handleGetContent(env: Env): Promise<Response> {
  const row = await dbFetch<{ content: string; version: number; published: number }>(
    env.DB,
    'SELECT content, version, published FROM mv_content ORDER BY version DESC LIMIT 1',
  );
  return jsonOk({ content: row ? JSON.parse(row.content) : {}, version: row?.version ?? 0, published: Boolean(row?.published) });
}

async function handleSave(req: Request, env: Env, adminId: number): Promise<Response> {
  const body = await readBody(req);
  const contentRaw = String(body['content'] ?? '');
  if (!contentRaw) return Errors.validation('Contenido vacío');

  // Validar JSON
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(contentRaw);
  } catch {
    return Errors.validation('JSON inválido');
  }
  if (typeof parsed !== 'object' || parsed === null) return Errors.validation('Estructura inválida');

  // Última versión
  const last = await dbFetch<{ version: number }>(env.DB, 'SELECT MAX(version) as version FROM mv_content');
  const nextVersion = (last?.version ?? 0) + 1;

  await dbInsert(
    env.DB,
    'INSERT INTO mv_content (content, version, published, created_by) VALUES (?, ?, 0, ?)',
    [JSON.stringify(parsed), nextVersion, adminId],
  );
  await auditLog(env, { event_type: 'admin.content_saved', actor_type: 'admin', actor_id: adminId, request: req, details: { version: nextVersion } });
  return jsonOk({ version: nextVersion, message: 'Borrador guardado' });
}

async function handlePublish(req: Request, env: Env, adminId: number): Promise<Response> {
  const body = await readBody(req);
  const version = parseInt(String(body['version'] ?? '0'), 10);
  if (!version) return Errors.validation('Versión requerida');

  // Despublicar el resto y publicar este
  await dbExec(env.DB, 'UPDATE mv_content SET published = 0 WHERE published = 1');
  const result = await dbExec(env.DB, 'UPDATE mv_content SET published = 1, published_at = ? WHERE version = ?', [nowISO(), version]);
  if (result === 0) return Errors.notFound('Versión');

  // ESCRIBIR el contenido publicado a KV para que el endpoint público lo lea
  // sin tocar la D1 en cada request. Sin esto, /api/content no vería los cambios
  // y el sitio público mostraría el contenido viejo para siempre.
  const publishedRow = await dbFetch<{ content: string }>(
    env.DB,
    'SELECT content FROM mv_content WHERE version = ? LIMIT 1',
    [version],
  );
  if (publishedRow?.content) {
    await env.KV_CACHE.put('content:current', publishedRow.content, {
      // No expiration — sólo se sobrescribe en el próximo publish.
      metadata: { version, published_at: nowISO() },
    });
  }

  await auditLog(env, { event_type: AuditEvents.ADMIN_CONTENT_PUB, actor_type: 'admin', actor_id: adminId, request: req, details: { version } });
  return jsonOk({ message: 'Contenido publicado', version });
}

// =====================================================================
// PUBLIC CONTENT — lo que sirve el sitio público (mentisviva.cl)
// =====================================================================
// Endpoint sin auth: GET /api/content → devuelve el último contenido publicado.
// Lo expone el router (router.ts) montado en /api/content (no en /api/admin/).

export async function handleGetPublicContent(env: Env): Promise<Response> {
  // 1) Intentar KV (rápido, edge-cached)
  const cached = await env.KV_CACHE.get('content:current');
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        // Cache corto en CDN para que cambios del CMS lleguen pronto pero no
        // muramos la D1 con cada request.
        'Cache-Control': 'public, max-age=60, s-maxage=60',
      },
    });
  }

  // 2) Fallback: leer último publicado de D1 y poblar KV
  const row = await dbFetch<{ content: string; version: number }>(
    env.DB,
    'SELECT content, version FROM mv_content WHERE published = 1 ORDER BY version DESC LIMIT 1',
  );
  if (!row?.content) {
    // No hay contenido publicado todavía: 404 (el frontend hará fallback a data/content.json)
    return new Response(JSON.stringify({ ok: false, error: 'No content published yet' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
  // Repoblar KV para próximas requests
  await env.KV_CACHE.put('content:current', row.content);
  return new Response(row.content, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60, s-maxage=60',
    },
  });
}

// =====================================================================
// SUBSCRIBERS
// =====================================================================

async function handleSubscribers(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.min(200, parseInt(url.searchParams.get('limit') ?? '50', 10));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10));
  const status = url.searchParams.get('status');
  const search = (url.searchParams.get('q') ?? '').slice(0, 100);

  let where = '1=1';
  const params: unknown[] = [];
  if (status) { where += ' AND plan_status = ?'; params.push(status); }
  if (search) {
    where += ' AND (email LIKE ? OR nombre LIKE ? OR apellido LIKE ?)';
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  params.push(limit, offset);

  const subs = await dbFetchAll<DbUser>(
    env.DB,
    `SELECT id, email, nombre, apellido, rut, telefono, comuna, region, plan_nombre, plan_status,
       payment_verified, shipping_method, shipping_cost, next_shipment_date,
       cancel_effective_date, paused_until, created_at
     FROM mv_users WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    params,
  );
  const total = await dbFetch<{ n: number }>(env.DB, `SELECT COUNT(*) as n FROM mv_users WHERE ${where}`, params.slice(0, -2));
  return jsonOk({ subscribers: subs, total: total?.n ?? 0, limit, offset });
}

async function handleExportCsv(env: Env): Promise<Response> {
  const subs = await dbFetchAll<DbUser>(
    env.DB,
    `SELECT id, email, nombre, apellido, rut, telefono, direccion, numero, depto,
       comuna, ciudad, region, codigo_postal, plan_nombre, plan_status,
       shipping_method, shipping_cost, next_shipment_date, created_at
     FROM mv_users ORDER BY created_at DESC`,
  );
  const headers = Object.keys(subs[0] ?? { id: 0 });
  const csvLines: string[] = [headers.join(',')];
  for (const row of subs) {
    csvLines.push(headers.map(h => `"${String((row as unknown as Record<string, unknown>)[h] ?? '').replace(/"/g, '""')}"`).join(','));
  }
  return new Response(csvLines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="subscribers_${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

// =====================================================================
// FORMS / SURVEYS / AUDIT
// =====================================================================

async function handleForms(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '50', 10));
  const status = url.searchParams.get('status');
  const where = status ? 'status = ?' : '1=1';
  const params: unknown[] = status ? [status, limit] : [limit];
  const forms = await dbFetchAll<DbForm>(
    env.DB,
    `SELECT id, form_type, source, nombre, email, telefono, mensaje, status, created_at
     FROM mv_forms WHERE ${where} ORDER BY id DESC LIMIT ?`,
    params,
  );
  return jsonOk({ forms });
}

async function handleFormPatch(req: Request, env: Env, path: string): Promise<Response> {
  const id = parseInt(path.split('/').pop() ?? '0', 10);
  const body = await readBody(req);
  const status = String(body['status'] ?? '');
  if (!['new', 'read', 'replied', 'spam', 'closed'].includes(status)) return Errors.validation('Status inválido');
  await dbExec(env.DB, 'UPDATE mv_forms SET status = ? WHERE id = ?', [status, id]);
  return jsonOk({ message: 'Actualizado' });
}

async function handleSurveys(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '50', 10));
  const surveys = await dbFetchAll(env.DB, 'SELECT id, user_id, survey_token, responses, created_at FROM mv_surveys ORDER BY id DESC LIMIT ?', [limit]);
  return jsonOk({ surveys });
}

async function handleAuditLog(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const limit = Math.min(200, parseInt(url.searchParams.get('limit') ?? '100', 10));
  const eventType = url.searchParams.get('event_type');
  const where = eventType ? 'event_type = ?' : '1=1';
  const params: unknown[] = eventType ? [eventType, limit] : [limit];
  const logs = await dbFetchAll(env.DB, `SELECT * FROM mv_audit_log WHERE ${where} ORDER BY id DESC LIMIT ?`, params);
  return jsonOk({ logs });
}

// =====================================================================
// UPLOAD
// =====================================================================

async function handleUpload(req: Request, env: Env, adminId: number): Promise<Response> {
  if (req.headers.get('content-type')?.includes('multipart/form-data') !== true) {
    return Errors.validation('Multipart form-data requerido');
  }
  const formData = await req.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) return Errors.validation('Archivo requerido');
  if (file.size > 5 * 1024 * 1024) return Errors.validation('Máximo 5 MB');
  const allowedMime = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowedMime.includes(file.type)) return Errors.validation('Solo PNG, JPG, WebP');

  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const key = `uploads/${new Date().toISOString().slice(0, 10)}/${randomToken(8)}.${ext}`;

  await env.R2.put(key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000' },
  });

  await auditLog(env, { event_type: 'admin.upload', actor_type: 'admin', actor_id: adminId, request: req, details: { key, size: file.size, type: file.type } });
  return jsonOk({
    // /r2/* handler vive en api.mentisviva.cl (router.ts), no en mentisviva.cl (Pages
    // devolvería el SPA fallback como text/html y la imagen se vería rota).
    url: `${env.API_URL}/r2/${key}`,
    key,
    size: file.size,
    type: file.type,
  });
}

// =====================================================================
// REFUND (delega a pay)
// =====================================================================

async function handleRefund(req: Request, env: Env): Promise<Response> {
  // Forward to pay worker via service binding
  const newReq = new Request(`${env.API_URL}/api/pay/refund`, {
    method: 'POST',
    headers: req.headers,
    body: await req.text(),
  });
  return env.PAY_WORKER.fetch(newReq as unknown as Parameters<typeof env.PAY_WORKER.fetch>[0]) as unknown as Response;
}
