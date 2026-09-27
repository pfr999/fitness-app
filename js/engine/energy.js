// Gasto energético adaptativo (TDEE), RMR inicial y proyección con el modelo de Hall.
// Ver docs/04-motor-calculo.md §2 y §3.

export const EPS = 24;               // kcal/kg/día: cambio del gasto por kg de peso (Hall 2011)
const FAT_KCAL = 9440, LEAN_KCAL = 1816;

/**
 * Densidad energética del cambio de peso (kcal/kg).
 * Forbes: fracción magra p = 10,4 / (10,4 + masa grasa); con fuerza + proteína alta se usa p/2.
 */
export function energyDensity(fatMassKg) {
  if (!fatMassKg || fatMassKg <= 0) return 7000;
  const p = (10.4 / (10.4 + fatMassKg)) * 0.5;
  const rho = p * LEAN_KCAL + (1 - p) * FAT_KCAL;
  return Math.min(8500, Math.max(5500, rho));
}

// ---------- RMR (arranque antes de tener datos propios) ----------
export const rmr = {
  tinsley: (ffmKg) => 25.9 * ffmKg + 284,
  cunningham: (ffmKg) => 500 + 22 * ffmKg,
  tenHaaf: ({ weightKg, heightCm, age, male = true }) =>
    11.936 * weightKg + 587.728 * (heightCm / 100) - 8.129 * age + 191.027 * (male ? 1 : 0) + 29.279,
};

/**
 * TDEE adaptativo con suavizado bayesiano.
 * @param {{date:string, intake:number|null, slope:number|null, slopeSd:number|null}[]} days
 *   intake: kcal del día (registradas o asumidas del plan); null = excluido (p. ej. "me salí")
 *   slope/slopeSd: pendiente del Kalman ese día (kg/día)
 * @param {{prior:number, priorSd?:number, rho?:number, window?:number, maxStep?:number}} o
 * @returns {{date:string, E:number, sd:number, ready:boolean}[]}
 */
export function adaptiveTDEE(days, { prior, priorSd = 300, rho = 7000, window = 21, maxStep = 50, drift = 20 } = {}) {
  let E = prior, P = priorSd ** 2;
  const out = [];
  for (let i = 0; i < days.length; i++) {
    P += drift ** 2;
    const d = days[i];
    let ready = false;
    if (i >= window - 1 && d.slope != null) {
      const win = days.slice(i - window + 1, i + 1).filter((x) => x.intake != null);
      if (win.length >= window * 0.6) {
        const mean = win.reduce((a, x) => a + x.intake, 0) / win.length;
        const varI = win.reduce((a, x) => a + (x.intake - mean) ** 2, 0) / win.length / win.length;
        const obs = mean - rho * d.slope;
        const R = (rho * (d.slopeSd ?? 0.02)) ** 2 + varI + 150 ** 2;
        const K = P / (P + R);
        const next = E + K * (obs - E);
        E += Math.max(-maxStep, Math.min(maxStep, next - E));
        P = (1 - K) * P;
        ready = true;
      }
    }
    out.push({ date: d.date, E, sd: Math.sqrt(P), ready });
  }
  return out;
}

/**
 * Proyección con el modelo dinámico linealizado de Hall.
 * W(t) = W0 + (ΔI/ε)(1 − e^(−t/τ)),  τ = ρ/ε
 * @returns {{rateWeek:number, days:number|null, W:(t:number)=>number}}
 *   rateWeek: ritmo inicial en kg/semana; days: días hasta goal (null si no alcanzable)
 */
export function hallProjection({ W0, E0, intake, goal = null, rho = 7000, eps = EPS }) {
  const dI = intake - E0;
  const tau = rho / eps;
  const W = (t) => W0 + (dI / eps) * (1 - Math.exp(-t / tau));
  let days = null;
  if (goal != null && dI !== 0 && Math.sign(goal - W0) === Math.sign(dI)) {
    const arg = 1 - (eps * (goal - W0)) / dI;
    if (arg > 0) days = -tau * Math.log(arg);
  }
  return { rateWeek: (dI / rho) * 7, days, W };
}
