/**
 * Email outbound vía Resend (https://resend.com).
 *
 * Cloudflare no tiene email outbound nativo, así que usamos Resend.
 * Free tier: 3.000 emails/mes, 100 emails/día.
 *
 * Patrón:
 *   await sendEmail(env, { to, subject, html, idempotencyKey });
 *
 * O encolar para retry/batch:
 *   await env.Q_EMAILS.send({ to, subject, html, ... });
 *
 * Si Resend devuelve hard bounce, registramos en mv_email_bounces
 * y marcamos al usuario con email_bouncing=1 (cron lo limpia).
 */

import type { Env } from '../types/env';
import { dbInsert, dbExec } from './db';

const RESEND_API_URL = 'https://api.resend.com/emails';

export interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
  idempotency_key?: string;
  template?: string;
  cc?: string[];
  bcc?: string[];
}

export interface EmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

/**
 * Envía un email INMEDIATAMENTE vía Resend.
 * Para emails masivos o no críticos, usar `queueEmail` que va por Q_EMAILS.
 */
export async function sendEmail(env: Env, payload: EmailPayload): Promise<EmailResult> {
  if (!env.MV_RESEND_KEY) {
    console.error('[email] MV_RESEND_KEY no configurado');
    return { ok: false, error: 'email_not_configured' };
  }

  const body = {
    from: env.EMAIL_FROM || 'no-reply@mentisviva.cl',
    to: Array.isArray(payload.to) ? payload.to : [payload.to],
    subject: payload.subject,
    html: payload.html,
    text: payload.text,
    reply_to: payload.reply_to ?? env.EMAIL_REPLY_TO ?? 'contacto@mentisviva.cl',
    cc: payload.cc,
    bcc: payload.bcc,
  };

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${env.MV_RESEND_KEY}`,
    'Content-Type': 'application/json',
  };
  if (payload.idempotency_key) {
    headers['Idempotency-Key'] = payload.idempotency_key;
  }

  let resp: Response;
  try {
    resp = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { ok: false, error: `network: ${(err as Error).message}` };
  }

  if (!resp.ok) {
    const errorText = await resp.text();
    // Detectar bounces hard
    if (resp.status === 422 || /bounce|invalid/.test(errorText)) {
      const recipient = Array.isArray(payload.to) ? payload.to[0] : payload.to;
      if (recipient) await trackBounce(env, recipient, 'hard', errorText);
    }
    return { ok: false, error: `http_${resp.status}: ${errorText.slice(0, 200)}` };
  }

  const data = (await resp.json()) as { id?: string };
  return { ok: true, ...(data.id ? { id: data.id } : {}) };
}

/**
 * Encola un email para procesamiento async vía Q_EMAILS.
 * Recomendado para todos los emails NO críticos.
 */
export async function queueEmail(env: Env, payload: EmailPayload): Promise<void> {
  await env.Q_EMAILS.send({
    to: Array.isArray(payload.to) ? (payload.to[0] ?? '') : payload.to,
    subject: payload.subject,
    html: payload.html,
    ...(payload.text != null ? { text: payload.text } : {}),
    ...(payload.reply_to != null ? { reply_to: payload.reply_to } : {}),
    ...(payload.template != null ? { template: payload.template } : {}),
    ...(payload.idempotency_key != null ? { idempotency_key: payload.idempotency_key } : {}),
  });
}

/**
 * Registra un bounce en mv_email_bounces y marca al usuario.
 */
async function trackBounce(
  env: Env,
  email: string,
  type: 'hard' | 'soft' | 'complaint',
  errorMessage: string,
): Promise<void> {
  try {
    await dbInsert(
      env.DB,
      'INSERT INTO mv_email_bounces (email, bounce_type, error_message) VALUES (?, ?, ?)',
      [email, type, errorMessage.slice(0, 500)],
    );
    // Si es hard, marcar al usuario
    if (type === 'hard') {
      await dbExec(env.DB, 'UPDATE mv_users SET email_bouncing = 1 WHERE email = ?', [email]);
    }
  } catch (err) {
    console.error('[trackBounce] failed', err);
  }
}

// =====================================================================
// Plantillas de email reusables
// =====================================================================

export function buildEmailLayout(title: string, body: string, cta?: { label: string; url: string }): string {
  const ctaHtml = cta
    ? `<div style="text-align:center;margin:24px 0">
         <a href="${cta.url}" style="display:inline-block;padding:12px 32px;background:#2B8A9E;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">${cta.label}</a>
       </div>`
    : '';
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05)">
  <div style="padding:24px 32px;background:#343A40">
    <h1 style="color:#fff;margin:0;font-size:1.4rem;font-family:Cardo,Georgia,serif">${title}</h1>
  </div>
  <div style="padding:32px;color:#333;line-height:1.6">
    ${body}
    ${ctaHtml}
  </div>
  <div style="padding:16px 32px;background:#f8f9fa;color:#6c757d;font-size:0.85rem;text-align:center">
    <p style="margin:0">Mentis Viva — <a href="https://mentisviva.cl" style="color:#2B8A9E">mentisviva.cl</a></p>
    <p style="margin:6px 0 0">Si no esperabas este email, ignóralo.</p>
  </div>
</div>
</body></html>`;
}

