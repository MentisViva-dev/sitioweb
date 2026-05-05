-- =============================================================================
-- Migration 0004 — audit_log TTL (90 days)
-- =============================================================================
-- mv_audit_log crece sin límite. El cron diario (0 3 * * *) ahora purga rows
-- de más de 90 días para mantener el tamaño manejable.
--
-- Este archivo no altera schema (la limpieza es runtime). Sirve como anchor
-- documental + permite ejecutar el DELETE inicial al aplicar la migración —
-- útil si la tabla ya creció mucho antes del deploy.
--
-- DELETE es idempotente; safe re-aplicar. No drop columns ni truncate.
-- =============================================================================

DELETE FROM mv_audit_log WHERE created_at < datetime('now', '-90 days');

-- Asegurar índice por created_at para que la query del cron sea rápida.
-- IF NOT EXISTS es idempotente.
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON mv_audit_log(created_at);
