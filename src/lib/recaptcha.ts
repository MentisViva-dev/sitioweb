/**
 * Verificación de reCAPTCHA v3 contra Google.
 *
 * Uso:
 *   const { ok, score } = await verifyRecaptcha(env, token, 'login');
 *   if (!ok) return Errors.forbidden();
 */

import type { Env } from '../types/env';

const RECAPTCHA_VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';
const MIN_SCORE = 0.5; // según docs Google v3

interface RecaptchaApiResponse {
  success: boolean;
  score?: number;
  action?: string;
  challenge_ts?: string;
  hostname?: string;
  'error-codes'?: string[];
}

export interface RecaptchaResult {
  ok: boolean;
  score: number;
  action: string;
  reason?: string;
}

export async function verifyRecaptcha(
  env: Env,
  token: string,
  expectedAction: string,
  remoteip?: string,
): Promise<RecaptchaResult> {
  if (!token || typeof token !== 'string') {
    return { ok: false, score: 0, action: expectedAction, reason: 'missing_token' };
  }
  if (!env.MV_RECAPTCHA_SECRET) {
    // Si no está configurado, fallback permisivo en development, estricto en prod
    if (env.ENVIRONMENT !== 'production') {
      return { ok: true, score: 1, action: expectedAction };
    }
    return { ok: false, score: 0, action: expectedAction, reason: 'no_secret_configured' };
  }

  const formData = new URLSearchParams();
  formData.append('secret', env.MV_RECAPTCHA_SECRET);
  formData.append('response', token);
  if (remoteip) formData.append('remoteip', remoteip);

  let resp: Response;
  try {
    resp = await fetch(RECAPTCHA_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
      // Timeout reasonable
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error('[recaptcha] fetch error', err);
    // En caso de fallo de red, fallback permisivo solo en staging
    if (env.ENVIRONMENT !== 'production') {
      return { ok: true, score: 0.7, action: expectedAction, reason: 'network_error_dev_pass' };
    }
    return { ok: false, score: 0, action: expectedAction, reason: 'network_error' };
  }

  if (!resp.ok) {
    return { ok: false, score: 0, action: expectedAction, reason: `http_${resp.status}` };
  }

  let data: RecaptchaApiResponse;
  try {
    data = (await resp.json()) as RecaptchaApiResponse;
  } catch {
    return { ok: false, score: 0, action: expectedAction, reason: 'invalid_json' };
  }

  if (!data.success) {
    return {
      ok: false,
      score: 0,
      action: expectedAction,
      reason: (data['error-codes'] ?? ['unknown']).join(','),
    };
  }

  const score = data.score ?? 0;
  const action = data.action ?? '';

  if (action !== expectedAction) {
    return { ok: false, score, action, reason: 'action_mismatch' };
  }
  if (score < MIN_SCORE) {
    return { ok: false, score, action, reason: 'low_score' };
  }
  return { ok: true, score, action };
}
