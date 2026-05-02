/**
 * Tipos TypeScript que reflejan el schema D1 (migrations/0000_schema_d1.sql).
 * Mantener sincronizado manualmente al cambiar el schema.
 */

export type PlanStatus = 'none' | 'pending' | 'active' | 'cancelled' | 'cancel_pending' | 'paused';
export type OrderStatus = 'pending' | 'active' | 'paid' | 'cancelled' | 'refunded' | 'failed' | 'disputed';
export type RosterStatus = 'queued' | 'notified' | 'confirmed' | 'shipped' | 'delivered' | 'skipped' | 'cancelled';
export type EmailStatus = 'pending' | 'sent' | 'failed' | 'bounced';
export type WebhookStatus = 'pending' | 'sent' | 'failed';
export type DisputeStatus = 'open' | 'investigating' | 'resolved_refund' | 'resolved_rejected';
export type AdminRole = 'superadmin' | 'admin' | 'editor' | 'viewer';
export type ActorType = 'user' | 'admin' | 'cron' | 'system' | 'external';
export type FormStatus = 'new' | 'read' | 'replied' | 'spam' | 'closed';
export type NewsletterStatus = 'active' | 'unsubscribed' | 'bounced';

export interface DbUser {
  id: number;
  email: string;
  password_hash: string;
  email_verified: number;
  verify_token: string | null;
  verify_token_expires: string | null;

  reset_token: string | null;
  reset_token_expires: string | null;
  security_question: string | null;
  security_answer: string | null;
  previous_password_hash: string | null;
  password_changed_at: string | null;
  revert_token: string | null;
  revert_token_expires: string | null;

  email_change_token: string | null;
  email_change_new_email: string | null;
  email_change_expires: string | null;

  deletion_token: string | null;
  deletion_requested_at: string | null;
  deletion_expires: string | null;

  nombre: string;
  apellido: string | null;
  rut: string | null;
  telefono: string | null;
  direccion: string | null;
  numero: string | null;
  depto: string | null;
  comuna: string | null;
  ciudad: string | null;
  region: string | null;
  codigo_postal: string | null;
  lat: number | null;
  lng: number | null;

  plan_nombre: string | null;
  plan_status: PlanStatus;
  cancel_effective_date: string | null;
  paused_until: string | null;
  flow_customer_id: string | null;
  flow_subscription_id: string | null;
  payment_verified: number;
  last_payment_failed_at: string | null;
  last_flow_sync: string | null;

  shipping_method: string | null;
  shipping_cost: number;
  shipping_service_type: string | null;
  next_shipment_date: string | null;
  shipping_locked: number;
  shipping_changing: number;

  payment_pending: number;
  payment_pending_expires: string | null;

  email_bouncing: number;

  marketing_opt_in: number;
  marketing_opt_in_at: string | null;
  terms_accepted_version: string | null;
  terms_accepted_at: string | null;

  data_version: string;
  created_at: string;
  updated_at: string;
}

export interface DbSession {
  id: number;
  user_id: number;
  token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface DbOrder {
  id: number;
  user_id: number;
  plan_nombre: string;
  monto: number;
  shipping_monto: number;
  shipping_method: string | null;
  shipment_month: string | null;
  status: OrderStatus;
  payment_method: string | null;
  payment_id: string | null;
  flow_subscription_id: string | null;
  refunded_at: string | null;
  refunded_by_admin_id: number | null;
  refund_reason: string | null;
  refund_flow_id: string | null;
  refund_amount: number | null;
  flagged_review: number;
  flagged_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbPaymentCallback {
  id: number;
  flow_token: string;
  order_id: number | null;
  user_id: number | null;
  flow_status: number | null;
  amount: number | null;
  raw_payload: string | null;
  signature_ok: number;
  amount_ok: number;
  processed_at: string;
  forwarded_at: string | null;
  forward_attempts: number;
}

export interface DbShipmentRoster {
  id: number;
  user_id: number;
  shipment_month: string;
  plan_nombre: string | null;
  shipping_method: string | null;
  shipping_cost: number | null;
  shipping_address: string | null;
  status: RosterStatus;
  tracking_code: string | null;
  shipit_id: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbEmailQueueItem {
  id: number;
  to_email: string;
  subject: string;
  html_body: string;
  text_body: string | null;
  reply_to: string | null;
  template: string | null;
  status: EmailStatus;
  attempts: number;
  max_attempts: number;
  error_message: string | null;
  idempotency_key: string | null;
  created_at: string;
  sent_at: string | null;
  next_retry_at: string | null;
}

export interface DbWebhookQueueItem {
  id: number;
  endpoint: string;
  url: string;
  payload: string;
  signature: string | null;
  status: WebhookStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  next_retry_at: string;
}

export interface DbAuditLogEntry {
  id: number;
  event_type: string;
  actor_type: ActorType;
  actor_id: number | null;
  target_user_id: number | null;
  ip_address: string | null;
  user_agent: string | null;
  details: string | null;
  created_at: string;
}

export interface DbAdmin {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  role: AdminRole;
  totp_secret: string | null;
  active: number;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
}

export interface DbContent {
  id: number;
  content: string;
  version: number;
  published: number;
  created_by: number | null;
  created_at: string;
  published_at: string | null;
}

export interface DbForm {
  id: number;
  form_type: string;
  source: string | null;
  nombre: string | null;
  email: string | null;
  telefono: string | null;
  mensaje: string | null;
  raw_data: string | null;
  status: FormStatus;
  ip_address: string | null;
  user_agent: string | null;
  recaptcha_score: number | null;
  created_at: string;
}

export interface DbComuna {
  id: number;
  nombre: string;
  region: string;
  region_code: string | null;
  shipit_code: string | null;
  is_extreme: number;
  active: number;
}

export interface DbShippingConfig {
  config_key: string;
  config_value: string;
  description: string | null;
  updated_at: string;
}
