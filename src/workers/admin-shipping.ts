/**
 * Admin Shipping Worker — gestión de la nómina de envíos del mes.
 *
 * Endpoints (todos requieren cookie mv_admin_auth):
 *   GET    /api/admin/shipping/roster?month=YYYY-MM
 *   POST   /api/admin/shipping/roster/generate              { month }
 *   DELETE /api/admin/shipping/roster/:id
 *   POST   /api/admin/shipping/roster/clear                 { month }
 *   GET    /api/admin/shipping/roster.csv?month=YYYY-MM
 *   POST   /api/admin/shipping/shipit/create                { month }
 *   POST   /api/admin/shipping/shipit/sync-tracking         { month }
 *   GET    /api/admin/shipping/config
 *   POST   /api/admin/shipping/config                       { ...config }
 */

import type { Env, ExecutionContext } from '../types/env';
import type { DbShipmentRoster, DbShippingConfig, DbUser } from '../types/db';
import { jsonOk, Errors, readJsonBody } from '../lib/responses';
import { dbFetch, dbFetchAll, dbExec, dbInsert, dbRun } from '../lib/db';
import { getSession } from '../lib/auth';
import { auditLog, AuditEvents } from '../lib/audit';
import { shipitCreateShipment, shipitTrack } from '../lib/shipit';
import { nowISO, shipmentMonthStr } from '../lib/dates';

const MONTH_RE = /^\d{4}-\d{2}$/;
const CSV_PATH = '/api/admin/shipping/roster.csv';

interface RosterRowJoined extends DbShipmentRoster {
  email: string | null;
  nombre: string | null;
  apellido: string | null;
  direccion: string | null;
  numero: string | null;
  depto: string | null;
  comuna: string | null;
  ciudad: string | null;
  region: string | null;
  codigo_postal: string | null;
  telefono: string | null;
}

export async function handle(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // Todos los endpoints requieren admin
  const session = await getSession(req, env);
  if (!session || !session.is_admin) return Errors.forbidden();
  const adminId = session.admin_id ?? 0;

  // Roster CRUD
  if (path === '/api/admin/shipping/roster' && method === 'GET') {
    return handleGetRoster(url, env);
  }
  if (path === CSV_PATH && method === 'GET') {
    return handleExportRosterCsv(url, env);
  }
  if (path === '/api/admin/shipping/roster/generate' && method === 'POST') {
    return handleGenerateRoster(req, env, adminId);
  }
  if (path === '/api/admin/shipping/roster/clear' && method === 'POST') {
    return handleClearRoster(req, env, adminId);
  }
  if (path.startsWith('/api/admin/shipping/roster/') && method === 'DELETE') {
    const idStr = path.slice('/api/admin/shipping/roster/'.length);
    const id = parseInt(idStr, 10);
    if (!id) return Errors.validation('ID inválido');
    return handleDeleteRosterEntry(req, env, adminId, id);
  }

  // Shipit
  if (path === '/api/admin/shipping/shipit/create' && method === 'POST') {
    return handleShipitCreate(req, env, adminId);
  }
  if (path === '/api/admin/shipping/shipit/sync-tracking' && method === 'POST') {
    return handleShipitSyncTracking(req, env, adminId);
  }

  // Config
  if (path === '/api/admin/shipping/config' && method === 'GET') {
    return handleGetConfig(env);
  }
  if (path === '/api/admin/shipping/config' && method === 'POST') {
    return handleSaveConfig(req, env, adminId);
  }

  return Errors.notFound();
}

// =====================================================================
// Helpers
// =====================================================================

function currentMonth(): string {
  return shipmentMonthStr(new Date());
}

function parseMonth(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (v && MONTH_RE.test(v)) return v;
  return currentMonth();
}

interface CountsByStatus {
  queued: number;
  notified: number;
  confirmed: number;
  shipped: number;
  delivered: number;
  skipped: number;
  cancelled: number;
  total: number;
}

function emptyCounts(): CountsByStatus {
  return { queued: 0, notified: 0, confirmed: 0, shipped: 0, delivered: 0, skipped: 0, cancelled: 0, total: 0 };
}

function tallyCounts(rows: Array<{ status: string }>): CountsByStatus {
  const c = emptyCounts();
  const map = c as unknown as Record<string, number>;
  for (const r of rows) {
    c.total++;
    if (r.status in c) map[r.status] = (map[r.status] ?? 0) + 1;
  }
  return c;
}

