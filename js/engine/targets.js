// Objetivos por defecto y autorregulación. Ver docs/04-motor-calculo.md §4 y §6.

/** Ritmo de pérdida recomendado (% peso/semana) según % graso. */
export function rateTargetForBodyFat(bfPct) {
  if (bfPct == null) return [0.4, 0.7];
  if (bfPct > 20) return [0.7, 1.0];
  if (bfPct >= 13) return [0.4, 0.7];
  return [0.25, 0.5];
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
