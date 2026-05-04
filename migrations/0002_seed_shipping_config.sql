-- =============================================================================
-- MentisViva — Seed de configuración de paquete y notificaciones para envíos
-- (complementa 0001_seed_config.sql que ya inserta cutoff_business_days,
--  shipping_day, origin_commune, origin_address, origin_postal_code)
-- =============================================================================

INSERT OR IGNORE INTO mv_shipping_config (config_key, config_value, description) VALUES
  ('package_width',            '20',   'Ancho del paquete en cm'),
  ('package_height',           '15',   'Alto del paquete en cm'),
  ('package_length',           '25',   'Largo del paquete en cm'),
  ('package_weight',           '1.5',  'Peso del paquete en kg'),
  ('notification_days_before', '5',    'Días antes del corte para notificar a usuarios'),
  ('min_shipping_display',     '2990', 'Costo mínimo de envío a mostrar en CLP');
