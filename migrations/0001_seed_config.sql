-- =============================================================================
-- MentisViva — Seed inicial de configuración
-- =============================================================================

-- Configuración de envíos
INSERT OR IGNORE INTO mv_shipping_config (config_key, config_value, description) VALUES
  ('cutoff_business_days',   '10',           'Días hábiles antes del 25 para cerrar ediciones de envío'),
  ('shipping_day',           '25',           'Día del mes en que se despacha'),
  ('origin_commune',         'Santiago',     'Comuna origen del despacho'),
  ('origin_address',         'Av. Providencia 1234, Santiago', 'Dirección origen para Shipit'),
  ('origin_postal_code',     '7500000',      'CP origen para Shipit'),
  ('terms_version',          '1.0',          'Versión actual de términos y condiciones'),
  ('privacy_version',        '1.0',          'Versión actual de política de privacidad'),
  ('max_retry_card',         '3',            'Reintentos de cobro si falla tarjeta'),
  ('refund_window_days',     '10',           'Días para retracto Ley 19.496'),
  ('default_trial_period',   '0',            'Días de trial por defecto al suscribirse'),
  ('max_pause_months',       '3',            'Máximo de meses de pausa por suscriptor'),
  ('max_pause_per_year',     '2',            'Máximo de pausas por año'),
  ('email_from',             'no-reply@mentisviva.cl', 'Remitente de emails'),
  ('email_reply_to',         'contacto@mentisviva.cl', 'Reply-to de emails');

-- Comunas de la Región Metropolitana (las más comunes; cargar resto desde script)
INSERT OR IGNORE INTO mv_comunas (nombre, region, region_code) VALUES
  ('Santiago',           'Metropolitana de Santiago', 'RM'),
  ('Providencia',        'Metropolitana de Santiago', 'RM'),
  ('Las Condes',         'Metropolitana de Santiago', 'RM'),
  ('Vitacura',           'Metropolitana de Santiago', 'RM'),
  ('Lo Barnechea',       'Metropolitana de Santiago', 'RM'),
  ('Ñuñoa',              'Metropolitana de Santiago', 'RM'),
  ('La Reina',           'Metropolitana de Santiago', 'RM'),
  ('Macul',              'Metropolitana de Santiago', 'RM'),
  ('Peñalolén',          'Metropolitana de Santiago', 'RM'),
  ('San Joaquín',        'Metropolitana de Santiago', 'RM'),
  ('La Florida',         'Metropolitana de Santiago', 'RM'),
  ('Puente Alto',        'Metropolitana de Santiago', 'RM'),
  ('San Bernardo',       'Metropolitana de Santiago', 'RM'),
  ('Maipú',              'Metropolitana de Santiago', 'RM'),
  ('Pudahuel',           'Metropolitana de Santiago', 'RM'),
  ('Estación Central',   'Metropolitana de Santiago', 'RM'),
  ('Quinta Normal',      'Metropolitana de Santiago', 'RM'),
  ('Lo Prado',           'Metropolitana de Santiago', 'RM'),
  ('Cerro Navia',        'Metropolitana de Santiago', 'RM'),
  ('Renca',              'Metropolitana de Santiago', 'RM'),
  ('Quilicura',          'Metropolitana de Santiago', 'RM'),
  ('Conchalí',           'Metropolitana de Santiago', 'RM'),
  ('Huechuraba',         'Metropolitana de Santiago', 'RM'),
  ('Recoleta',           'Metropolitana de Santiago', 'RM'),
  ('Independencia',      'Metropolitana de Santiago', 'RM'),
  ('Cerrillos',          'Metropolitana de Santiago', 'RM'),
  ('Pedro Aguirre Cerda','Metropolitana de Santiago', 'RM'),
  ('San Miguel',         'Metropolitana de Santiago', 'RM'),
  ('La Cisterna',        'Metropolitana de Santiago', 'RM'),
  ('El Bosque',          'Metropolitana de Santiago', 'RM'),
  ('La Granja',          'Metropolitana de Santiago', 'RM'),
  ('San Ramón',          'Metropolitana de Santiago', 'RM'),
  ('La Pintana',         'Metropolitana de Santiago', 'RM');

-- Comunas zonas extremas (con costo de envío diferenciado)
INSERT OR IGNORE INTO mv_comunas (nombre, region, region_code, is_extreme) VALUES
  ('Punta Arenas',       'Magallanes y Antártica Chilena', 'XII', 1),
  ('Puerto Williams',    'Magallanes y Antártica Chilena', 'XII', 1),
  ('Isla de Pascua',     'Valparaíso', 'V', 1),
  ('Juan Fernández',     'Valparaíso', 'V', 1),
  ('Visviri',            'Arica y Parinacota', 'XV', 1);

-- Admin inicial. Cambiar inmediatamente con `wrangler d1 execute` o desde panel.
-- Password placeholder: "ChangeMe!2026" — argon2id hash precalculado.
-- IMPORTANTE: Tras seed, ejecutar:
--   wrangler d1 execute mentisviva --command "UPDATE mv_admins SET password_hash='<NUEVO_HASH>' WHERE id=1"
INSERT OR IGNORE INTO mv_admins (id, username, email, password_hash, role) VALUES
  (1, 'admin', 'contacto@mentisviva.cl',
   '$argon2id$v=19$m=65536,t=3,p=4$placeholder_change_immediately_after_seed',
   'superadmin');

-- Contenido inicial vacío (será populado al importar content.json existente)
INSERT OR IGNORE INTO mv_content (id, content, version, published, published_at) VALUES
  (1, '{}', 1, 1, datetime('now'));