async function fetchRoster(env: Env, month: string): Promise<RosterRowJoined[]> {
  return dbFetchAll<RosterRowJoined>(
    env.DB,
    `SELECT r.id, r.user_id, r.shipment_month, r.plan_nombre, r.shipping_method, r.shipping_cost,
            r.shipping_address, r.status, r.tracking_code, r.shipit_id, r.shipped_at, r.delivered_at,
            r.notes, r.created_at, r.updated_at,
            u.email, u.nombre, u.apellido, u.direccion, u.numero, u.depto, u.comuna,
            u.ciudad, u.region, u.codigo_postal, u.telefono
       FROM mv_shipment_roster r
       LEFT JOIN mv_users u ON u.id = r.user_id
      WHERE r.shipment_month = ?
      ORDER BY u.comuna, u.apellido, u.nombre`,
    [month],
  );
}

// =====================================================================
// GET /api/admin/shipping/roster
// =====================================================================

async function handleGetRoster(url: URL, env: Env): Promise<Response> {
  const month = parseMonth(url.searchParams.get('month'));
  const roster = await fetchRoster(env, month);
  const counts = tallyCounts(roster);
  return jsonOk({ month, roster, counts });
}

// =====================================================================
// GET /api/admin/shipping/roster.csv
// =====================================================================

