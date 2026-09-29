// Datos simulados para el modo demo y los tests. Nada de esto es real.
// Simula un "gasto verdadero" y un peso que sigue la dinámica de Hall, con ruido diario.

import { addDays, range, weekday } from './dates.js';
import { emptyConfig, emptyPlan } from './model.js';

function rng(seed) {
  let s = seed;
  const u = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const gauss = () => { let a = 0, b = 0; while (!a) a = u(); while (!b) b = u(); return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b); };
  return { u, gauss };
}

/**
 * @returns {{config, plan, days, truth:{E:number[]}}}
 */
export function simulate({ today, weeks = 12, seed = 11, W0 = 90, trueE = 2900, planKcal = [2600, 2300], rho = 7000, eps = 24, missing = 0.1 }) {
  const { u, gauss } = rng(seed);
  const start = addDays(today, -weeks * 7 + 1);
  const config = emptyConfig();
  config.profile = { sex: 'M', height_cm: 180, birth_year: 1990, notes: '' };
  const plan = emptyPlan();
  Object.assign(plan.versions[0], { from: start, phase: 'Demo', micro: '1/6', reason: 'Plan de ejemplo' });
  plan.versions[0].diet.kcal = { train: planKcal[0], rest: planKcal[1] };
  plan.versions[0].targets.weight_kg = W0 - 5;
  plan.versions[0].targets.goal = 'loss'; // la demo simula una fase de pérdida

  const days = {};
  const truth = { E: [] };
  let W = W0;
  for (const date of range(start, today)) {
    const trained = [1, 2, 4, 5].includes(weekday(date));
    const I = (trained ? planKcal[0] : planKcal[1]) + gauss() * 100;
    const E = trueE + eps * (W - W0);
    truth.E.push(E);
    W += (I - E) / rho;
    const day = { trained, steps: Math.round(8500 + gauss() * 1800), sleep_h: +(7.2 + gauss() * 0.5).toFixed(1) };
    if (u() > missing) day.weight = +(W + gauss() * 0.45).toFixed(1);
    days[date] = day;
  }
  // controles semanales (domingos)
  let k = 0;
  for (const date of Object.keys(days)) {
    if (weekday(date) !== 0) continue;
    const waist = +(88 - k * 0.25 + gauss() * 0.4).toFixed(1);
    days[date].checkin = {
      measures: { waist, abdomen: +(waist + 1.5).toFixed(1), neck: 39, hip: 100 },
      skinfolds: { triceps: +(10 - k * 0.1).toFixed(1), subscapular: 12, abdominal: +(20 - k * 0.3).toFixed(1), supraspinale: 11, front_thigh: 16 },
      ratings: { diet: 3, training: 3, sleep: 2, stress: 1 },
      note: '', decision: { type: 'keep', text: '' },
    };
    k++;
  }
  return { config, plan, days, truth };
}
