// Balance de una semana: lo que se revisa en el control semanal. Puro: sin red ni DOM.

import { addDays, range } from '../dates.js';
import { planFor, kcalTarget, intakeFor, dietStatus, loggedKcal, sumItems, dayTargets } from '../model.js';
import { loggedVolume } from './training.js';

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

/** Objetivo de macros del día (ver dayTargets en model.js). */
export const macroTargets = (version, trained) => dayTargets(version, trained);

/**
 * Estado de cada día para la tabla de la semana.
 * diet: {status, kcal_delta} | null (sin validar) · kcal: la que cuenta para el gasto
 */
export function dayRow(date, day, version, adherence = {}) {
  const ds = dietStatus(day);
  const intake = intakeFor(date, day, version, adherence);
  const meals = day?.meals || [];
  const sets = (day?.session?.sets || []).filter((s) => !s.warmup);
  return {
    date,
    weight: day?.weight ?? null,
    steps: day?.steps ?? null,
    sleep: day?.sleep_h ?? null,
    trained: day?.trained,
    session: day?.session?.day || null,
    sets: sets.length,
    loggedKcal: meals.length ? loggedKcal(day) : null,
    mealsLogged: meals.filter((m) => m.items?.length).length,
    diet: ds,
    kcal: intake.kcal,
    assumed: intake.assumed,
    target: version ? kcalTarget(version, day?.trained) : null,
    validated: !!ds,
  };
}

/**
 * @param {{config, plan, days, exercises?}} data
 * @param {string} from  primer día (incluido)
 * @param {string} to    último día (incluido)
 * @param {{analysis?:object, adherence?:object, exercises?:object[]}} opts
 */
export function weekBalance({ plan, days }, from, to, { analysis = null, adherence = {}, exercises = [], until = null } = {}) {
  // las estadísticas solo cuentan hasta `until` (hoy): los días futuros no existen todavía
  const dates = range(from, until && until < to ? until : to);
  const last = dates[dates.length - 1] || to;
  const rows = dates.map((d) => dayRow(d, days[d], planFor(plan, d), adherence));
  const version = planFor(plan, to);

  // --- energía: media de los días con ingesta conocida (registrada o estimada)
  const known = rows.filter((r) => r.kcal != null);
  const kcalMean = mean(known.map((r) => r.kcal));
  const targetMean = mean(rows.map((r) => r.target).filter((x) => x != null));
  const byKind = {
    logged: rows.filter((r) => r.diet?.status === 'logged').length,
    estimated: rows.filter((r) => ['plan', 'over', 'under'].includes(r.diet?.status)).length,
    unknown: rows.filter((r) => r.diet?.status === 'unknown' || (r.diet && r.kcal == null)).length,
    pending: rows.filter((r) => !r.validated).length,
  };

  // --- macros: solo días con lo registrado como completo
  const loggedDays = dates.filter((d) => dietStatus(days[d])?.status === 'logged' && days[d]?.meals?.length);
  const macroDays = loggedDays.map((d) => sumItems((days[d].meals || []).flatMap((m) => m.items)));
  const macroTargetDays = loggedDays.map((d) => macroTargets(planFor(plan, d), days[d]?.trained));
  const macros = macroDays.length
    ? {
        days: macroDays.length,
        kcal: mean(macroDays.map((m) => m.kcal)), p: mean(macroDays.map((m) => m.p)), c: mean(macroDays.map((m) => m.c)), f: mean(macroDays.map((m) => m.f)),
        // objetivo: null si el plan no lo tiene (kcal y macros son opcionales)
        target: Object.fromEntries(['kcal', 'p', 'c', 'f'].map((k) => [k, mean(macroTargetDays.map((t) => t[k]).filter((x) => x != null))])),
      }
    : null;

  // --- actividad
  const steps = rows.map((r) => r.steps).filter((x) => x != null);
  const sleep = rows.map((r) => r.sleep).filter((x) => x != null);
  const sessions = rows.filter((r) => r.trained === true).length;
  const vol = loggedVolume(days, from, dates[dates.length - 1] || to, exercises);

  // --- peso: tendencia al inicio y al final (del análisis) y pesadas de la semana
  let weight = null;
  if (analysis && !analysis.empty) {
    const at = (d) => { const i = analysis.span.indexOf(d); return i >= 0 ? analysis.trend[i] : null; };
    const start = at(addDays(from, -1)) || at(from), end = at(last) || analysis.latest.trend;
    if (start && end) weight = { start: start.level, end: end.level, change: end.level - start.level, pctWeek: ((end.level - start.level) / start.level) * 100 * (7 / dates.length) };
  }
  const weighIns = rows.filter((r) => r.weight != null).length;
  const tdeeAt = analysis && !analysis.empty ? analysis.tdee[analysis.span.indexOf(last)] || analysis.latest.tdee : null;

  return {
    from, to, rows, version,
    energy: { kcalMean, targetMean, deficit: tdeeAt?.ready && kcalMean != null ? tdeeAt.E - kcalMean : null, tdee: tdeeAt?.ready ? tdeeAt.E : null, knownDays: known.length, ...byKind },
    macros,
    steps: { mean: mean(steps), days: steps.length, target: version?.targets?.steps ?? null },
    sleep: { mean: mean(sleep), days: sleep.length, target: version?.targets?.sleep_h ?? null },
    training: { sessions, target: version?.targets?.sessions ?? null, sets: rows.reduce((a, r) => a + r.sets, 0), volume: vol.byMuscle, unknown: vol.unknown },
    weight: { ...(weight || {}), weighIns },
  };
}
