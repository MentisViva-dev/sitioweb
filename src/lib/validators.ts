/**
 * Validadores de inputs (cliente chileno).
 *
 * Todos retornan { ok: true, value } o { ok: false, error }.
 * Se usan en cada Worker antes de tocar BD.
 */

export interface ValidationOk<T> {
  ok: true;
  value: T;
}
export interface ValidationErr {
  ok: false;
  error: string;
}
export type ValidationResult<T> = ValidationOk<T> | ValidationErr;

const ok = <T>(value: T): ValidationOk<T> => ({ ok: true, value });
const err = (message: string): ValidationErr => ({ ok: false, error: message });

// =====================================================================
// Email
// =====================================================================

const EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function validateEmail(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') return err('Email es requerido');
  const email = input.trim().toLowerCase();
  if (email.length === 0) return err('Email es requerido');
  if (email.length > 255) return err('Email demasiado largo');
  if (!EMAIL_REGEX.test(email)) return err('Email inválido');
  // Anti header injection
  if (/[\r\n\0]/.test(email)) return err('Email inválido');
  return ok(email);
}

// =====================================================================
// Password
// =====================================================================

export function validatePassword(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') return err('Contraseña es requerida');
  if (input.length < 12) return err('La contraseña debe tener al menos 12 caracteres');
  if (input.length > 128) return err('Contraseña demasiado larga');
  // No exigimos complejidad (NIST 800-63B), pero sí bloqueamos las top-100 más comunes
  if (COMMON_PASSWORDS.has(input.toLowerCase())) {
    return err('Esta contraseña es muy común. Elige otra más segura.');
  }
  return ok(input);
}

const COMMON_PASSWORDS = new Set([
  '123456789012', 'qwertyuiopas', 'mentisviva123', 'mentisviva2026',
  'password1234', 'changeme1234', 'admin1234567', 'contraseña01',
  'contrasena01', 'editorial123', 'mentisvivaa1',
  // Truncado por brevedad. Idealmente cargar HIBP top 1k via KV.
]);

// =====================================================================
// RUT chileno (con dígito verificador)
// =====================================================================

export function validateRUT(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') return err('RUT es requerido');
  const cleaned = input.replace(/[^0-9kK]/g, '').toUpperCase();
  if (cleaned.length < 8 || cleaned.length > 9) return err('RUT inválido (formato XX.XXX.XXX-X)');
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  let sum = 0;
  let mul = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i] ?? '0', 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const r = 11 - (sum % 11);
  const expected = r === 11 ? '0' : r === 10 ? 'K' : String(r);
  if (dv !== expected) return err('RUT inválido (dígito verificador no coincide)');
  // Formato canónico: XX.XXX.XXX-X
  const formatted = body.slice(0, -3).replace(/\B(?=(\d{3})+(?!\d))/g, '.') +
    '.' + body.slice(-6, -3) + '.' + body.slice(-3) + '-' + dv;
  // Para evitar duplicar puntos, reformateamos limpio:
  return ok(formatRut(body, dv));
}

function formatRut(body: string, dv: string): string {
  let formatted = '';
  for (let i = body.length; i > 0; i -= 3) {
    const chunk = body.slice(Math.max(0, i - 3), i);
    formatted = chunk + (formatted ? '.' + formatted : '');
  }
  return `${formatted}-${dv}`;
}

// =====================================================================
// Teléfono chileno (+56 9 XXXX XXXX)
// =====================================================================

export function validatePhoneCL(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') return err('Teléfono inválido');
  const digits = input.replace(/[^\d]/g, '');
  // Formatos aceptados:
  //   569XXXXXXXX (11 dígitos con país)
  //   9XXXXXXXX   (9 dígitos sin país, agregar +56)
  let normalized = digits;
  if (normalized.startsWith('569') && normalized.length === 11) {
    // ok
  } else if (normalized.startsWith('9') && normalized.length === 9) {
    normalized = '56' + normalized;
  } else {
    return err('Teléfono debe ser celular chileno: +56 9 XXXX XXXX');
  }
  return ok('+' + normalized);
}

// =====================================================================
// Nombres y apellidos
// =====================================================================

