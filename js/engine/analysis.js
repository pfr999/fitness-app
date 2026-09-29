// Análisis: une los documentos del repo de datos con el motor y devuelve todo lo derivado.
// Es puro: no toca red ni DOM.

import { addDays, range, daysBetween, isoWeek } from '../dates.js';
import { planFor, intakeFor, kcalTarget, assumesPlan } from '../model.js';
import { kalmanTrend, weeklyRate } from './trend.js';
import { adaptiveTDEE, hallProjection, energyDensity, rmr } from './energy.js';
import { faulkner, navyMale, navyFemale, whtr, ffm, sumSkinfolds, MDC } from './body.js';
import { rateBand, rateStatus, bandText } from './targets.js';

/**
 * @param {{config:object, plan:object, days:Object<string,object>}} data  days = mapa fecha → día
 * @param {{today:string}} opts
 */
export function analyze({ config, plan, days }, { today }) {
  const dates = Object.keys(days).sort();
  const profile = config?.profile || {};
  const firstWeight = dates.find((d) => days[d]?.weight != null);
  if (!firstWeight) return { empty: true, checkins: checkinsOf(days, dates), latest: {} };

  const span = range(firstWeight, today);
  const series = span.map((date) => ({ date, w: days[date]?.weight ?? null }));
  const trend = kalmanTrend(series);
  const curTrend = [...trend].reverse().find(Boolean);

  // ---- composición (último control con datos) ----
  const checkins = checkinsOf(days, dates);
  const body = bodyComposition(checkins, profile, curTrend?.level);

  // ---- TDEE adaptativo ----
  const adherence = adherenceMap(checkins, days);
  const intakes = span.map((date) => {
    const v = planFor(plan, date);
    return { date, ...intakeFor(date, days[date], v, adherence) };
  });
  const rho = energyDensity(body.fatMass);
  const prior = priorTDEE(profile, curTrend?.level, body.ffm);
  const tdeeSeries = adaptiveTDEE(
    span.map((date, i) => ({ date, intake: intakes[i].kcal, slope: trend[i]?.slope ?? null, slopeSd: trend[i]?.slopeSd ?? null })),
    { prior, rho },
  );
  const curTDEE = tdeeSeries[tdeeSeries.length - 1];
  const last21 = intakes.slice(-21);
  const assumedShare = last21.filter((x) => x.assumed).length / Math.max(1, last21.length);

  // ---- ritmo y objetivos ----
  const rate = weeklyRate(curTrend);
  const version = planFor(plan, today);
  // franja de ritmo del objetivo (con signo: negativo = bajar); null con «Sin objetivo»
  const rateTarget = rateBand(version, { bfPct: body.bfMid, sex: profile.sex });
  const dataDays = daysBetween(firstWeight, today) + 1;

  // ---- previsión con el plan actual (solo si el plan tiene kcal y un objetivo) ----
  const planIntake = assumesPlan(version) ? kcalTarget(version, undefined) : null;
  const goal = rateTarget && rateTarget.goal !== 'maintain' ? version?.targets?.weight_kg ?? null : null;
  const projection = curTrend && curTDEE && planIntake != null ? hallProjection({ W0: curTrend.level, E0: curTDEE.E, intake: planIntake, goal, rho }) : null;

  return {
    empty: false,
    span, series, trend, intakes, tdee: tdeeSeries, rho,
    latest: {
      trend: curTrend,
      rate,
      rateTarget,
      rateReliable: dataDays >= 14,
      tdee: curTDEE,
      tdeeReliable: dataDays >= 21 && curTDEE?.ready,
      tdeeAssumedShare: assumedShare,
      projection,
      goal,
      dataDays,
    },
    body,
    checkins,
    alerts: alertsFor({ config, days, span, trend, rate, rateTarget, version, today, dataDays }),
  };
}

/**
 * Traduce la respuesta semanal del control a un ajuste por día, solo para los días SIN registro completo
 * de comidas dentro de los 7 días que revisa ese control:
 *   según plan → sin ajuste · me pasé/me quedé corto con cifra → la cifra repartida entre esos días
 *   me pasé/me quedé corto sin cifra, o no lo sé → esos días no se usan (false)
 * Los días con registro completo usan siempre lo registrado.
 */
export function adherenceMap(checkins, days) {
  const out = {};
  for (const { date, checkin } of checkins) {
    Object.assign(out, checkin.adherence_days || {}); // formato antiguo (por día)
    const a = checkin.adherence;
    if (!a || a.status === 'plan') continue;
    const unlogged = range(addDays(date, -6), date).filter((d) => days[d]?.meals_complete !== true);
    if (!unlogged.length) continue;
    const perDay = (a.status === 'over' || a.status === 'under') && typeof a.kcal_week === 'number' ? a.kcal_week / unlogged.length : null;
    for (const d of unlogged) out[d] = perDay == null ? false : perDay;
  }
  return out;
}

function checkinsOf(days, dates) {
  return dates.filter((d) => days[d]?.checkin).map((d) => ({ date: d, weight: days[d].weight ?? null, checkin: days[d].checkin }));
}

function priorTDEE(profile, weight, ffmKg) {
  const PAL = 1.6;
  if (ffmKg) return rmr.tinsley(ffmKg) * PAL;
  const age = profile.birth_year ? new Date().getFullYear() - profile.birth_year : 35;
  if (weight && profile.height_cm) return rmr.tenHaaf({ weightKg: weight, heightCm: profile.height_cm, age, male: profile.sex !== 'F' }) * PAL;
  return 2500;
}

