/**
 * Helpers para Cloudflare D1.
 *
 * D1 es SQLite, así que NO tiene SELECT...FOR UPDATE.
 * La idempotencia se logra con UNIQUE constraints + INSERT OR IGNORE.
 *
 * Patrón estándar:
 *   const result = await env.DB.prepare("INSERT OR IGNORE ...").bind(...).run();
 *   if (result.meta.changes === 0) return; // ya existía, ignorar
 */

import type { D1Database, D1PreparedStatement, D1Result } from '@cloudflare/workers-types';

/** Ejecuta una query y retorna primer fila tipada o null. */
export async function dbFetch<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const stmt = db.prepare(sql).bind(...params);
  return (await stmt.first<T>()) ?? null;
}

/** Ejecuta una query y retorna todas las filas. */
export async function dbFetchAll<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const stmt = db.prepare(sql).bind(...params);
  const result = await stmt.all<T>();
  return result.results ?? [];
}

/** Ejecuta INSERT/UPDATE/DELETE, retorna { meta, success }. */
export async function dbRun(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<D1Result> {
  const stmt = db.prepare(sql).bind(...params);
  return await stmt.run();
}

/** Ejecuta INSERT y retorna lastInsertRowId. */
export async function dbInsert(db: D1Database, sql: string, params: unknown[] = []): Promise<number> {
  const result = await dbRun(db, sql, params);
  return Number(result.meta.last_row_id ?? 0);
}

/** Ejecuta UPDATE/DELETE y retorna número de filas afectadas. */
export async function dbExec(db: D1Database, sql: string, params: unknown[] = []): Promise<number> {
  const result = await dbRun(db, sql, params);
  return Number(result.meta.changes ?? 0);
}

/**
 * Ejecuta múltiples statements en BATCH (atomic en D1).
 * Útil para reemplazar transacciones.
 */
export async function dbBatch(db: D1Database, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  return db.batch(statements);
}

/**
 * Idempotency check: intenta INSERT OR IGNORE en una tabla con UNIQUE constraint.
 * Retorna true si se insertó (operación primera vez), false si ya existía.
 */
export async function dbInsertIfNotExists(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<boolean> {
  if (!sql.toUpperCase().includes('INSERT OR IGNORE') && !sql.toUpperCase().includes('INSERT INTO')) {
    throw new Error('dbInsertIfNotExists: SQL must be INSERT OR IGNORE');
  }
  const result = await dbRun(db, sql, params);
  return Number(result.meta.changes ?? 0) > 0;
}

/**
 * Update con optimistic locking. Falla con conflict si data_version no coincide.
 * Retorna true si se actualizó, false si hubo conflict.
 */
export async function dbUpdateOptimistic(
  db: D1Database,
  table: string,
  set: Record<string, unknown>,
  where: { id: number; data_version: string },
): Promise<boolean> {
  const cols = Object.keys(set);
  const setClause = cols.map(c => `${c}=?`).join(', ');
  const params = [...cols.map(c => set[c]), where.id, where.data_version];
  const sql = `UPDATE ${table} SET ${setClause} WHERE id=? AND data_version=?`;
  const changes = await dbExec(db, sql, params);
  return changes > 0;
}

// ==========================================================================
// Lectura de configuración (mv_shipping_config + cache en KV)
// ==========================================================================

export async function getConfig(db: D1Database, key: string, fallback: string): Promise<string> {
  const row = await dbFetch<{ config_value: string }>(
    db,
    'SELECT config_value FROM mv_shipping_config WHERE config_key = ?',
    [key],
  );
  return row?.config_value ?? fallback;
}

export async function getConfigInt(db: D1Database, key: string, fallback: number): Promise<number> {
  const v = await getConfig(db, key, String(fallback));
  const n = parseInt(v, 10);
  return isFinite(n) ? n : fallback;
}

// ==========================================================================
// Sanitización para LOG / displays (NO para queries — usar bind)
// ==========================================================================

/** Escapa caracteres potencialmente peligrosos para HTML. */
export function clean(str: string | null | undefined): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ==========================================================================
// Health check
// ==========================================================================

export async function dbHealthCheck(db: D1Database): Promise<boolean> {
  try {
    const result = await db.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return result?.ok === 1;
  } catch {
    return false;
  }
}
