// Tendencia de peso: filtro de Kalman de tendencia lineal local (nivel + pendiente).
// Ver docs/04-motor-calculo.md §1.

import { daysBetween } from '../dates.js';

/**
 * @param {{date:string, w:number|null}[]} series  ordenada por fecha; w = null si no hubo pesada
 * @param {{sigma?:number, q?:number}} opts  sigma: ruido diario (kg); q: ruido de proceso (kg²/día³)
 * @returns {({date:string, level:number, slope:number, sd:number, slopeSd:number}|null)[]}
 *          null hasta la primera pesada. slope en kg/día.
 */
export function kalmanTrend(series, { sigma = 0.6, q = 1e-4 } = {}) {
  let x = null, P = null, last = null;
  const out = [];
  for (const { date, w } of series) {
    if (x === null) {
      if (w == null) { out.push(null); continue; }
      x = [w, 0];
      P = [[sigma * sigma, 0], [0, 0.01]];
      last = date;
      out.push({ date, level: w, slope: 0, sd: sigma, slopeSd: 0.1 });
      continue;
    }
    const dt = Math.max(1, daysBetween(last, date));
    last = date;
    // Predicción
    x = [x[0] + dt * x[1], x[1]];
    const q00 = q * dt ** 3 / 3, q01 = q * dt ** 2 / 2, q11 = q * dt;
    P = [
      [P[0][0] + dt * (P[1][0] + P[0][1]) + dt * dt * P[1][1] + q00, P[0][1] + dt * P[1][1] + q01],
      [P[1][0] + dt * P[1][1] + q01, P[1][1] + q11],
    ];
    // Corrección
    if (w != null) {
      let R = sigma * sigma;
      const y = w - x[0];
      let S = P[0][0] + R;
      if (Math.abs(y) > 3 * Math.sqrt(S)) { R *= 9; S = P[0][0] + R; } // atípico: se le da menos peso
      const K = [P[0][0] / S, P[1][0] / S];
      x = [x[0] + K[0] * y, x[1] + K[1] * y];
      P = [
        [(1 - K[0]) * P[0][0], (1 - K[0]) * P[0][1]],
        [P[1][0] - K[1] * P[0][0], P[1][1] - K[1] * P[0][1]],
      ];
    }
    out.push({ date, level: x[0], slope: x[1], sd: Math.sqrt(Math.max(P[0][0], 0)), slopeSd: Math.sqrt(Math.max(P[1][1], 0)) });
  }
  return out;
}

/** EMA consciente del tiempo (respaldo y explicación). tau en días. */
export function emaTrend(series, { tau = 8 } = {}) {
  let T = null, last = null;
  return series.map(({ date, w }) => {
    if (w == null) return T == null ? null : { date, level: T };
    if (T == null) { T = w; last = date; return { date, level: T }; }
    const dt = Math.max(1, daysBetween(last, date));
    last = date;
    T += (1 - Math.exp(-dt / tau)) * (w - T);
    return { date, level: T };
  });
}

/** Ritmo semanal a partir de un punto del Kalman. */
export function weeklyRate(point) {
  if (!point) return null;
  const kg = point.slope * 7;
  return { kgWeek: kg, pctWeek: point.level ? (kg / point.level) * 100 : 0 };
}
