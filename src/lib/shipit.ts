/**
 * Cliente Shipit (https://api.shipit.cl/v).
 *
 * Funcionalidad:
 *   - Cotización de envío (quote) por comuna+peso.
 *   - Creación de despacho.
 *   - Tracking.
 *
 * Si Shipit cae, devuelve fallback "Retiro en editorial" con costo 0.
 */

import type { Env } from '../types/env';

export interface ShipitQuote {
  courier: string;
  service_type: string;
  price: number;
  estimated_delivery_days?: number;
}

export interface ShipitAddress {
  full_name: string;
  email: string;
  phone: string;
  street: string;
  number: string;
  complement?: string;
  commune: string;
  region: string;
}

interface ShipitApiResponse {
  status?: string;
  message?: string;
  data?: unknown;
  [key: string]: unknown;
}

async function shipitFetch(
  env: Env,
  path: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>,
): Promise<ShipitApiResponse | null> {
  if (!env.MV_SHIPIT_TOKEN || !env.MV_SHIPIT_EMAIL) {
    console.error('[shipit] credentials not configured');
    return null;
  }
  const url = `${env.SHIPIT_API_URL}${path}`;
  try {
    const init: RequestInit = {
      method,
      headers: {
        'X-Shipit-Email': env.MV_SHIPIT_EMAIL,
        'X-Shipit-Access-Token': env.MV_SHIPIT_TOKEN,
        'Accept': 'application/vnd.shipit.v4',
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    };
    if (body) {
      init.body = JSON.stringify(body);
    }
    const resp = await fetch(url, init);
    if (!resp.ok) {
      console.error(`[shipit] http_${resp.status}`, await resp.text());
      return null;
    }
    return (await resp.json()) as ShipitApiResponse;
  } catch (err) {
    console.error('[shipit] fetch error', err);
    return null;
  }
}

/**
 * Cotiza envío. Si Shipit falla, retorna fallback con retiro en editorial.
 */
export async function shipitQuote(
  env: Env,
  destinationCommune: string,
  weight = 1.0,
  height = 10,
  length = 25,
  width = 20,
): Promise<ShipitQuote[]> {
  const body = {
    package: {
      destiny: destinationCommune,
      weight,
      height,
      length,
      width,
    },
  };
  const data = await shipitFetch(env, '/quotations', 'POST', body);

  // Si falla, fallback
  if (!data || !data['quotations'] || !Array.isArray(data['quotations'])) {
    return getFallbackQuotes();
  }

  // Mapear respuesta a estructura interna
  const quotes: ShipitQuote[] = [];
  for (const q of data['quotations'] as Array<Record<string, unknown>>) {
    const courier = String(q['courier'] ?? '').toLowerCase();
    const price = parseInt(String(q['total_price'] ?? '0'), 10);
    if (!courier || !isFinite(price) || price <= 0) continue;
    quotes.push({
      courier,
      service_type: String(q['service_type'] ?? courier),
      price,
      ...(q['estimated_delivery_days'] != null ? { estimated_delivery_days: Number(q['estimated_delivery_days']) } : {}),
    });
  }

  // Agregar siempre opción "retiro" gratis
  quotes.push({ courier: 'retiro', service_type: 'Retiro en editorial', price: 0 });

  return quotes;
}

function getFallbackQuotes(): ShipitQuote[] {
  return [
    { courier: 'retiro', service_type: 'Retiro en editorial', price: 0 },
    // Cotizaciones manuales conservadoras como fallback
    { courier: 'starken', service_type: 'Estandar', price: 3990, estimated_delivery_days: 5 },
    { courier: 'chilexpress', service_type: 'Estandar', price: 4990, estimated_delivery_days: 4 },
  ];
}

/**
 * Crea un despacho en Shipit (POST /packages).
 *
 * Shipit v4 espera el shipment bajo `package.{...}` con courier embebido y
 * datos de destino bajo `destiny.{...}`. Si tu cuenta usa el endpoint legacy
 * `/shipments`, ajusta `path` a continuación.
 *
 * Devuelve { ok: false, error: ... } si la API no responde o no trae id.
 */
export async function shipitCreateShipment(
  env: Env,
  destinationAddress: ShipitAddress,
  courier: string,
  packageInfo: { weight: number; height: number; length: number; width: number; reference: string },
  originCommune?: string,
): Promise<{ shipit_id?: string; tracking_code?: string; ok: boolean; error?: string }> {
  const body = {
    package: {
      reference: packageInfo.reference,
      weight: packageInfo.weight,
      width: packageInfo.width,
      length: packageInfo.length,
      height: packageInfo.height,
      packing: 'caja',
      // Both field names — Shipit's docs are inconsistent across versions.
      courier,
      client: courier,
      commune: destinationAddress.commune,
      ...(originCommune ? { commune_origin: originCommune } : {}),
    },
    destiny: {
      full_name: destinationAddress.full_name,
      email: destinationAddress.email,
      phone: destinationAddress.phone,
      street: destinationAddress.street,
      number: destinationAddress.number,
      complement: destinationAddress.complement ?? '',
      commune: destinationAddress.commune,
    },
  };

  const data = await shipitFetch(env, '/packages', 'POST', body);
  if (!data) return { ok: false, error: 'shipit_unreachable' };

  // Shipit v4 wraps shipment under `.package` in some shapes; older shapes return
  // it at root. Try both.
  const root = (data['package'] as Record<string, unknown> | undefined) ?? data;
  const shipmentId = root['id'] != null ? String(root['id']) : undefined;
  const tracking =
    root['tracking_number'] != null
      ? String(root['tracking_number'])
      : root['reference'] != null
      ? String(root['reference'])
      : undefined;
  if (!shipmentId) return { ok: false, error: 'no_shipment_id' };
  return {
    ok: true,
    shipit_id: shipmentId,
    ...(tracking ? { tracking_code: tracking } : {}),
  };
}

/**
 * Consulta estado de un despacho. Acepta `idOrTracking`: si es numérico,
 * usa /packages/:id (preferido); si no, /tracking/:code?client=...
 */
export async function shipitTrack(env: Env, idOrTracking: string, courier: string): Promise<{
  status: string;
  detail?: string;
  estimated_delivery?: string;
  events?: Array<{ date: string; description: string }>;
} | null> {
  const cleaned = idOrTracking.replace(/[^A-Za-z0-9\-]/g, '');
  if (!cleaned || cleaned.length < 3) return null;
  const isNumeric = /^\d+$/.test(cleaned);
  const path = isNumeric
    ? `/packages/${encodeURIComponent(cleaned)}`
    : `/tracking/${encodeURIComponent(cleaned)}?client=${encodeURIComponent(courier)}`;
  const data = await shipitFetch(env, path, 'GET');
  if (!data) return null;
  const root = (data['package'] as Record<string, unknown> | undefined) ?? data;
  return {
    status: String(root['status'] ?? data['status'] ?? 'unknown'),
    ...(root['detail'] != null ? { detail: String(root['detail']) } : {}),
    ...(root['estimated_delivery'] != null ? { estimated_delivery: String(root['estimated_delivery']) } : {}),
    ...(Array.isArray(root['events']) ? { events: root['events'] as Array<{ date: string; description: string }> } : {}),
  };
}

/** URLs públicas de tracking de cada courier (fallback si shipit falla). */
export function externalTrackingUrl(courier: string, trackingCode: string): string {
  const code = encodeURIComponent(trackingCode);
  switch (courier.toLowerCase()) {
    case 'chilexpress':
      return `https://centrodeayuda.chilexpress.cl/seguimiento?codigo=${code}`;
    case 'starken':
      return `https://www.starken.cl/seguimiento?codigo=${code}`;
    case 'bluex':
    case 'blueexpress':
      return `https://www.bluex.cl/seguimiento?codigo=${code}`;
    case 'correoschile':
    case 'correos':
      return `https://www.correos.cl/seguimiento?codigo=${code}`;
    default:
      return `https://www.shipit.cl/seguimiento?codigo=${code}`;
  }
}
