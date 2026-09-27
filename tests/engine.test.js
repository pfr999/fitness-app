import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addDays, range, daysBetween, weekStart, monthKey, lastWeekday } from '../js/dates.js';
import { kalmanTrend, emaTrend, weeklyRate } from '../js/engine/trend.js';
import { adaptiveTDEE, hallProjection, energyDensity, rmr } from '../js/engine/energy.js';
import { faulkner, navyMale, rfm, whtr, whtrCategory, ffmi, sumSkinfolds, rollingMean, isRealChange } from '../js/engine/body.js';
import { rateTargetForBodyFat, rpRecommendation, e1rm } from '../js/engine/targets.js';
import { planFor, newPlanVersion, kcalTarget, intakeFor, sumItems, monthsBetween, emptyPlan } from '../js/model.js';
import { analyze } from '../js/engine/analysis.js';
import { simulate } from '../js/demo.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} esperado ${b} ± ${tol}, obtenido ${a}`);

// ---------- fechas ----------
test('fechas locales', () => {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2); // cruza cambio de hora
  assert.equal(range('2026-09-28', '2026-10-02').length, 5);
  assert.equal(weekStart('2026-09-27'), '2026-09-21'); // domingo → lunes anterior
  assert.equal(monthKey('2026-09-27'), '2026-09');
  // periodo de control con domingo como día de control
  assert.equal(lastWeekday('2026-09-28', 0), '2026-09-27'); // lunes → domingo anterior
  assert.equal(lastWeekday('2026-10-04', 0), '2026-10-04'); // el propio domingo
  assert.equal(lastWeekday('2026-10-03', 0), '2026-09-27'); // sábado → domingo anterior
  assert.deepEqual(monthsBetween('2026-11-15', '2027-02-01'), ['2026-11', '2026-12', '2027-01', '2027-02']);
});

// ---------- tendencia ----------
test('Kalman recupera nivel y pendiente de una bajada lineal con ruido y huecos', () => {
  const series = range('2026-01-01', addDays('2026-01-01', 59)).map((date, i) => {
    const noise = Math.sin(i * 12.9898) * 0.5; // ruido determinista ±0,5
    return { date, w: i % 9 === 4 ? null : +(90 - 0.07 * i + noise).toFixed(2) };
  });
  const t = kalmanTrend(series);
  const last = t[t.length - 1];
  close(last.level, 90 - 0.07 * 59, 0.5, 'nivel');
  close(last.slope, -0.07, 0.025, 'pendiente');
  assert.ok(last.sd < 0.6);
});

test('Kalman: huecos solo predicen y la incertidumbre crece', () => {
  const s = [{ date: '2026-01-01', w: 80 }, { date: '2026-01-02', w: 80 }, { date: '2026-01-03', w: null }, { date: '2026-01-04', w: null }];
  const t = kalmanTrend(s);
  assert.ok(t[3].sd > t[1].sd);
});

test('Kalman: un atípico se amortigua', () => {
  const s = range('2026-01-01', '2026-01-20').map((date) => ({ date, w: 80 }));
  s.push({ date: '2026-01-21', w: 84 });
  const t = kalmanTrend(s);
  assert.ok(t[t.length - 1].level < 80.6, 'el salto de 4 kg no debe arrastrar la tendencia');
});

test('EMA temporal y ritmo semanal', () => {
  const e = emaTrend([{ date: '2026-01-01', w: 80 }, { date: '2026-01-11', w: 70 }], { tau: 10 });
  close(e[1].level, 80 - 10 * (1 - Math.exp(-1)), 1e-9);
  const r = weeklyRate({ level: 100, slope: -0.1 });
  close(r.kgWeek, -0.7, 1e-9);
  close(r.pctWeek, -0.7, 1e-9);
});

// ---------- energía ----------
test('densidad energética acotada', () => {
  assert.equal(energyDensity(null), 7000);
  const r = energyDensity(14);
  assert.ok(r > 5500 && r < 8500);
  assert.ok(energyDensity(40) > energyDensity(8), 'más grasa → más densidad');
});

test('RMR de referencia', () => {
  close(rmr.tinsley(80), 2356, 0.5);
  close(rmr.cunningham(80), 2260, 0.5);
  const th = rmr.tenHaaf({ weightKg: 90, heightCm: 180, age: 35, male: true });
  assert.ok(th > 1800 && th < 2300);
});

test('TDEE adaptativo converge al gasto verdadero de la simulación', () => {
  const today = '2026-09-27';
  const sim = simulate({ today, weeks: 12, trueE: 2900 });
  const a = analyze(sim, { today });
  const truthNow = sim.truth.E[sim.truth.E.length - 1];
  close(a.latest.tdee.E, truthNow, 150, 'TDEE');
  assert.ok(a.latest.tdeeReliable);
});

