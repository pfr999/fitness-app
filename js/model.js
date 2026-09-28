// Modelo de datos: plantillas iniciales y utilidades puras sobre los documentos del repo de datos.
// Ver docs/03-modelo-datos.md.

import { monthKey, today } from './dates.js';

export const FILES = {
  config: 'config.json',
  plan: 'plan.json',
  exercises: 'exercises.json',
  foods: 'foods.json',
  events: 'events.json',
  labs: 'labs.json',
  summary: 'resumen.md',
  month: (ym) => `days/${ym}.json`,
  photo: (date, pose) => `fotos/${date}/${pose}.jpg`,
};

/** Ruta de una foto de un control. Si el control se movió de fecha, las fotos siguen en su carpeta original. */
export function checkinPhotoPath(date, checkin, pose) {
  return FILES.photo(checkin?.photos_from || date, pose);
}

export const POSES = [
  { id: 'front', label: 'Frente' },
  { id: 'side_r', label: 'Perfil derecho' },
  { id: 'side_l', label: 'Perfil izquierdo' },
  { id: 'back', label: 'Espalda' },
];

export const DEFAULT_METRICS = [
  { id: 'waist', label: 'Cintura (ombligo)', unit: 'cm', group: 'perimeter', site: 'navel' },
  { id: 'abdomen', label: 'Abdomen', unit: 'cm', group: 'perimeter' },
  { id: 'hip', label: 'Cadera', unit: 'cm', group: 'perimeter' },
  { id: 'arm', label: 'Brazo relajado', unit: 'cm', group: 'perimeter' },
  { id: 'thigh', label: 'Muslo', unit: 'cm', group: 'perimeter' },
  { id: 'neck', label: 'Cuello', unit: 'cm', group: 'perimeter' },
  { id: 'triceps', label: 'Tríceps', unit: 'mm', group: 'skinfold' },
  { id: 'subscapular', label: 'Subescapular', unit: 'mm', group: 'skinfold' },
  { id: 'abdominal', label: 'Abdominal', unit: 'mm', group: 'skinfold' },
  { id: 'supraspinale', label: 'Supraespinal', unit: 'mm', group: 'skinfold', site: 'supraspinale' },
  { id: 'front_thigh', label: 'Muslo frontal', unit: 'mm', group: 'skinfold' },
  { id: 'bf_bia', label: '% graso (reloj)', unit: '%', group: 'device' },
];

export function emptyConfig() {
  return {
    version: 1,
    profile: { sex: 'M', height_cm: null, birth_year: null, notes: '' },
    metrics: DEFAULT_METRICS,
    formulas: { trend: 'kalman', bodyfat: 'faulkner' },
    alerts: [
      { id: 'rate_high', on: true, weeks: 2 },
      { id: 'rate_low', on: true, weeks: 2 },
      { id: 'steps_low', on: true, weeks: 2 },
      { id: 'no_weight', on: true, days: 3 },
    ],
    meal_slots: ['Desayuno', 'Comida', 'Merienda', 'Pre-entreno', 'Intra-entreno', 'Cena'],
    checkin_weekday: 0,
  };
}

export function emptyPlan() {
  return {
    versions: [
      {
        v: 1,
        from: today(),
        phase: '',
        micro: '',
        reason: 'Plan inicial',
        targets: { rate_pct_week: null, steps: 10000, sessions: 4, sleep_h: 7.5, waist_cm: null, weight_kg: null },
        diet: { kcal: { train: 2800, rest: 2500 }, protein_g: 200, carbs_g: 280, fat_g: 80, meals: [], rules: [] },
        routine: { days: [] },
        supplements: [],
      },
    ],
  };
}

export const emptyDocs = () => ({
  [FILES.config]: emptyConfig(),
  [FILES.plan]: emptyPlan(),
  [FILES.exercises]: { items: [] },
  [FILES.foods]: { custom: [], recipes: [], frequent: {} },
  [FILES.events]: { events: [] },
  [FILES.labs]: { markers: [], results: [] },
});

// ---------- Plan ----------

/** Versión del plan vigente en una fecha. */
export function planFor(planDoc, date) {
  const vs = [...(planDoc?.versions || [])].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.v - b.v));
  let cur = vs[0] || null;
  for (const v of vs) if (v.from <= date) cur = v;
  return cur;
}