/** Composición a partir de los controles. Devuelve también series para gráficas. */
export function bodyComposition(checkins, profile, weightNow) {
  const height = profile.height_cm;
  const male = profile.sex !== 'F';
  const rows = checkins.map(({ date, weight, checkin }) => {
    const m = checkin.measures || {}, sf = checkin.skinfolds || {};
    const bfF = faulkner({ triceps: sf.triceps, subscapular: sf.subscapular, supraspinale: sf.supraspinale, abdominal: sf.abdominal });
    const bfN = male ? navyMale({ waist: m.waist, neck: m.neck, height }) : navyFemale({ waist: m.waist, neck: m.neck, hip: m.hip, height });
    return { date, weight, waist: m.waist ?? null, abdomen: m.abdomen ?? null, sum: sumSkinfolds(sf), bfF, bfN, bia: m.bf_bia ?? null, measures: m, skinfolds: sf };
  });
  const last = [...rows].reverse();
  const pick = (k) => last.find((r) => r[k] != null)?.[k] ?? null;
  const estimates = [pick('bfF'), pick('bfN')].filter((v) => v != null);
  const bfLow = estimates.length ? Math.min(...estimates) : null;
  const bfHigh = estimates.length ? Math.max(...estimates) : null;
  const bfMid = estimates.length ? estimates.reduce((a, b) => a + b, 0) / estimates.length : pick('bia');
  const w = weightNow ?? pick('weight');
  const ffmKg = ffm(w, bfMid);
  const waist = pick('waist');
  return {
    rows,
    bfFaulkner: pick('bfF'), bfNavy: pick('bfN'), bfBia: pick('bia'),
    bfLow, bfHigh, bfMid,
    ffm: ffmKg,
    fatMass: w != null && bfMid != null ? w * bfMid / 100 : null,
    waist, whtr: whtr({ waist, height }),
    sum: pick('sum'),
    MDC,
  };
}

function alertsFor({ config, days, span, trend, rate, rateTarget, version, today, dataDays }) {
  const on = (id) => (config?.alerts || []).find((a) => a.id === id)?.on !== false;
  const out = [];
  // Ritmo fuera de la franja del objetivo 2 semanas seguidas (hoy y hace 7 días). Sin objetivo, no hay aviso.
  if (dataDays >= 21 && rate && rateTarget) {
    const past = trend[trend.length - 8];
    const pastPct = past ? (past.slope * 7 / past.level) * 100 : null;
    const now = rateStatus(rateTarget, rate.pctWeek), before = rateStatus(rateTarget, pastPct);
    const txt = `${fmt(rate.pctWeek, 2)} %/sem (objetivo: ${bandText(rateTarget)}).`;
    if (now !== 'in' && now === before) {
      const g = rateTarget.goal;
      // «rápido» en la dirección del objetivo = rate_high; «lento» o en contra = rate_low
      const fast = (g === 'loss' && now === 'below') || (g === 'gain' && now === 'above');
      if (g === 'maintain') {
        if (on('rate_high')) out.push({ tone: 'info', title: `${now === 'below' ? 'Bajando' : 'Subiendo'} de peso 2 semanas`, text: `${txt} Si quieres mantenerte, revisa la ingesta.` });
      } else if (fast && on('rate_high')) {
        out.push({ tone: 'warn', title: `${g === 'loss' ? 'Pierdes' : 'Ganas'} demasiado rápido 2 semanas`, text: `${txt} ${g === 'loss' ? 'Riesgo para la masa magra.' : 'Más grasa de la necesaria.'}` });
      } else if (!fast && on('rate_low')) {
        out.push({ tone: 'info', title: 'Ritmo por debajo del objetivo 2 semanas', text: txt });
      }
    }
  }
  // Pasos
  const goalSteps = version?.targets?.steps;
  if (on('steps_low') && goalSteps) {
    const avg = (from, to) => {
      const v = range(from, to).map((d) => days[d]?.steps).filter((x) => x != null);
      return v.length >= 4 ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const a = avg(addDays(today, -6), today), b = avg(addDays(today, -13), addDays(today, -7));
    if (a != null && b != null && a < goalSteps * 0.9 && b < goalSteps * 0.9)
      out.push({ tone: 'warn', title: 'Pasos bajo objetivo 2 semanas', text: `Media ${thousands(a)} de ${thousands(goalSteps)}.` });
  }
  // Sin pesarse
  if (on('no_weight')) {
    const lastW = [...span].reverse().find((d) => days[d]?.weight != null);
    const gap = lastW ? daysBetween(lastW, today) : null;
    if (gap != null && gap >= 3) out.push({ tone: 'info', title: `${gap} días sin pesarte`, text: 'La tendencia sigue calculándose, pero con más incertidumbre.' });
  }
  return out;
}

const thousands = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const fmt = (n, d = 1) => n.toFixed(d).replace('.', ',');

/** Resumen de los 7 días que terminan en `date` (el periodo que revisa un control). */
export function weekSummary({ days, plan }, date) {
  const from = addDays(date, -6), to = date;
  const ds = range(from, to);
  const vals = (k) => ds.map((d) => days[d]?.[k]).filter((v) => v != null);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const version = planFor(plan, to);
  return {
    from, to, week: isoWeek(to),
    steps: mean(vals('steps')),
    sleep: mean(vals('sleep_h')),
    sessions: ds.filter((d) => days[d]?.trained === true).length,
    weighIns: vals('weight').length,
    unloggedDays: ds.filter((d) => d <= date && !(days[d]?.meals_complete === true)),
    targets: version?.targets || {},
  };
}