function csvCell(v: unknown): string {
  if (v == null) return '""';
  let s = String(v);
  // Anti CSV-injection: prefijar `'` si comienza con =, +, -, @, TAB o CR
  // (Excel/Sheets ejecutan fórmulas en esos casos).
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

async function handleExportRosterCsv(url: URL, env: Env): Promise<Response> {
  const month = parseMonth(url.searchParams.get('month'));
  const roster = await fetchRoster(env, month);

  const headers = [
    'id', 'user_id', 'name', 'email', 'telefono', 'plan', 'comuna',
    'direccion', 'method', 'cost', 'status', 'tracking', 'shipit_id', 'shipped_at', 'delivered_at',
  ];
  const lines: string[] = [headers.join(',')];
  for (const r of roster) {
    const fullName = [r.nombre, r.apellido].filter(Boolean).join(' ');
    const fullAddr = [r.direccion, r.numero].filter(Boolean).join(' ') + (r.depto ? `, Depto ${r.depto}` : '');
    lines.push([
      csvCell(r.id),
      csvCell(r.user_id),
      csvCell(fullName),
      csvCell(r.email),
      csvCell(r.telefono),
      csvCell(r.plan_nombre),
      csvCell(r.comuna),
      csvCell(fullAddr),
      csvCell(r.shipping_method),
      csvCell(r.shipping_cost),
      csvCell(r.status),
      csvCell(r.tracking_code),
      csvCell(r.shipit_id),
      csvCell(r.shipped_at),
      csvCell(r.delivered_at),
    ].join(','));
  }
  const body = lines.join('\n');
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="roster_${month}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

// =====================================================================
// POST /api/admin/shipping/roster/generate
// =====================================================================

async function handleGenerateRoster(req: Request, env: Env, adminId: number): Promise<Response> {
  const body = (await readJsonBody<{ month?: string }>(req)) ?? {};
  const month = parseMonth(body.month);

  // Suscriptores activos con pago verificado para este mes (mv_subscriptions no existe;
  // usamos mv_users.plan_status='active' AND payment_verified=1, además de un mv_orders
  // pagado para el mes si existe).
  const eligible = await dbFetchAll<DbUser>(
    env.DB,
    `SELECT id, plan_nombre, shipping_method, shipping_cost, direccion, numero, depto,
            comuna, ciudad, region, codigo_postal, telefono
       FROM mv_users
      WHERE plan_status = 'active'
        AND payment_verified = 1
        AND id IN (
              SELECT user_id FROM mv_orders
               WHERE shipment_month = ? AND status IN ('paid','active')
        )`,
    [month],
  );

  let inserted = 0;
  let skipped = 0;
  for (const u of eligible) {
    const addressSnapshot = JSON.stringify({
      direccion: u.direccion,
      numero: u.numero,
      depto: u.depto,
      comuna: u.comuna,
      ciudad: u.ciudad,
      region: u.region,
      codigo_postal: u.codigo_postal,
      telefono: u.telefono,
    });
    const result = await dbRun(
      env.DB,
      `INSERT OR IGNORE INTO mv_shipment_roster
         (user_id, shipment_month, plan_nombre, shipping_method, shipping_cost, shipping_address, status)
       VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
      [u.id, month, u.plan_nombre, u.shipping_method, u.shipping_cost, addressSnapshot],
    );
    if (Number(result.meta.changes ?? 0) > 0) inserted++;
    else skipped++;
  }

  await auditLog(env, {
    event_type: AuditEvents.ROSTER_GENERATED,
    actor_type: 'admin',
    actor_id: adminId,
    request: req,
    details: { month, inserted, skipped, eligible: eligible.length },
  });

  return jsonOk({ month, inserted, skipped, eligible: eligible.length });
}

// =====================================================================
// DELETE /api/admin/shipping/roster/:id
// =====================================================================

async function handleDeleteRosterEntry(req: Request, env: Env, adminId: number, id: number): Promise<Response> {
  const row = await dbFetch<{ id: number; status: string; shipment_month: string }>(
    env.DB,
    'SELECT id, status, shipment_month FROM mv_shipment_roster WHERE id = ?',
    [id],
  );
  if (!row) return Errors.notFound('Entrada');
  if (row.status === 'shipped' || row.status === 'delivered') {
    return Errors.conflict('No se puede eliminar un envío ya despachado o entregado');
  }
  const deleted = await dbExec(env.DB, 'DELETE FROM mv_shipment_roster WHERE id = ?', [id]);
  await auditLog(env, {
    event_type: 'admin.roster_entry_deleted',
    actor_type: 'admin',
    actor_id: adminId,
    request: req,
    details: { id, month: row.shipment_month },
  });
  return jsonOk({ deleted });
}

// =====================================================================
// POST /api/admin/shipping/roster/clear
// =====================================================================

async function handleClearRoster(req: Request, env: Env, adminId: number): Promise<Response> {
  const body = (await readJsonBody<{ month?: string }>(req)) ?? {};
  if (!body.month || !MONTH_RE.test(body.month)) return Errors.validation('Mes requerido (YYYY-MM)');
  const month = body.month;

  // Bloquear si hay envíos despachados/entregados
  const blocking = await dbFetch<{ n: number }>(
    env.DB,
    `SELECT COUNT(*) AS n FROM mv_shipment_roster
      WHERE shipment_month = ? AND status IN ('shipped','delivered')`,
    [month],
  );
  if ((blocking?.n ?? 0) > 0) {
    return Errors.conflict('Hay envíos ya despachados o entregados — no se puede limpiar la nómina');
  }

  const deleted = await dbExec(
    env.DB,
    `DELETE FROM mv_shipment_roster
      WHERE shipment_month = ? AND status IN ('queued','notified')`,
    [month],
  );

  await auditLog(env, {
    event_type: 'admin.roster_cleared',
    actor_type: 'admin',
    actor_id: adminId,
    request: req,
    details: { month, deleted },
  });

  return jsonOk({ month, deleted });
}

// =====================================================================
// POST /api/admin/shipping/shipit/create
// =====================================================================

async function handleShipitCreate(req: Request, env: Env, adminId: number): Promise<Response> {
  const body = (await readJsonBody<{ month?: string }>(req)) ?? {};
  const month = parseMonth(body.month);

  if (!env.MV_SHIPIT_TOKEN || !env.MV_SHIPIT_EMAIL) {
    return jsonOk({
      ok: false,
      error: 'Shipit no configurado: agregar MV_SHIPIT_EMAIL y MV_SHIPIT_TOKEN como secrets en Cloudflare',
      month,
      created: 0,
      failed: 0,
      errors: [],
    });
  }

  const entries = await dbFetchAll<RosterRowJoined>(
    env.DB,
    `SELECT r.id, r.user_id, r.shipment_month, r.plan_nombre, r.shipping_method, r.shipping_cost,
            r.shipping_address, r.status, r.tracking_code, r.shipit_id, r.shipped_at, r.delivered_at,
            r.notes, r.created_at, r.updated_at,
            u.email, u.nombre, u.apellido, u.direccion, u.numero, u.depto, u.comuna,
            u.ciudad, u.region, u.codigo_postal, u.telefono
       FROM mv_shipment_roster r
       LEFT JOIN mv_users u ON u.id = r.user_id
      WHERE r.shipment_month = ?
        AND r.status IN ('queued','confirmed')
        AND (r.shipit_id IS NULL OR r.shipit_id = '')`,
    [month],
  );

  // Cargar configuración de paquete + comuna de origen
  const cfgRows = await dbFetchAll<DbShippingConfig>(env.DB, 'SELECT config_key, config_value FROM mv_shipping_config');
  const cfg: Record<string, string> = {};
  for (const r of cfgRows) cfg[r.config_key] = r.config_value;
  const pkg = {
    width:  parseInt(cfg['package_width']  ?? '20', 10) || 20,
    height: parseInt(cfg['package_height'] ?? '15', 10) || 15,
    length: parseInt(cfg['package_length'] ?? '25', 10) || 25,
    weight: parseFloat(cfg['package_weight'] ?? '1.5') || 1.5,
  };
  const originCommune = (cfg['origin_commune'] ?? '').trim() || undefined;

  let created = 0;
  let failed = 0;
  const errors: Array<{ user_id: number; id: number; error: string }> = [];

  for (const e of entries) {
    // Preferir snapshot del roster (shipping_address JSON); fallback al user actual.
    let snap: Partial<{
      direccion: string; numero: string; depto: string;
      comuna: string; region: string; telefono: string;
    }> = {};
    if (e.shipping_address) {
      try { snap = JSON.parse(e.shipping_address); } catch { /* ignore */ }
    }
    const direccion = snap.direccion ?? e.direccion ?? '';
    const numero    = snap.numero    ?? e.numero    ?? 'S/N';
    const depto     = snap.depto     ?? e.depto     ?? '';
    const comuna    = snap.comuna    ?? e.comuna    ?? '';
    const region    = snap.region    ?? e.region    ?? '';
    const telefono  = snap.telefono  ?? e.telefono  ?? '';

    if (!e.email || !comuna || !direccion) {
      failed++;
      errors.push({ user_id: e.user_id, id: e.id, error: 'Datos de dirección incompletos' });
      continue;
    }
    const fullName = [e.nombre, e.apellido].filter(Boolean).join(' ').trim() || (e.email ?? 'Cliente');

    let result;
    try {
      result = await shipitCreateShipment(
        env,
        {
          full_name: fullName,
          email: e.email ?? '',
          phone: telefono,
          street: direccion,
          number: numero,
          complement: depto,
          commune: comuna,
          region: region,
        },
        e.shipping_method ?? 'starken',
        {
          weight: pkg.weight,
          height: pkg.height,
          length: pkg.length,
          width: pkg.width,
          reference: `MV-${e.id}`,
        },
        originCommune,
      );
    } catch (err) {
      // Defensivo: una excepción por envío individual no debe romper el batch.
      failed++;
      errors.push({
        user_id: e.user_id,
        id: e.id,
        error: err instanceof Error ? err.message : 'unknown_error',
      });
      continue;
    }

    if (result.ok && result.shipit_id) {
      await dbExec(
        env.DB,
        `UPDATE mv_shipment_roster
            SET status = 'shipped', shipit_id = ?, tracking_code = COALESCE(?, tracking_code),
                shipped_at = ?, updated_at = ?
          WHERE id = ?`,
        [result.shipit_id, result.tracking_code ?? null, nowISO(), nowISO(), e.id],
      );
      created++;
    } else {
      failed++;
      errors.push({ user_id: e.user_id, id: e.id, error: result.error ?? 'shipit_error' });
    }
  }

  await auditLog(env, {
    event_type: AuditEvents.PACKAGE_SHIPPED,
    actor_type: 'admin',
    actor_id: adminId,
    request: req,
    details: { month, created, failed, total: entries.length },
  });

  return jsonOk({ ok: true, month, created, failed, total: entries.length, errors });
}

// =====================================================================
// POST /api/admin/shipping/shipit/sync-tracking
// =====================================================================

async function handleShipitSyncTracking(req: Request, env: Env, adminId: number): Promise<Response> {
  const body = (await readJsonBody<{ month?: string }>(req)) ?? {};
  const month = parseMonth(body.month);

  if (!env.MV_SHIPIT_TOKEN || !env.MV_SHIPIT_EMAIL) {
    return jsonOk({
      ok: false,
      error: 'Integración Shipit pendiente: configurar MV_SHIPIT_TOKEN y MV_SHIPIT_EMAIL como secrets en wrangler',
      month,
      updated: 0,
      checked: 0,
    });
  }

  const entries = await dbFetchAll<{
    id: number;
    shipit_id: string | null;
    tracking_code: string | null;
    shipping_method: string | null;
    status: string;
  }>(
    env.DB,
    `SELECT id, shipit_id, tracking_code, shipping_method, status
       FROM mv_shipment_roster
      WHERE shipment_month = ?
        AND shipit_id IS NOT NULL AND shipit_id != ''
        AND status IN ('shipped','notified','confirmed','queued')`,
    [month],
  );

  let updated = 0;
  let delivered = 0;
  const errors: Array<{ id: number; error: string }> = [];

  for (const e of entries) {
    if (!e.tracking_code) continue;
    const tracking = await shipitTrack(env, e.tracking_code, e.shipping_method ?? 'shipit');
    if (!tracking) {
      errors.push({ id: e.id, error: 'no_tracking_data' });
      continue;
    }
    const status = (tracking.status ?? '').toLowerCase();
    let newStatus: string | null = null;
    if (status === 'delivered' || status === 'entregado') {
      newStatus = 'delivered';
      delivered++;
    } else if (status === 'in_transit' || status === 'dispatched' || status === 'despachado' || status === 'shipped') {
      newStatus = 'shipped';
    }
    if (newStatus && newStatus !== e.status) {
      const setDelivered = newStatus === 'delivered' ? ', delivered_at = ?' : '';
      const params: unknown[] = [newStatus, nowISO()];
      if (newStatus === 'delivered') params.push(nowISO());
      params.push(e.id);
      await dbExec(
        env.DB,
        `UPDATE mv_shipment_roster SET status = ?, updated_at = ?${setDelivered} WHERE id = ?`,
        params,
      );
      updated++;
    }
  }

  await auditLog(env, {
    event_type: 'admin.shipit_tracking_synced',
    actor_type: 'admin',
    actor_id: adminId,
    request: req,
    details: { month, updated, delivered, checked: entries.length },
  });

  return jsonOk({ month, updated, delivered, checked: entries.length, errors });
}

// =====================================================================
// GET /api/admin/shipping/config
// =====================================================================

async function handleGetConfig(env: Env): Promise<Response> {
  const rows = await dbFetchAll<DbShippingConfig>(
    env.DB,
    'SELECT config_key, config_value, description FROM mv_shipping_config',
  );
  const config: Record<string, string> = {};
  for (const r of rows) config[r.config_key] = r.config_value;
  return jsonOk({ config });
}

// =====================================================================
// POST /api/admin/shipping/config
// =====================================================================

const ALLOWED_CONFIG_KEYS = new Set([
  'package_width', 'package_height', 'package_length', 'package_weight',
  'origin_commune', 'origin_address', 'origin_postal_code',
  'shipping_day', 'cutoff_business_days', 'notification_days_before',
  'min_shipping_display',
]);

async function handleSaveConfig(req: Request, env: Env, adminId: number): Promise<Response> {
  const body = await readJsonBody<Record<string, unknown>>(req);
  if (!body || typeof body !== 'object') return Errors.validation('Body JSON requerido');

  let saved = 0;
  const skippedKeys: string[] = [];
  for (const [key, raw] of Object.entries(body)) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) {
      skippedKeys.push(key);
      continue;
    }
    const value = raw == null ? '' : String(raw);
    // UPSERT (UNIQUE on config_key — usamos ON CONFLICT para SQLite/D1)
    await dbInsert(
      env.DB,
      `INSERT INTO mv_shipping_config (config_key, config_value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = datetime('now')`,
      [key, value],
    );
    saved++;
  }

  await auditLog(env, {
    event_type: 'admin.shipping_config_saved',
    actor_type: 'admin',
    actor_id: adminId,
    request: req,
    details: { saved, skipped_keys: skippedKeys },
  });

  return jsonOk({ saved, skipped_keys: skippedKeys });
}
