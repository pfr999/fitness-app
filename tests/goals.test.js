import { test } from 'node:test';
import assert from 'node:assert/strict';

import { goalOf, rateBand, rateStatus, rateVerdict, bandText, favours, MAINTAIN_BAND, GAIN_RATE } from '../js/engine/targets.js';
import { emptyPlan, planKcal, kcalTarget, dayTargets, assumesPlan, intakeFor } from '../js/model.js';
import { analyze } from '../js/engine/analysis.js';
import { exportPlan, parsePlan } from '../js/plan-io.js';
import { addDays, range } from '../js/dates.js';

const plan = (targets = {}, diet = {}) => {
  const v = structuredClone(emptyPlan().versions[0]);
  v.targets = { ...v.targets, ...targets };
  v.diet = { ...v.diet, ...diet };
  return v;
};

test('objetivo: sin campo es pérdida (planes anteriores); los planes nuevos, mantenimiento', () => {
  assert.equal(goalOf({ targets: {} }), 'loss');
  assert.equal(goalOf({ targets: { goal: 'raro' } }), 'loss');
  assert.equal(goalOf(emptyPlan().versions[0]), 'maintain');
  assert.equal(goalOf(plan({ goal: 'gain' })), 'gain');
});

test('franja de ritmo con signo según el objetivo', () => {
  assert.deepEqual(rateBand(plan({ goal: 'loss' }), { bfPct: 25 }), { goal: 'loss', lo: -1.0, hi: -0.7, auto: true });
  assert.deepEqual(rateBand(plan({ goal: 'loss', rate_pct_week: [0.5, 0.3] })), { goal: 'loss', lo: -0.5, hi: -0.3, auto: false });
  assert.deepEqual(rateBand(plan({ goal: 'maintain' })), { goal: 'maintain', lo: -MAINTAIN_BAND, hi: MAINTAIN_BAND, auto: true });
  assert.deepEqual(rateBand(plan({ goal: 'maintain', rate_pct_week: [-0.2, 0.1] })), { goal: 'maintain', lo: -0.2, hi: 0.1, auto: false });
  assert.deepEqual(rateBand(plan({ goal: 'gain' })), { goal: 'gain', lo: GAIN_RATE[0], hi: GAIN_RATE[1], auto: true });
  assert.equal(rateBand(plan({ goal: 'none' })), null);
});

test('estado, veredicto y texto del ritmo', () => {
  const loss = rateBand(plan({ goal: 'loss' }), { bfPct: 15 }); // pérdida 0,4–0,7
  assert.equal(rateStatus(loss, -0.5), 'in');
  assert.equal(rateStatus(loss, -1.2), 'below'); // demasiado rápido
  assert.equal(rateVerdict(loss, -1.2).tone, 'warn');
  assert.equal(rateVerdict(loss, -0.1).tone, 'info');
  assert.equal(bandText(loss), 'pérdida 0,4–0,7 %/sem');
  const gain = rateBand(plan({ goal: 'gain' }));
  assert.equal(rateVerdict(gain, 0.6).tone, 'warn', 'ganar demasiado rápido');
  assert.equal(rateVerdict(gain, 0.2).status, 'in');
  assert.equal(bandText(gain), 'ganancia 0,15–0,35 %/sem');
  const keep = rateBand(plan({ goal: 'maintain' }));
  assert.equal(bandText(keep), 'estable ±0,15 %/sem');
  assert.equal(rateVerdict(keep, 0.4).tone, 'info');
  assert.equal(rateVerdict(null, 0.4), null, 'sin objetivo no hay veredicto');
  assert.equal(favours('loss', -1), true);
  assert.equal(favours('gain', -1), false);
  assert.equal(favours('maintain', -1), null);
});

