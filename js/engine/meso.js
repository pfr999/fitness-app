// Mesociclo: bloque de N semanas de carga con el esfuerzo (RIR) subiendo cada semana y una semana
// de descarga al final. Se guarda en la rutina del plan: routine.meso = { start, weeks, rir, deload }.
// Puro: sin red ni DOM.

import { daysBetween, addDays } from '../dates.js';

/** RIR por defecto para n semanas de carga: de 3 a 1 (lejos del fallo al principio, cerca al final). */
export function rirRamp(n) {
  if (n <= 1) return [2];
  return Array.from({ length: n }, (_, i) => Math.round(3 - (2 * i) / (n - 1)));
}

export function defaultMeso(start, weeks = 4) {
  return { start, weeks, rir: rirRamp(weeks), deload: true };
}

/** Semanas totales (carga + descarga). */
export const mesoLength = (m) => (m ? m.weeks + (m.deload ? 1 : 0) : 0);

/**
 * En qué semana del mesociclo cae `date`.
 * @returns {null | {week, total, rir, rpe, deload, done, before, from, to}}
 */
export function mesoWeek(meso, date) {
  if (!meso?.start || !meso.weeks) return null;
  const total = mesoLength(meso);
  const d = daysBetween(meso.start, date);
  if (d < 0) return { week: 0, total, before: true, done: false, deload: false, rir: null, rpe: null };
  const week = Math.floor(d / 7) + 1;
  if (week > total) return { week, total, done: true, before: false, deload: false, rir: null, rpe: null };
  const deload = !!meso.deload && week === total;
  const rir = deload ? 4 : (meso.rir?.[week - 1] ?? rirRamp(meso.weeks)[week - 1]);
  const from = addDays(meso.start, (week - 1) * 7);
  return { week, total, rir, rpe: 10 - rir, deload, done: false, before: false, from, to: addDays(from, 6) };
}

/** Descarga: la mitad de series (redondeando arriba) y ~10 % menos de peso. */
export const deloadSets = (sets) => Math.max(1, Math.ceil((sets || 1) / 2));
export function deloadKg(kg) {
  if (!kg) return kg;
  const step = kg >= 40 ? 2.5 : 1;
  return Math.round((kg * 0.9) / step) * step;
}