export function validateName(input: unknown, fieldLabel = 'Nombre'): ValidationResult<string> {
  if (typeof input !== 'string') return err(`${fieldLabel} es requerido`);
  const trimmed = input.trim();
  if (trimmed.length === 0) return err(`${fieldLabel} es requerido`);
  if (trimmed.length > 80) return err(`${fieldLabel} demasiado largo (máx 80)`);
  // Permitir letras unicode (acentos, ñ), espacios, guiones, apóstrofes
  if (!/^[\p{L}\p{M}'\- .]+$/u.test(trimmed)) {
    return err(`${fieldLabel} contiene caracteres inválidos`);
  }
  return ok(trimmed);
}

// =====================================================================
// Direcciones
// =====================================================================

export function validateAddress(input: unknown, fieldLabel = 'Dirección'): ValidationResult<string> {
  if (typeof input !== 'string') return err(`${fieldLabel} es requerida`);
  const trimmed = input.trim();
  if (trimmed.length === 0) return err(`${fieldLabel} es requerida`);
  if (trimmed.length > 200) return err(`${fieldLabel} demasiado larga`);
  return ok(trimmed);
}

export function validatePostalCode(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') return err('Código postal inválido');
  const digits = input.replace(/[^\d]/g, '');
  if (digits.length !== 7) return err('Código postal chileno debe tener 7 dígitos');
  return ok(digits);
}

// =====================================================================
// Coordenadas GPS
// =====================================================================

export function validateLatLng(lat: unknown, lng: unknown): ValidationResult<{ lat: number; lng: number }> {
  const latNum = typeof lat === 'number' ? lat : typeof lat === 'string' ? parseFloat(lat) : NaN;
  const lngNum = typeof lng === 'number' ? lng : typeof lng === 'string' ? parseFloat(lng) : NaN;
  if (!isFinite(latNum) || latNum < -90 || latNum > 90) return err('Latitud inválida');
  if (!isFinite(lngNum) || lngNum < -180 || lngNum > 180) return err('Longitud inválida');
  // Chile aproximadamente: -56 a -17 lat, -76 a -66 lng. Tolerancia para Isla de Pascua.
  // Soft-validate para evitar direcciones obvias fuera de Chile.
  return ok({ lat: latNum, lng: lngNum });
}

// =====================================================================
// Pregunta y respuesta de seguridad
// =====================================================================

export function validateSecurityQuestion(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') return err('Pregunta de seguridad es requerida');
  const trimmed = input.trim();
  if (trimmed.length < 5) return err('Pregunta muy corta');
  if (trimmed.length > 200) return err('Pregunta muy larga');
  return ok(trimmed);
}

export function validateSecurityAnswer(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') return err('Respuesta de seguridad es requerida');
  const trimmed = input.trim().toLowerCase();
  if (trimmed.length < 3) return err('Respuesta muy corta');
  if (trimmed.length > 100) return err('Respuesta muy larga');
  return ok(trimmed);
}

// =====================================================================
// Plan name (debe ser uno de los del CMS)
// =====================================================================

export function validatePlanName(input: unknown, allowedPlans: string[]): ValidationResult<string> {
  if (typeof input !== 'string') return err('Plan inválido');
  const trimmed = input.trim();
  if (!allowedPlans.includes(trimmed)) return err('Plan no disponible');
  return ok(trimmed);
}

// =====================================================================
// Shipping method (whitelist)
// =====================================================================

const ALLOWED_SHIPPING_METHODS = new Set([
  'chilexpress', 'starken', 'bluex', 'correoschile', 'shipit', 'retiro',
]);

export function validateShippingMethod(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') return err('Método de envío inválido');
  const lower = input.trim().toLowerCase();
  if (!ALLOWED_SHIPPING_METHODS.has(lower)) return err('Método de envío no soportado');
  return ok(lower);
}

// =====================================================================
// Monto CLP
// =====================================================================

export function validateAmountCLP(input: unknown, opts: { min?: number; max?: number } = {}): ValidationResult<number> {
  const min = opts.min ?? 0;
  const max = opts.max ?? 1_000_000;
  let n: number;
  if (typeof input === 'number') {
    n = input;
  } else if (typeof input === 'string') {
    const cleaned = input.replace(/[^\d]/g, '');
    n = parseInt(cleaned, 10);
  } else {
    return err('Monto inválido');
  }
  if (!isFinite(n) || isNaN(n)) return err('Monto inválido');
  if (n < min) return err(`Monto debe ser mayor a ${min}`);
  if (n > max) return err(`Monto excede el máximo permitido`);
  return ok(Math.round(n));
}

// =====================================================================
// URL (para tiendas del catálogo, etc.)
// =====================================================================

export function validateUrl(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') return err('URL inválida');
  if (!/^https?:\/\//i.test(input)) return err('URL debe comenzar con http:// o https://');
  try {
    const u = new URL(input);
    if (!['http:', 'https:'].includes(u.protocol)) return err('Protocolo no permitido');
    return ok(u.toString());
  } catch {
    return err('URL inválida');
  }
}

// =====================================================================
// Tracking code (Shipit / courier)
// =====================================================================

export function validateTrackingCode(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') return err('Código de seguimiento inválido');
  const cleaned = input.replace(/[^A-Za-z0-9\-]/g, '');
  if (cleaned.length < 5 || cleaned.length > 40) return err('Código de seguimiento inválido');
  return ok(cleaned);
}

// =====================================================================
// Sanitizar texto libre (para mensaje de contacto, etc.)
// =====================================================================

export function sanitizeText(input: unknown, maxLen = 5000): string {
  if (typeof input !== 'string') return '';
  return input
    .slice(0, maxLen)
    // Eliminar control chars excepto \r \n \t
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim();
}
