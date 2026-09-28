// Fechas como texto 'AAAA-MM-DD' en hora LOCAL (pesarse a las 00:30 no cae en ayer).

const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function today() {
  return toISO(new Date());
}

export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12); // mediodía: evita saltos por cambio de hora
}

export function addDays(s, n) {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function daysBetween(a, b) {
  return Math.round((parseISO(b) - parseISO(a)) / 864e5);
}

export function monthKey(s) {
  return s.slice(0, 7);
}

/** Días desde a hasta b, ambos incluidos. */
export function range(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
  return out;
}

export function weekday(s) {
  return parseISO(s).getDay(); // 0 = domingo
}

/** Lunes de la semana de s. */
export function weekStart(s) {
  const wd = weekday(s);
  return addDays(s, wd === 0 ? -6 : 1 - wd);
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export function fmtShort(s) {
  const d = parseISO(s);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function fmtLong(s) {
  const d = parseISO(s);
  const day = DAYS[d.getDay()];
  return `${day[0].toUpperCase()}${day.slice(1)}, ${d.getDate()} de ${MONTHS_LONG[d.getMonth()]}`;
}

export function fmtDayShort(s) {
  const d = parseISO(s);
  return `${DAYS_SHORT[d.getDay()]} ${d.getDate()}`;
}

/** Último día con ese día de la semana (0 = domingo) en o antes de s. */
export function lastWeekday(s, wd) {
  const cur = weekday(s);
  return addDays(s, -((cur - wd + 7) % 7));
}

/** Primer día con ese día de la semana en o después de s. */
export function nextWeekday(s, wd) {
  return addDays(s, (wd - weekday(s) + 7) % 7);
}

/** Día de la semana `wd` más cercano a s (de 3 días antes a 3 después). */
export function nearestWeekday(s, wd) {
  return addDays(s, ((wd - weekday(s) + 10) % 7) - 3);
}

/** Número de semana ISO. */
export function isoWeek(s) {
  const d = parseISO(s);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 864e5 + 1) / 7);
}
