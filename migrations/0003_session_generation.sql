-- =============================================================================
-- Migration 0003 — session_generation column
-- =============================================================================
-- Propósito: revocar TODAS las sesiones activas de un usuario/admin de forma
-- inmediata (sin tener que listar todas las keys en KV).
--
-- Mecanismo: el token incluye `gen` en su payload. La verificación compara
-- token.gen contra la columna session_generation en BD. Al cambiar el password
-- (o en /api/auth/revoke-all) se incrementa el contador → tokens viejos fallan.
--
-- Es ADITIVO (DEFAULT 1) — no destruye datos. Tokens emitidos antes de esta
-- migración serán inválidos a partir del próximo deploy (porque el verify
-- exige gen y los tokens viejos no la traen) → re-login forzado de todos.
-- =============================================================================

ALTER TABLE mv_users  ADD COLUMN session_generation INTEGER DEFAULT 1;
ALTER TABLE mv_admins ADD COLUMN session_generation INTEGER DEFAULT 1;
