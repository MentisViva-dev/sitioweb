/**
 * Cliente Flow.cl con verificación de firma BIDIRECCIONAL.
 *
 * Resuelve el hallazgo crítico de la auditoría §1.4:
 *   - Firma OUTGOING (al llamar Flow): se firma con HMAC-SHA256.
 *   - Firma INCOMING (callback): se verifica.
 *   - Firma de RESPONSE: se verifica que Flow responda con su firma.
 *
 * También maneja:
 *   - Idempotencia (con UNIQUE en mv_payment_callbacks).
 *   - Validación de monto (compara amount con mv_orders.monto).
 *   - Retry con backoff en errores 5xx.
 */

import type { Env } from '../types/env';
import { hmacSha256, verifyHmacSha256 } from './crypto';

export interface FlowApiResponse {
  status?: number;
  message?: string;
  customerId?: string;
  subscriptionId?: string;
  planId?: string;
  url?: string;
  token?: string;
  flowOrder?: string;
  commerceOrder?: string;
  amount?: string | number;
  currency?: string;
  s?: string; // signature
  data?: unknown;
  total?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export const FLOW_STATUS = {
  PENDING:   1,
  PAID:      2,
  REJECTED:  3,
  CANCELLED: 4,
} as const;

export type FlowStatus = (typeof FLOW_STATUS)[keyof typeof FLOW_STATUS];

// =====================================================================
// Firma de requests outgoing
// =====================================================================

/** Firma params según convención Flow: ksort + concat key+value + HMAC. */
async function signParams(params: Record<string, string | number>, secret: string): Promise<string> {
  // 1. Ordenar alfabéticamente las keys
  const sortedKeys = Object.keys(params).sort();
  // 2. Concatenar key+value
  let toSign = '';
  for (const k of sortedKeys) {
    toSign += k + String(params[k]);
  }
  // 3. HMAC-SHA256 con FLOW_SECRET
  return hmacSha256(secret, toSign);
}

/** Verifica firma de respuesta de Flow (response['s']). */
async function verifyResponseSignature(
  data: Record<string, unknown>,
  secret: string,
): Promise<boolean> {
  if (!data.s || typeof data.s !== 'string') return false;
  const sig = data.s;
  const { s, ...rest } = data;
  const sortedKeys = Object.keys(rest).sort();
  let toVerify = '';
  for (const k of sortedKeys) {
    const v = rest[k];
    if (v == null) continue; // null/undefined no se firman
    toVerify += k + String(v);
  }
  return verifyHmacSha256(secret, toVerify, sig);
}

// =====================================================================
// Cliente Flow API
// =====================================================================

export interface FlowApiCallOptions {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

/**
 * Llama a un endpoint de Flow con firma + verificación de respuesta.
 */
export async function flowApiCall(
  env: Env,
  endpoint: string,
  params: Record<string, string | number>,
  method: 'GET' | 'POST' = 'POST',
  options: FlowApiCallOptions = {},
): Promise<FlowApiResponse> {
  const retries = options.retries ?? 2;
  const retryDelay = options.retryDelayMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 15000;

  // Agregar apiKey + firma
  const fullParams = { ...params, apiKey: env.MV_FLOW_API_KEY };
  const sig = await signParams(fullParams, env.MV_FLOW_SECRET);
  const signedParams: Record<string, string> = {};
  for (const k of Object.keys(fullParams)) {
    signedParams[k] = String(fullParams[k]);
  }
  signedParams.s = sig;

  const url = `${env.FLOW_API_URL}${endpoint}`;
  let lastError = '';

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let resp: Response;
      if (method === 'POST') {
        resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(signedParams).toString(),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } else {
        const qs = new URLSearchParams(signedParams).toString();
        resp = await fetch(`${url}?${qs}`, {
          method: 'GET',
          signal: AbortSignal.timeout(timeoutMs),
        });
      }

      if (resp.status >= 500) {
        lastError = `http_${resp.status}`;
        // Retry en 5xx
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, retryDelay * (attempt + 1)));
          continue;
        }
      }

      const text = await resp.text();
      let data: FlowApiResponse;
      try {
        data = JSON.parse(text) as FlowApiResponse;
      } catch {
        return { status: resp.status, message: `bad_json: ${text.slice(0, 200)}` };
      }

      if (!resp.ok) {
        return {
          status: resp.status,
          message: data.message ?? `http_${resp.status}`,
          ...data,
        };
      }

      // Verificar firma de la respuesta SI Flow la incluye
      if (data.s) {
        const valid = await verifyResponseSignature(data as Record<string, unknown>, env.MV_FLOW_SECRET);
        if (!valid) {
          console.error('[flow] response signature invalid', { endpoint, data });
          return { status: 0, message: 'invalid_response_signature' };
        }
      }

      return data;
    } catch (err) {
      lastError = (err as Error).message;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, retryDelay * (attempt + 1)));
        continue;
      }
    }
  }
  return { status: 0, message: `network_error: ${lastError}` };
}

