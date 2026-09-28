import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weekBalance, dayRow, macroTargets } from '../js/engine/week.js';
import { emptyPlan, intakeFor, dietStatus } from '../js/model.js';
import { analyze } from '../js/engine/analysis.js';
import { simulate } from '../js/demo.js';

const plan = emptyPlan(); // 2800 entreno / 2500 descanso · P200 C280 G80 · 4 sesiones
plan.versions[0].from = '2026-01-01';
const food = (kcal, p = 10, c = 10, f = 1) => ({ slot: 'Comida', items: [{ name: 'x', g: 100, per100: { kcal, p, c, f } }] });

test('estado de la dieta por día e ingesta', () => {
  const v = plan.versions[0];
  assert.equal(dietStatus({}), null, 'sin validar');
  assert.deepEqual(dietStatus({ meals_complete: true }), { status: 'logged' }, 'día cerrado = registrado');
  assert.deepEqual(intakeFor('d', { diet: { status: 'plan' }, trained: true }, v), { kcal: 2800, assumed: false });
  assert.deepEqual(intakeFor('d', { diet: { status: 'over', kcal_delta: 400 }, trained: false }, v), { kcal: 2900, assumed: false });
  assert.deepEqual(intakeFor('d', { diet: { status: 'under', kcal_delta: -300 }, trained: false }, v), { kcal: 2200, assumed: false });
  assert.deepEqual(intakeFor('d', { diet: { status: 'over' } }, v), { kcal: null, assumed: false }, 'me pasé sin cifra → no se usa');
  assert.deepEqual(intakeFor('d', { diet: { status: 'unknown' } }, v), { kcal: null, assumed: false });
  assert.deepEqual(intakeFor('d', { diet: { status: 'logged' }, meals: [food(1800)] }, v), { kcal: 1800, assumed: false });
  assert.equal(intakeFor('d', {}, v).assumed, true, 'sin validar → plan supuesto');
  // la validación del día manda sobre la respuesta semanal antigua
  assert.equal(intakeFor('d', { diet: { status: 'plan' }, trained: true }, v, { d: false }).kcal, 2800);
});

test('objetivo de macros: en descanso se escalan carbohidratos y grasa, no la proteína', () => {
  const t = macroTargets(plan.versions[0], false);
  assert.equal(t.kcal, 2500);
  assert.equal(t.p, 200);
  assert.ok(Math.abs(t.c - 280 * 2500 / 2800) < 1e-9);
});

test('balance de la semana', () => {
  const days = {
    '2026-09-21': { weight: 84.6, steps: 10000, sleep_h: 7, trained: true, meals: [food(2600, 200, 250, 70)], diet: { status: 'logged' } },
    '2026-09-22': { weight: 84.4, steps: 8000, sleep_h: 8, trained: false, diet: { status: 'plan' } },
    '2026-09-23': { trained: true, diet: { status: 'over', kcal_delta: 700 } },
    '2026-09-24': { diet: { status: 'unknown' } },
    '2026-09-25': {},
  };
  const b = weekBalance({ plan, days }, '2026-09-21', '2026-09-27');
  assert.equal(b.rows.length, 7);
  assert.equal(b.energy.logged, 1);
  assert.equal(b.energy.estimated, 2);
  assert.equal(b.energy.unknown, 1);
  assert.equal(b.energy.pending, 3, 'jueves 25, sábado y domingo sin validar');
  // conocidos: 2600 + 2500 + (2800+700) + 3 días sin validar supuestos con el plan medio
  assert.equal(b.energy.knownDays, 6);
  assert.equal(b.macros.days, 1);
  assert.equal(b.macros.p, 200);
  assert.equal(b.steps.mean, 9000);
  assert.equal(b.sleep.mean, 7.5);
  assert.equal(b.training.sessions, 2);
  assert.equal(b.weight.weighIns, 2);
  const r = dayRow('2026-09-21', days['2026-09-21'], plan.versions[0]);
  assert.equal(r.loggedKcal, 2600);
  assert.equal(r.validated, true);
});

test('balance con análisis: tendencia de peso y déficit', () => {
  const today = '2026-09-27';
  const sim = simulate({ today, weeks: 8 });
  const a = analyze(sim, { today });
  const b = weekBalance(sim, '2026-09-21', today, { analysis: a });
  assert.ok(b.weight.change < 0, 'pierde peso en la simulación');
  assert.ok(b.energy.tdee > 2500 && b.energy.deficit > 0);
});
