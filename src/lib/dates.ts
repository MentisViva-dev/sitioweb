/**
 * Cálculo de cutoff dinámico (10 días hábiles antes del 25) y manejo de
 * feriados chilenos.
 *
 * Reemplaza la lógica PHP de shipping.php que calculaba esto cada vez.
 * Aquí lo cacheamos en memoria del Worker (cold start = 1 vez).
 */

/**
 * Feriados chilenos fijos (mes-día). Los movibles se calculan abajo.
 * Lista basada en dt.gob.cl. Mantener actualizada cada año si hay cambios.
 */
const FIXED_HOLIDAYS_CL = [
  '01-01', // Año Nuevo
  '05-01', // Día del Trabajador
  '05-21', // Día de las Glorias Navales
  '06-29', // San Pedro y San Pablo (movible — se mueve a lunes a veces)
  '07-16', // Virgen del Carmen
  '08-15', // Asunción de la Virgen
  '09-18', // Independencia Nacional
  '09-19', // Día de las Glorias del Ejército
  '10-12', // Encuentro de Dos Mundos (movible)
  '10-31', // Día de las Iglesias Evangélicas (movible)
  '11-01', // Día de Todos los Santos
  '12-08', // Inmaculada Concepción
  '12-25', // Navidad
];

/**
 * Feriados específicos por año (calcular cada año o cargar de tabla).
 * Estos son los movibles + adicionales declarados.
 * Para 2025-2027:
 */
const SPECIFIC_HOLIDAYS: Record<string, string[]> = {
  '2025': ['2025-04-18', '2025-04-19', '2025-09-19', '2025-10-12', '2025-10-31'],
  '2026': ['2026-04-03', '2026-04-04', '2026-09-18', '2026-10-12', '2026-10-31'],
  '2027': ['2027-03-26', '2027-03-27', '2027-09-17', '2027-10-11', '2027-10-31'],
};

function isHoliday(date: Date): boolean {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = String(date.getUTCFullYear());
  const fixedKey = `${month}-${day}`;
  if (FIXED_HOLIDAYS_CL.includes(fixedKey)) return true;
  const specific = SPECIFIC_HOLIDAYS[year];
  if (specific && specific.includes(`${year}-${month}-${day}`)) return true;
  return false;
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6; // Domingo o Sábado
}

function isBusinessDay(date: Date): boolean {
  return !isWeekend(date) && !isHoliday(date);
}

/** Resta N días hábiles a una fecha. Retorna nueva Date. */
function subtractBusinessDays(date: Date, days: number): Date {
  const result = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() - 1);
    if (isBusinessDay(result)) remaining--;
  }
  return result;
}

/**
 * Calcula la fecha de cutoff (10 días hábiles antes del día 25 del mes).
 * Para `year`, `month` (1-12) → retorna Date con la fecha del cutoff.
 */
export function calculateCutoffDate(
  year: number,
  month: number,
  shipDay = 25,
  businessDays = 10,
): Date {
  // Día de despacho (25 del mes)
  const shipDate = new Date(Date.UTC(year, month - 1, shipDay, 0, 0, 0));
  // Restar N días hábiles
  return subtractBusinessDays(shipDate, businessDays);
}

/** Determina la próxima fecha de despacho desde "ahora". */
export function determineNextShipmentDate(now: Date = new Date(), shipDay = 25): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const thisMonth = new Date(Date.UTC(year, month - 1, shipDay, 0, 0, 0));
  // Si ya pasó el día de despacho de este mes (o estamos en él), próximo mes.
  if (now.getUTCDate() > shipDay) {
    return new Date(Date.UTC(year, month, shipDay, 0, 0, 0));
  }
  return thisMonth;
}

/**
 * Determina si la fecha actual está en la "ventana locked"
 * (entre cutoff y día 25 del mes inclusive).
 */
export function isInLockedWindow(
  now: Date = new Date(),
  shipDay = 25,
  businessDays = 10,
): boolean {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const cutoff = calculateCutoffDate(year, month, shipDay, businessDays);
  const day = now.getUTCDate();
  // Locked si estamos entre cutoff y antes de día 26
  return now >= cutoff && day <= shipDay;
}

/** Calcula días hasta la próxima fecha de cutoff. Retorna 0 si ya pasó. */
export function daysUntilCutoff(
  now: Date = new Date(),
  shipDay = 25,
  businessDays = 10,
): number {
  const next = determineNextShipmentDate(now, shipDay);
  const cutoff = calculateCutoffDate(next.getUTCFullYear(), next.getUTCMonth() + 1, shipDay, businessDays);
  if (now >= cutoff) return 0;
  const diffMs = cutoff.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / 86_400_000));
}

/** Formatea fecha en es-CL (dd/mm/yyyy). */
export function formatDateCL(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = d.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}

/** ISO date YYYY-MM-DD */
export function formatISODate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().slice(0, 10);
}

/** Fecha ISO completa (datetime) */
export function nowISO(): string {
  return new Date().toISOString();
}

/** Suma N días a una fecha. */
export function addDays(date: Date, days: number): Date {
  const r = new Date(date);
  r.setUTCDate(r.getUTCDate() + days);
  return r;
}

/** Primer día del mes siguiente. */
export function firstDayOfNextMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** YYYY-MM string (shipment_month). */
export function shipmentMonthStr(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Trial days hasta el próximo cutoff. */
export function calculateTrialDays(
  now: Date = new Date(),
  shipDay = 25,
  businessDays = 10,
): number {
  // Si ya pasó el cutoff de este mes, trial = días hasta cutoff del próximo mes.
  const days = daysUntilCutoff(now, shipDay, businessDays);
  if (days > 0) return days;
  // Ya pasó cutoff: calcular desde primer día del mes siguiente
  const next = firstDayOfNextMonth(now);
  const cutoff = calculateCutoffDate(next.getUTCFullYear(), next.getUTCMonth() + 1, shipDay, businessDays);
  const diffMs = cutoff.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / 86_400_000));
}
