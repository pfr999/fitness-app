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
export function newPlanVersion(planDoc, { from = today(), reason = '', mutate }) {
  const base = structuredClone(currentPlan(planDoc));
  const v = Math.max(0, ...planDoc.versions.map((x) => x.v)) + 1;
  const next = { ...base, v, from, reason };
  mutate?.(next);
  // Si ya hay una versión que empieza hoy, se sustituye (varios ajustes el mismo día = una versión).
  const versions = planDoc.versions.filter((x) => x.from !== from);
  return { ...planDoc, versions: [...versions, next] };
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
 * Ingesta del día para el TDEE.
 * - meals_complete === true → suma registrada
 * - confirmado "me salí" en el domingo → null (excluido)
 * - en otro caso → kcal del plan (no registrar ≠ comer mal)
 */
export function intakeFor(date, day, version, adherence = {}) {
  if (adherence[date] === false) return { kcal: null, assumed: false };
  if (day?.meals_complete === true && day.meals?.length) {
    const kcal = day.meals.reduce((a, m) => a + sumItems(m.items).kcal, 0);
    return { kcal, assumed: false };
  }
  return { kcal: kcalTarget(version, day?.trained), assumed: true };
}
