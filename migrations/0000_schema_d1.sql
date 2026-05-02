-- =============================================================================
-- MentisViva — Schema D1 (Cloudflare SQLite)
-- =============================================================================
-- Migrado desde MySQL adaptando:
--   - Sin SELECT...FOR UPDATE (idempotencia con UNIQUE constraints + INSERT OR IGNORE)
--   - Sin ENUM (CHECK constraints en su lugar)
--   - Sin TIMESTAMP ON UPDATE (lo manejamos en la app o con triggers)
--   - DATETIME -> TEXT ISO8601 (SQLite estándar)
--   - INT AUTO_INCREMENT -> INTEGER PRIMARY KEY AUTOINCREMENT
--   - JSON columns soportadas via TEXT con json_* functions
--
-- Ejecutar con:
--   wrangler d1 execute mentisviva --file=migrations/0000_schema_d1.sql
-- =============================================================================

-- =============================================================================
-- mv_users — usuarios suscriptores
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_users (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Credenciales
  email                       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash               TEXT NOT NULL,
  email_verified              INTEGER DEFAULT 0,            -- 0/1 boolean
  verify_token                TEXT,
  verify_token_expires        TEXT,                          -- ISO8601

  -- Reset password
  reset_token                 TEXT,
  reset_token_expires         TEXT,
  security_question           TEXT,
  security_answer             TEXT,                          -- hash, no plain
  previous_password_hash      TEXT,                          -- para reverse temporal
  password_changed_at         TEXT,
  revert_token                TEXT,
  revert_token_expires        TEXT,

  -- Cambio de email (con doble confirmación)
  email_change_token          TEXT,
  email_change_new_email      TEXT COLLATE NOCASE,
  email_change_expires        TEXT,

  -- Eliminación de cuenta (Ley 21.719)
  deletion_token              TEXT,
  deletion_requested_at       TEXT,
  deletion_expires            TEXT,

  -- Datos personales
  nombre                      TEXT NOT NULL,
  apellido                    TEXT,
  rut                         TEXT,
  telefono                    TEXT,

  -- Dirección
  direccion                   TEXT,
  numero                      TEXT,
  depto                       TEXT,
  comuna                      TEXT,
  ciudad                      TEXT,
  region                      TEXT,
  codigo_postal               TEXT,
  lat                         REAL,
  lng                         REAL,

  -- Suscripción
  plan_nombre                 TEXT,
  plan_status                 TEXT DEFAULT 'none'
                              CHECK (plan_status IN ('none','pending','active','cancelled','cancel_pending','paused')),
  cancel_effective_date       TEXT,                          -- para cancelación diferida
  paused_until                TEXT,                          -- para pause
  flow_customer_id            TEXT,
  flow_subscription_id        TEXT,
  payment_verified            INTEGER DEFAULT 0,
  last_payment_failed_at      TEXT,
  last_flow_sync              TEXT,

  -- Envío
  shipping_method             TEXT,
  shipping_cost               INTEGER DEFAULT 0,
  shipping_service_type       TEXT,
  next_shipment_date          TEXT,
  shipping_locked             INTEGER DEFAULT 0,
  shipping_changing           INTEGER DEFAULT 0,             -- lock concurrencia

  -- Pago en progreso (bloquea ediciones durante register_card)
  payment_pending             INTEGER DEFAULT 0,
  payment_pending_expires     TEXT,

  -- Email outbound salud
  email_bouncing              INTEGER DEFAULT 0,

  -- Consentimientos legales (Ley 19.628 / 21.719)
  marketing_opt_in            INTEGER DEFAULT 0,
  marketing_opt_in_at         TEXT,
  terms_accepted_version      TEXT,
  terms_accepted_at           TEXT,

  -- Optimistic locking
  data_version                TEXT DEFAULT (datetime('now')),

  -- Auditoría
  created_at                  TEXT DEFAULT (datetime('now')),
  updated_at                  TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_plan_status     ON mv_users(plan_status);
CREATE INDEX IF NOT EXISTS idx_users_active          ON mv_users(plan_status, payment_verified);
CREATE INDEX IF NOT EXISTS idx_users_next_shipment   ON mv_users(next_shipment_date);
CREATE INDEX IF NOT EXISTS idx_users_cancel_pending  ON mv_users(plan_status, cancel_effective_date);
CREATE INDEX IF NOT EXISTS idx_users_paused          ON mv_users(plan_status, paused_until);
CREATE INDEX IF NOT EXISTS idx_users_email_change    ON mv_users(email_change_token);
CREATE INDEX IF NOT EXISTS idx_users_deletion        ON mv_users(deletion_token);
CREATE INDEX IF NOT EXISTS idx_users_payment_pending ON mv_users(payment_pending, payment_pending_expires);
CREATE INDEX IF NOT EXISTS idx_users_flow_customer   ON mv_users(flow_customer_id);
CREATE INDEX IF NOT EXISTS idx_users_flow_sub        ON mv_users(flow_subscription_id);

-- =============================================================================
-- mv_sessions — sesiones (espejo en KV, pero auditable)
-- En Cloudflare las sesiones reales viven en KV (rendimiento). Esta tabla
-- es opcional y mantiene un registro auditable de sesiones activas.
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_sessions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,
  token_hash        TEXT NOT NULL UNIQUE,                    -- SHA-256 del token, no el token directo
  user_agent        TEXT,
  ip_address        TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  expires_at        TEXT NOT NULL,
  last_used_at      TEXT,
  revoked_at        TEXT,
  FOREIGN KEY (user_id) REFERENCES mv_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON mv_sessions(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON mv_sessions(expires_at);

-- =============================================================================
-- mv_orders — órdenes de cobro
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_orders (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL,
  plan_nombre         TEXT NOT NULL,
  monto               INTEGER NOT NULL,                      -- CLP entero
  shipping_monto      INTEGER DEFAULT 0,
  shipping_method     TEXT,
  shipment_month      TEXT,                                  -- YYYY-MM

  -- Estado
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','active','paid','cancelled','refunded','failed','disputed')),

  -- Flow tracking
  payment_method      TEXT,                                  -- flow_subscription, flow_oneshot, etc.
  payment_id          TEXT,                                  -- flowOrder de Flow
  flow_subscription_id TEXT,

  -- Refund (Ley 19.496)
  refunded_at         TEXT,
  refunded_by_admin_id INTEGER,
  refund_reason       TEXT,
  refund_flow_id      TEXT,
  refund_amount       INTEGER,

  -- Detección anomalías (Ley 20.009)
  flagged_review      INTEGER DEFAULT 0,
  flagged_reason      TEXT,

  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES mv_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orders_user            ON mv_orders(user_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_status          ON mv_orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_shipment_month  ON mv_orders(shipment_month, status);
CREATE INDEX IF NOT EXISTS idx_orders_flagged         ON mv_orders(flagged_review);
CREATE INDEX IF NOT EXISTS idx_orders_payment_id      ON mv_orders(payment_id);

-- =============================================================================
-- mv_payment_callbacks — IDEMPOTENCIA del callback Flow
-- =============================================================================
-- Esta tabla resuelve el hallazgo crítico de la auditoría:
-- "callback Flow puede ser duplicado". UNIQUE en flow_token + INSERT OR IGNORE
-- garantiza que un callback se procese exactamente una vez.
CREATE TABLE IF NOT EXISTS mv_payment_callbacks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_token    TEXT NOT NULL UNIQUE,                        -- token único de Flow
  order_id      INTEGER,
  user_id       INTEGER,
  flow_status   INTEGER,                                     -- 1 pending, 2 paid, 3 rejected, 4 cancelled
  amount        INTEGER,
  raw_payload   TEXT,                                        -- JSON original (saneado)
  signature_ok  INTEGER DEFAULT 0,
  amount_ok     INTEGER DEFAULT 0,
  processed_at  TEXT DEFAULT (datetime('now')),
  forwarded_at  TEXT,                                        -- a contable.mentisviva.cl
  forward_attempts INTEGER DEFAULT 0,
  FOREIGN KEY (order_id) REFERENCES mv_orders(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES mv_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_callbacks_order ON mv_payment_callbacks(order_id);
CREATE INDEX IF NOT EXISTS idx_callbacks_user  ON mv_payment_callbacks(user_id);
CREATE INDEX IF NOT EXISTS idx_callbacks_processed ON mv_payment_callbacks(processed_at);

-- =============================================================================
-- mv_shipment_roster — quién recibe caja este mes
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_shipment_roster (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  shipment_month  TEXT NOT NULL,                             -- YYYY-MM
  plan_nombre     TEXT,
  shipping_method TEXT,
  shipping_cost   INTEGER,
  shipping_address TEXT,                                     -- JSON snapshot (dirección al momento)
  status          TEXT NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','notified','confirmed','shipped','delivered','skipped','cancelled')),
  tracking_code   TEXT,
  shipit_id       TEXT,
  shipped_at      TEXT,
  delivered_at    TEXT,
  notes           TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now')),
  UNIQUE (user_id, shipment_month),
  FOREIGN KEY (user_id) REFERENCES mv_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_roster_month_status ON mv_shipment_roster(shipment_month, status);
CREATE INDEX IF NOT EXISTS idx_roster_user         ON mv_shipment_roster(user_id);

-- =============================================================================
-- mv_email_queue — cola de emails (consumida por Worker cron)
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_email_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  to_email        TEXT NOT NULL,
  subject         TEXT NOT NULL,
  html_body       TEXT NOT NULL,
  text_body       TEXT,
  reply_to        TEXT,
  template        TEXT,                                      -- nombre de plantilla (auditable)
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','failed','bounced')),
  attempts        INTEGER DEFAULT 0,
  max_attempts    INTEGER DEFAULT 3,
  error_message   TEXT,
  idempotency_key TEXT UNIQUE,                               -- evita reenvíos duplicados
  created_at      TEXT DEFAULT (datetime('now')),
  sent_at         TEXT,
  next_retry_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_status ON mv_email_queue(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_email_to     ON mv_email_queue(to_email, created_at);

-- =============================================================================
-- mv_email_bounces — tracking de emails rebotados
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_email_bounces (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL,
  bounce_type   TEXT
                CHECK (bounce_type IN ('hard','soft','complaint','unknown')),
  error_message TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bounces_email ON mv_email_bounces(email);
CREATE INDEX IF NOT EXISTS idx_bounces_type  ON mv_email_bounces(bounce_type, created_at);

-- =============================================================================
-- mv_webhook_queue — reintentos de webhooks salientes (contable.mentisviva.cl, etc.)
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_webhook_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint        TEXT NOT NULL,                             -- 'contable', 'analytics', etc.
  url             TEXT NOT NULL,
  payload         TEXT NOT NULL,                             -- JSON
  signature       TEXT,                                      -- HMAC para verificación
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','failed')),
  attempts        INTEGER DEFAULT 0,
  max_attempts    INTEGER DEFAULT 5,
  last_error      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  sent_at         TEXT,
  next_retry_at   TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_status ON mv_webhook_queue(status, next_retry_at);

-- =============================================================================
-- mv_user_credits — créditos para prorrateo (downgrade)
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_user_credits (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL,
  amount              INTEGER NOT NULL,                      -- CLP, positivo=crédito
  reason              TEXT NOT NULL,
  related_order_id    INTEGER,
  applied_at          TEXT,
  applied_to_order_id INTEGER,
  expires_at          TEXT,
  created_at          TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES mv_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_credits_user_pending ON mv_user_credits(user_id, applied_at);

-- =============================================================================
-- mv_disputes — impugnaciones (Ley 20.009)
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_disputes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  order_id      INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','investigating','resolved_refund','resolved_rejected')),
  created_at    TEXT DEFAULT (datetime('now')),
  resolved_at   TEXT,
  admin_notes   TEXT,
  FOREIGN KEY (user_id) REFERENCES mv_users(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES mv_orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_disputes_user   ON mv_disputes(user_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON mv_disputes(status, created_at);

-- =============================================================================
-- mv_audit_log — trazabilidad (Ley 21.459)
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type      TEXT NOT NULL,                             -- login, password_change, refund, etc.
  actor_type      TEXT NOT NULL DEFAULT 'system'
                  CHECK (actor_type IN ('user','admin','cron','system','external')),
  actor_id        INTEGER,
  target_user_id  INTEGER,
  ip_address      TEXT,
  user_agent      TEXT,
  details         TEXT,                                      -- JSON
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_type_time ON mv_audit_log(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_actor     ON mv_audit_log(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_target    ON mv_audit_log(target_user_id, created_at);

-- =============================================================================
-- mv_reset_attempts — intentos de respuesta de seguridad (anti brute force)
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_reset_attempts (
  user_id         INTEGER NOT NULL,
  attempt_date    TEXT NOT NULL,
  attempts        INTEGER DEFAULT 0,
  last_attempt_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, attempt_date),
  FOREIGN KEY (user_id) REFERENCES mv_users(id) ON DELETE CASCADE
);

-- =============================================================================
-- mv_forms — formularios de contacto (centro, editorial, fundación)
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_forms (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  form_type     TEXT NOT NULL,                               -- contact, suscribe, etc.
  source        TEXT,                                        -- centro / editorial / fundacion
  nombre        TEXT,
  email         TEXT,
  telefono      TEXT,
  mensaje       TEXT,
  raw_data      TEXT,                                        -- JSON con campos extra
  status        TEXT DEFAULT 'new'
                CHECK (status IN ('new','read','replied','spam','closed')),
  ip_address    TEXT,
  user_agent    TEXT,
  recaptcha_score REAL,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_forms_status ON mv_forms(status, created_at);
CREATE INDEX IF NOT EXISTS idx_forms_source ON mv_forms(source, created_at);

-- =============================================================================
-- mv_surveys — encuestas
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_surveys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER,
  survey_token  TEXT,                                        -- nullable si es anónima
  responses     TEXT NOT NULL,                               -- JSON array
  ip_address    TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES mv_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_surveys_user  ON mv_surveys(user_id);
CREATE INDEX IF NOT EXISTS idx_surveys_token ON mv_surveys(survey_token);

-- =============================================================================
-- mv_shipping_config — configuración del sistema de envíos
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_shipping_config (
  config_key    TEXT PRIMARY KEY,
  config_value  TEXT NOT NULL,
  description   TEXT,
  updated_at    TEXT DEFAULT (datetime('now'))
);

-- =============================================================================
-- mv_comunas — comunas chilenas para validación + cotización
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_comunas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT NOT NULL,
  region        TEXT NOT NULL,
  region_code   TEXT,
  shipit_code   TEXT,
  is_extreme    INTEGER DEFAULT 0,                           -- zonas con costo extra
  active        INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_comunas_nombre ON mv_comunas(nombre);
CREATE INDEX IF NOT EXISTS idx_comunas_region ON mv_comunas(region);

-- =============================================================================
-- mv_subscribers_newsletter — boletín informativo (Ley 19.628 opt-in)
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_subscribers_newsletter (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  nombre          TEXT,
  source          TEXT,                                      -- footer, popup, etc.
  status          TEXT DEFAULT 'active'
                  CHECK (status IN ('active','unsubscribed','bounced')),
  confirmed       INTEGER DEFAULT 0,                         -- double opt-in
  confirm_token   TEXT,
  unsubscribe_token TEXT,
  ip_address      TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  unsubscribed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_newsletter_email  ON mv_subscribers_newsletter(email);
CREATE INDEX IF NOT EXISTS idx_newsletter_status ON mv_subscribers_newsletter(status);

-- =============================================================================
-- mv_admins — administradores del CMS (en lugar del hash único)
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_admins (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,                             -- argon2id
  role            TEXT NOT NULL DEFAULT 'editor'
                  CHECK (role IN ('superadmin','admin','editor','viewer')),
  totp_secret     TEXT,                                      -- 2FA opcional
  active          INTEGER DEFAULT 1,
  last_login_at   TEXT,
  last_login_ip   TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- =============================================================================
-- mv_content — almacén del CMS (reemplazo de content.json)
-- Versionado para audit trail (Ley 21.459)
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_content (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content       TEXT NOT NULL,                               -- JSON completo
  version       INTEGER NOT NULL,
  published     INTEGER DEFAULT 0,                           -- 0=draft, 1=publicado
  created_by    INTEGER,                                     -- mv_admins.id
  created_at    TEXT DEFAULT (datetime('now')),
  published_at  TEXT,
  FOREIGN KEY (created_by) REFERENCES mv_admins(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_content_version   ON mv_content(version DESC);
CREATE INDEX IF NOT EXISTS idx_content_published ON mv_content(published, published_at);

-- =============================================================================
-- mv_locks — locks de cron (evitar ejecuciones concurrentes)
-- =============================================================================
CREATE TABLE IF NOT EXISTS mv_locks (
  lock_name    TEXT PRIMARY KEY,
  acquired_by  TEXT NOT NULL,
  acquired_at  TEXT DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL
);

-- =============================================================================
-- TRIGGERS para updated_at automático (D1 soporta triggers)
-- =============================================================================
CREATE TRIGGER IF NOT EXISTS trg_users_updated
  AFTER UPDATE ON mv_users
  FOR EACH ROW
BEGIN
  UPDATE mv_users SET updated_at = datetime('now'),
                      data_version = datetime('now')
  WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_orders_updated
  AFTER UPDATE ON mv_orders
  FOR EACH ROW
BEGIN
  UPDATE mv_orders SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_roster_updated
  AFTER UPDATE ON mv_shipment_roster
  FOR EACH ROW
BEGIN
  UPDATE mv_shipment_roster SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- =============================================================================
-- FIN del schema. Ejecutar después: 0001_seed_config.sql
-- =============================================================================