test('kcal y macros opcionales', () => {
  const v = plan({}, { kcal: { train: null, rest: null }, protein_g: 80, carbs_g: null, fat_g: null });
  assert.equal(planKcal(v), null);
  assert.equal(kcalTarget(v, true), null);
  assert.deepEqual(dayTargets(v, false), { kcal: null, p: 80, c: null, f: null });
  // solo kcal de entreno: valen para todos los días
  const w = plan({}, { kcal: { train: 2000, rest: null } });
  assert.deepEqual(planKcal(w), { train: 2000, rest: 2000 });
  // en descanso se escalan carbos y grasas, no la proteína
  const x = plan({}, { kcal: { train: 3000, rest: 2400 }, protein_g: 200, carbs_g: 300, fat_g: 100 });
  assert.deepEqual(dayTargets(x, false), { kcal: 2400, p: 200, c: 240, f: 80 });
});

test('sin kcal o «Sin objetivo»: los días sin registrar no se suponen', () => {
  const none = plan({ goal: 'none' }, { kcal: { train: 2000, rest: 2000 } });
  const nokcal = plan({ goal: 'maintain' }, { kcal: { train: null, rest: null } });
  const keep = plan({ goal: 'maintain' }, { kcal: { train: 2000, rest: 2000 } });
  assert.equal(assumesPlan(none), false);
  assert.equal(assumesPlan(nokcal), false);
  assert.equal(assumesPlan(keep), true);
  assert.deepEqual(intakeFor('d', {}, none), { kcal: null, assumed: false });
  assert.deepEqual(intakeFor('d', { diet: { status: 'plan' } }, nokcal), { kcal: null, assumed: false });
  assert.deepEqual(intakeFor('d', {}, keep), { kcal: 2000, assumed: true });
  const logged = { meals_complete: true, meals: [{ slot: 'C', items: [{ g: 100, per100: { kcal: 500, p: 0, c: 0, f: 0 } }] }] };
  assert.deepEqual(intakeFor('d', logged, none), { kcal: 500, assumed: false }, 'lo registrado siempre cuenta');
});

// Peso que sube ~0,5 %/semana durante 5 semanas
function rising(goal) {
  const today = '2026-11-01';
  const from = addDays(today, -34);
  const days = {};
  range(from, today).forEach((d, i) => { days[d] = { weight: +(60 * (1 + (0.005 / 7) * i)).toFixed(2) }; });
  const v = plan({ goal }, { kcal: { train: 2200, rest: 2200 } });
  v.from = from;
  return analyze({ config: { profile: { sex: 'F', height_cm: 160, birth_year: 1993 } }, plan: { versions: [v] }, days }, { today });
}

test('alertas de ritmo según el objetivo', () => {
  const titles = (a) => a.alerts.map((x) => x.title).join(' | ');
  assert.match(titles(rising('maintain')), /Subiendo de peso/);
  assert.match(titles(rising('gain')), /Ganas demasiado rápido/);
  assert.doesNotMatch(titles(rising('none')), /peso|Ritmo|rápido/);
  assert.equal(rising('none').latest.rateTarget, null);
});

test('previsión: sin objetivo no se proyecta; en mantenimiento no hay peso objetivo', () => {
  const none = rising('none');
  assert.equal(none.latest.projection, null);
  const keep = rising('maintain');
  assert.equal(keep.latest.goal, null);
});

test('formato Recomp: objetivo y dieta sin kcal', () => {
  const v = plan({ goal: 'gain', rate_pct_week: [0.2, 0.3] });
  const out = exportPlan(v);
  assert.equal(out.objetivos.objetivo, 'volumen');
  const w = plan();
  parsePlan(JSON.parse(JSON.stringify(out))).apply(w);
  assert.equal(w.targets.goal, 'gain');
  assert.deepEqual(w.targets.rate_pct_week, [0.2, 0.3]);
  const r = parsePlan({ objetivos: { objetivo: 'Sin objetivo' }, dieta: { kcal_entreno: null, kcal_descanso: null, proteina_g: 80, carbohidratos_g: null, grasas_g: null } });
  const z = plan();
  r.apply(z);
  assert.equal(z.targets.goal, 'none');
  assert.equal(planKcal(z), null);
  assert.equal(z.diet.protein_g, 80);
  assert.throws(() => parsePlan({ objetivos: { objetivo: 'definicion' } }), /objetivo/);
});