test('Hall: ritmo inicial, asintota y tiempo hasta objetivo', () => {
  const p = hallProjection({ W0: 90, E0: 2900, intake: 2400, goal: 86 });
  close(p.rateWeek, (-500 / 7000) * 7, 1e-9);
  close(p.W(1e6), 90 - 500 / 24, 1e-6);
  assert.ok(p.days > 50 && p.days < 70);
  close(p.W(p.days), 86, 1e-6);
  assert.equal(hallProjection({ W0: 90, E0: 2900, intake: 2850, goal: 80 }).days, null, 'no alcanzable');
  assert.equal(hallProjection({ W0: 90, E0: 2900, intake: 3200, goal: 86 }).days, null, 'dirección contraria');
});

// ---------- composición ----------
test('fórmulas de composición', () => {
  close(faulkner({ triceps: 9, subscapular: 11, supraspinale: 10.4, abdominal: 17 }), 0.153 * 47.4 + 5.783, 1e-9);
  assert.equal(faulkner({ triceps: 9 }), null);
  const n = navyMale({ waist: 88, neck: 39, height: 180 });
  assert.ok(n > 10 && n < 20);
  close(rfm({ height: 180, waist: 90 }), 24, 1e-9);
  close(whtr({ waist: 90, height: 180 }), 0.5, 1e-9);
  assert.equal(whtrCategory(0.48), 'sano');
  assert.equal(whtrCategory(0.55), 'elevado');
  close(ffmi(80, 180).ffmi, 80 / 3.24, 1e-9);
  close(ffmi(80, 180).normalized, 80 / 3.24, 1e-9);
  assert.equal(sumSkinfolds({ a: 1, b: 2.5 }), 3.5);
  assert.deepEqual(rollingMean([1, 2, 3, null, 6], 3), [1, 1.5, 2, 2.5, 4.5]);
  assert.ok(isRealChange(-2.6, 2.5));
  assert.ok(!isRealChange(-0.6, 2.5));
});

// ---------- objetivos ----------
test('objetivo de ritmo según % graso', () => {
  assert.deepEqual(rateTargetForBodyFat(25), [0.7, 1.0]);
  assert.deepEqual(rateTargetForBodyFat(15), [0.4, 0.7]);
  assert.deepEqual(rateTargetForBodyFat(11), [0.25, 0.5]);
  assert.deepEqual(rateTargetForBodyFat(null), [0.4, 0.7]);
});

test('reglas RP', () => {
  assert.equal(rpRecommendation(1, 1).delta, 2);
  assert.equal(rpRecommendation(2, 2).delta, 1);
  assert.equal(rpRecommendation(3, 2).delta, 0);
  assert.equal(rpRecommendation(2, 3).delta, 0);
  assert.equal(rpRecommendation(4, 1).label, 'Mantener / −1');
  assert.equal(rpRecommendation(3, 3).delta, -1);
  assert.equal(rpRecommendation(1, 4).label, 'Descarga');
});

test('e1RM Epley + RIR', () => {
  close(e1rm(100, 8, 8).value, 100 * (1 + 10 / 30), 1e-9);
  assert.equal(e1rm(100, 1, 10).value, 100);
  assert.equal(e1rm(100, 10, 5).confident, false);
});

// ---------- modelo ----------
test('versiones del plan', () => {
  let plan = emptyPlan();
  plan.versions[0].from = '2026-08-01';
  plan = newPlanVersion(plan, { from: '2026-09-01', reason: '-200 kcal', mutate: (v) => { v.diet.kcal.train -= 200; } });
  assert.equal(planFor(plan, '2026-08-15').v, 1);
  assert.equal(planFor(plan, '2026-09-10').v, 2);
  assert.equal(planFor(plan, '2026-09-10').diet.kcal.train, 2600);
  assert.equal(planFor(plan, '2026-08-15').diet.kcal.train, 2800, 'la versión anterior no cambia');
  // dos ajustes el mismo día → una sola versión
  plan = newPlanVersion(plan, { from: '2026-09-01', reason: 'otro', mutate: (v) => { v.targets.steps = 12000; } });
  assert.equal(plan.versions.filter((v) => v.from === '2026-09-01').length, 1);
});

test('kcal objetivo e ingesta asumida', () => {
  const v = emptyPlan().versions[0]; // 2800 / 2500, 4 sesiones
  assert.equal(kcalTarget(v, true), 2800);
  assert.equal(kcalTarget(v, false), 2500);
  close(kcalTarget(v, undefined), (4 * 2800 + 3 * 2500) / 7, 1e-9);
  assert.deepEqual(intakeFor('2026-09-01', { trained: true }, v), { kcal: 2800, assumed: true });
  assert.deepEqual(intakeFor('2026-09-01', { trained: true }, v, { '2026-09-01': false }), { kcal: null, assumed: false });
  const day = { meals_complete: true, meals: [{ slot: 'Desayuno', items: [{ g: 200, per100: { kcal: 100, p: 10, c: 10, f: 1 } }] }] };
  assert.deepEqual(intakeFor('2026-09-01', day, v), { kcal: 200, assumed: false });
  const s = sumItems(day.meals[0].items);
  assert.deepEqual(s, { kcal: 200, p: 20, c: 20, f: 2 });
});

test('analyze con datos vacíos no rompe', () => {
  const a = analyze({ config: {}, plan: emptyPlan(), days: {} }, { today: '2026-09-27' });
  assert.equal(a.empty, true);
});