export function buildAdminNotification(icon: string, title: string, contentHtml: string): string {
  return `<div style="max-width:500px;margin:0 auto;font-family:Arial,sans-serif;color:#333">
  <div style="padding:16px 24px;background:#343A40;border-radius:12px 12px 0 0">
    <h2 style="color:white;margin:0;font-size:1.1rem">${icon} ${title}</h2>
    <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:0.8rem">Notificación interna - Mentis Viva</p>
  </div>
  <div style="padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 12px 12px">
    ${contentHtml}
  </div>
</div>`;
}

// =====================================================================
// Helpers para emails comunes
// =====================================================================

export async function sendVerificationEmail(env: Env, userEmail: string, userName: string, token: string): Promise<EmailResult> {
  const url = `${env.SITE_URL}/cuenta.html?verify=${encodeURIComponent(token)}`;
  return sendEmail(env, {
    to: userEmail,
    subject: 'Verifica tu cuenta - Mentis Viva',
    html: buildEmailLayout(
      'Bienvenido a Mentis Viva',
      `<p>Hola ${escapeHtml(userName)},</p>
       <p>Gracias por unirte. Para activar tu cuenta haz clic en el botón.</p>
       <p style="color:#6c757d;font-size:0.85rem">Este enlace expira en 48 horas.</p>`,
      { label: 'Verificar mi cuenta', url },
    ),
    idempotency_key: `verify:${token}`,
  });
}

export async function sendPasswordResetEmail(env: Env, userEmail: string, userName: string, token: string): Promise<EmailResult> {
  const url = `${env.SITE_URL}/cuenta.html?reset=${encodeURIComponent(token)}`;
  return sendEmail(env, {
    to: userEmail,
    subject: 'Recupera tu contraseña - Mentis Viva',
    html: buildEmailLayout(
      'Recupera tu contraseña',
      `<p>Hola ${escapeHtml(userName)},</p>
       <p>Solicitaste restablecer tu contraseña. Haz clic en el botón.</p>
       <p style="color:#6c757d;font-size:0.85rem">Este enlace expira en 4 horas. Si tú no lo solicitaste, ignóralo.</p>`,
      { label: 'Cambiar contraseña', url },
    ),
    idempotency_key: `reset:${token}`,
  });
}

export async function sendAdminNotification(env: Env, subject: string, contentHtml: string, icon = '🔔'): Promise<EmailResult> {
  return sendEmail(env, {
    to: env.ADMIN_NOTIFY_EMAIL || 'contacto@mentisviva.cl',
    subject: `${icon} ${subject}`,
    html: buildAdminNotification(icon, subject, contentHtml),
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
