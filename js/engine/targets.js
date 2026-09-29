// Objetivos por defecto y autorregulación. Ver docs/04-motor-calculo.md §4 y §6.

/**
 * Ritmo de pérdida recomendado (% peso/semana, en positivo) según % graso y sexo. En mujeres los
 * cortes suben 9 puntos (más grasa esencial: ~12 % frente a ~3 %): > 29 · 22–29 · < 22.
 */
export function rateTargetForBodyFat(bfPct, sex = 'M') {
  if (bfPct == null) return [0.4, 0.7];
  const k = sex === 'F' ? 9 : 0;
  if (bfPct > 20 + k) return [0.7, 1.0];
  if (bfPct >= 13 + k) return [0.4, 0.7];
  return [0.25, 0.5];
}

// ---------------------------------------------------------------- objetivo de la fase
/**
 * Objetivo del plan (targets.goal): pérdida, mantenimiento, volumen o sin objetivo (solo registro).
 * Un plan sin `goal` es de pérdida: así se comportaban todos antes de existir el campo.
 */
export const GOALS = [
  ['loss', 'Pérdida'],
  ['maintain', 'Mantenimiento'],
  ['gain', 'Volumen'],
  ['none', 'Sin objetivo'],
];
export const GOAL_LABEL = Object.fromEntries(GOALS);
export const goalOf = (version) => (GOAL_LABEL[version?.targets?.goal] ? version.targets.goal : 'loss');

/** Ritmo automático en mantenimiento (±, % peso/semana) y en volumen (ganancia, % peso/semana). */
export const MAINTAIN_BAND = 0.15;
export const GAIN_RATE = [0.15, 0.35];

/**
 * Franja de ritmo del objetivo, como cambio de peso con signo (% peso/semana; negativo = bajar).
 * `rate_pct_week` guarda la franja manual: en pérdida y volumen, [mín, máx] en la dirección del
 * objetivo (siempre positivos); en mantenimiento, [mín, máx] con signo (p. ej. [-0.2, 0.2]).
 * @returns {null | {goal, lo, hi, auto}}  null = sin objetivo
 */
export function rateBand(version, { bfPct = null, sex = 'M' } = {}) {
  const goal = goalOf(version);
  if (goal === 'none') return null;
  const m = version?.targets?.rate_pct_week;
  const manual = Array.isArray(m) && m.length === 2 && m.every((x) => x != null && Number.isFinite(+x)) ? [Math.min(+m[0], +m[1]), Math.max(+m[0], +m[1])] : null;
  if (goal === 'loss') { const [a, b] = manual || rateTargetForBodyFat(bfPct, sex); return { goal, lo: -b, hi: -a, auto: !manual }; }
  if (goal === 'gain') { const [a, b] = manual || GAIN_RATE; return { goal, lo: a, hi: b, auto: !manual }; }
  const [a, b] = manual || [-MAINTAIN_BAND, MAINTAIN_BAND];
  return { goal, lo: a, hi: b, auto: !manual };
}

/** Dónde cae un ritmo (% peso/semana, con signo) respecto a la franja: 'in' | 'below' | 'above' | null. */
export function rateStatus(band, pctWeek) {
  if (!band || pctWeek == null || Number.isNaN(pctWeek)) return null;
  if (pctWeek < band.lo) return 'below';
  if (pctWeek > band.hi) return 'above';
  return 'in';
}

const f = (n, d = 1) => (Math.abs(n) < 0.005 ? 0 : n).toFixed(d).replace('.', ',').replace('-', '−');
const fs = (n, d = 2) => (n > 0 ? '+' : '') + f(n, d);

/** Texto corto de la franja: «pérdida 0,7–1,0 %/sem», «estable ±0,15 %/sem», «ganancia 0,15–0,35 %/sem». */
export function bandText(band) {
  if (!band) return 'sin objetivo';
  if (band.goal === 'loss') return `pérdida ${f(-band.hi)}–${f(-band.lo)} %/sem`;
  if (band.goal === 'gain') return `ganancia ${f(band.lo, 2)}–${f(band.hi, 2)} %/sem`;
  if (Math.abs(band.lo + band.hi) < 1e-9) return `estable ±${f(band.hi, 2)} %/sem`;
  return `entre ${fs(band.lo)} y ${fs(band.hi)} %/sem`;
}

/**
 * Qué significa un ritmo para el objetivo: estado, tono ('good' | 'warn' | 'info') y frase.
 * null si no hay objetivo o no hay dato.
 */
export function rateVerdict(band, pctWeek) {
  const st = rateStatus(band, pctWeek);
  if (!st) return null;
  if (st === 'in') return { status: st, tone: 'good', text: `Dentro del objetivo (${bandText(band)}).` };
  if (band.goal === 'loss') return st === 'below'
    ? { status: st, tone: 'warn', text: `Pierdes más rápido que el objetivo (${bandText(band)}): riesgo para la masa magra.` }
    : { status: st, tone: 'info', text: `Más lento que el objetivo (${bandText(band)}).` };
  if (band.goal === 'gain') return st === 'above'
    ? { status: st, tone: 'warn', text: `Ganas más rápido que el objetivo (${bandText(band)}): más grasa de la necesaria.` }
    : { status: st, tone: 'info', text: `Más lento que el objetivo (${bandText(band)}).` };
  return { status: st, tone: 'info', text: `${st === 'below' ? 'Estás bajando' : 'Estás subiendo'} de peso (objetivo: ${bandText(band)}).` };
}

/**
 * ¿Un cambio de peso va «a favor» del objetivo? Para colorear flechas y cambios sin juzgar:
 * true (a favor), false (en contra) o null (neutro: mantenimiento o sin objetivo).
 */
export function favours(goal, delta) {
  if (delta == null || Math.abs(delta) < 1e-9) return null;
  if (goal === 'loss') return delta < 0;
  if (goal === 'gain') return delta > 0;
  return null;
}

/** Proteína en déficit: g/día a partir de masa magra (o peso si no hay %G). */
export function proteinRange({ ffmKg = null, weightKg = null }) {
  if (ffmKg) return [2.3 * ffmKg, 3.1 * ffmKg];
  if (weightKg) return [1.6 * weightKg, 2.2 * weightKg];
  return null;
}

/**
 * Autorregulación semanal estilo RP.
 * soreness 1–4 (1 nada … 4 aún dolorido) · performance 1–4 (1 superado … 4 no igualé)
 */
export function rpRecommendation(soreness, performance) {
  const s = soreness, p = performance;
  if (p === 4) return { label: 'Descarga', delta: null, tone: 'warn' };
  if (s === 1 && p === 1) return { label: '+2 series', delta: 2, tone: 'good' };
  if (s <= 2 && p <= 2) return { label: '+1 serie', delta: 1, tone: 'good' };
  if ((s === 3 && p <= 2) || (p === 3 && s <= 2)) return { label: 'Mantener', delta: 0, tone: 'neutral' };
  if (s === 4 && p <= 2) return { label: 'Mantener / −1', delta: -1, tone: 'warn' };
  return { label: '−1 serie', delta: -1, tone: 'warn' };
}

/** e1RM con Epley ajustado por RIR (RIR = 10 − RPE). Solo fiable con RPE ≥ 7. */
export function e1rm(kg, reps, rpe = 10) {
  if (!kg || !reps) return null;
  const effReps = Math.min(15, reps + Math.max(0, 10 - rpe));
  return { value: reps === 1 && rpe >= 10 ? kg : kg * (1 + effReps / 30), confident: rpe >= 7 };
}