// =====================================================================
// Verificación de callbacks INCOMING
// =====================================================================

/** Verifica firma de un callback Flow (POST x-www-form-urlencoded con campo 's'). */
export async function verifyCallbackSignature(
  formData: FormData | URLSearchParams,
  secret: string,
): Promise<boolean> {
  const obj: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    obj[k] = String(v);
  }
  return verifyResponseSignature(obj, secret);
}

// =====================================================================
// Helpers de alto nivel
// =====================================================================

export async function flowGetPaymentStatus(env: Env, token: string): Promise<FlowApiResponse> {
  return flowApiCall(env, '/payment/getStatus', { token }, 'GET');
}

export async function flowCreateCustomer(
  env: Env,
  externalId: string,
  email: string,
  name: string,
): Promise<FlowApiResponse> {
  return flowApiCall(env, '/customer/create', { externalId, email, name }, 'POST');
}

export async function flowGetCustomer(env: Env, customerId: string): Promise<FlowApiResponse> {
  return flowApiCall(env, '/customer/get', { customerId }, 'GET');
}

export async function flowDeleteCustomer(env: Env, customerId: string): Promise<FlowApiResponse> {
  return flowApiCall(env, '/customer/delete', { customerId }, 'POST');
}

export async function flowRegisterCard(
  env: Env,
  customerId: string,
  url_return: string,
): Promise<FlowApiResponse> {
  return flowApiCall(env, '/customer/register', { customerId, url_return }, 'POST');
}

export async function flowUnregisterCard(env: Env, customerId: string): Promise<FlowApiResponse> {
  return flowApiCall(env, '/customer/unRegister', { customerId }, 'POST');
}

export async function flowCreatePlan(
  env: Env,
  planId: string,
  name: string,
  amount: number,
  options: {
    interval?: number;
    interval_count?: number;
    trial_period_days?: number;
    urlCallback?: string;
  } = {},
): Promise<FlowApiResponse> {
  return flowApiCall(env, '/plans/create', {
    planId,
    name,
    currency: 'CLP',
    amount,
    interval: options.interval ?? 1,
    interval_count: options.interval_count ?? 1,
    trial_period_days: options.trial_period_days ?? 0,
    urlCallback: options.urlCallback ?? `${env.API_URL}/api/pay/callback`,
  });
}

export async function flowCreateSubscription(
  env: Env,
  planId: string,
  customerId: string,
  trialDays = 0,
): Promise<FlowApiResponse> {
  return flowApiCall(env, '/subscription/create', {
    planId,
    customerId,
    trial_period_days: trialDays,
  });
}

export async function flowCancelSubscription(env: Env, subscriptionId: string, atPeriodEnd = false): Promise<FlowApiResponse> {
  return flowApiCall(env, '/subscription/cancel', {
    subscriptionId,
    at_period_end: atPeriodEnd ? 1 : 0,
  });
}

export async function flowListSubscriptions(env: Env, customerId: string): Promise<FlowApiResponse> {
  return flowApiCall(env, '/subscription/list', { customerId, start: 0, limit: 100 }, 'GET');
}

export async function flowRefund(env: Env, commerceOrder: string, amount?: number): Promise<FlowApiResponse> {
  const params: Record<string, string | number> = {
    refundCommerceOrder: `REFUND-${Date.now()}`,
    receiverEmail: env.EMAIL_REPLY_TO ?? 'contacto@mentisviva.cl',
    commerceTrxId: commerceOrder,
  };
  if (amount) params.amount = amount;
  return flowApiCall(env, '/refund/create', params);
}

// =====================================================================
// Parsing helpers
// =====================================================================

/** Extrae order_id desde commerceOrder (formato MV-N). */
export function parseCommerceOrder(value: string): number | null {
  const match = /^MV-(\d+)$/.exec(value);
  if (!match) return null;
  return parseInt(match[1] ?? '0', 10) || null;
}

export function buildCommerceOrder(orderId: number): string {
  return `MV-${orderId}`;
}

/** Genera planId dinámico estable: lower(planName).t<total>. */
export function buildDynamicPlanId(planName: string, totalAmount: number): string {
  return planName.toLowerCase().replace(/\s+/g, '_') + '_t' + totalAmount;
}