export function currentPlan(planDoc) {
  return planFor(planDoc, today());
}

/** Nueva versión a partir de la vigente, con los cambios que aplique `mutate`. */
export function newPlanVersion(planDoc, { from = today(), reason = '', mutate, at = new Date().toISOString() }) {
  const base = structuredClone(currentPlan(planDoc));
  const same = planDoc.versions.find((x) => x.from === from);
  const change = { at, reason };
  let next;
  if (same) {
    // Varios cambios el mismo día = una sola versión (la de ese día), pero cada cambio queda anotado.
    const prior = same.changes?.length ? same.changes : [{ at: null, reason: same.reason }];
    next = { ...base, v: same.v, from, reason, changes: [...prior, change] };
  } else {
    next = { ...base, v: Math.max(0, ...planDoc.versions.map((x) => x.v)) + 1, from, reason, changes: [change] };
  }
  mutate?.(next);
  const versions = planDoc.versions.filter((x) => x.from !== from);
  return { ...planDoc, versions: [...versions, next] };
}

/** Número de versión mostrado: posición cronológica (1, 2, 3…), sin huecos. */
export function versionNumber(planDoc, version) {
  const vs = [...(planDoc?.versions || [])].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.v - b.v));
  return vs.findIndex((x) => x.v === version.v) + 1;
}

/** Kcal objetivo del día según si se entrena. trained: true | false | undefined (desconocido). */
export function kcalTarget(version, trained) {
  if (!version) return null;
  const { train, rest } = version.diet.kcal;
  if (trained === true) return train;
  if (trained === false) return rest;
  const s = Math.min(7, Math.max(0, version.targets?.sessions ?? 4));
  return (s * train + (7 - s) * rest) / 7;
}

// ---------- Días ----------

export function monthsBetween(fromISO, toISO) {
  const out = [];
  let [y, m] = fromISO.slice(0, 7).split('-').map(Number);
  const [ty, tm] = toISO.slice(0, 7).split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export { monthKey };

/** Suma de macros de una comida o lista de items. */
export function sumItems(items = []) {
  return items.reduce(
    (a, it) => {
      const f = it.g / 100;
      return { kcal: a.kcal + it.per100.kcal * f, p: a.p + it.per100.p * f, c: a.c + it.per100.c * f, f: a.f + it.per100.f * f };
    },
    { kcal: 0, p: 0, c: 0, f: 0 },
  );
}

/**
 * Estado de la dieta de un día (lo que se valida en la revisión semanal):
 *   logged  → lo apuntado es todo lo que se comió
 *   plan    → se comió según el plan
 *   over    → se comió más que el plan (kcal_delta > 0, aproximado)
 *   under   → se comió menos que el plan (kcal_delta < 0, aproximado)
 *   unknown → no se sabe: el día no se usa para calcular el gasto
 * Sin validar: «cerrar el día» (meals_complete) cuenta como logged; si no, pendiente (null).
 */
export function dietStatus(day) {
  if (day?.diet?.status) return day.diet;
  if (day?.meals_complete === true) return { status: 'logged' };
  return null;
}

export const loggedKcal = (day) => (day?.meals || []).reduce((a, m) => a + sumItems(m.items).kcal, 0);

/**
 * Ingesta del día para el TDEE.
 * - validado en la revisión semanal (day.diet) o día cerrado → lo que diga
 * - formato antiguo (respuesta semanal / por día del control) → ajuste sobre el plan
 * - sin validar → kcal del plan, marcado como supuesto (no registrar ≠ comer mal)
 */
export function intakeFor(date, day, version, adherence = {}) {
  const plan = kcalTarget(version, day?.trained);
  const ds = dietStatus(day);
  if (ds) {
    if (ds.status === 'logged') return { kcal: loggedKcal(day), assumed: false };
    if (ds.status === 'plan') return { kcal: plan, assumed: false };
    if (ds.status === 'over' || ds.status === 'under') {
      if (typeof ds.kcal_delta !== 'number') return { kcal: null, assumed: false };
      return { kcal: plan + ds.kcal_delta, assumed: false };
    }
    if (ds.status === 'unknown') return { kcal: null, assumed: false };
  }
  const a = adherence[date];
  if (a === false) return { kcal: null, assumed: false };
  if (typeof a === 'number') return { kcal: plan + a, assumed: false };
  return { kcal: plan, assumed: true };
}
