import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foodHistory, mealSignature, timesRepeated } from '../js/foods/history.js';

const it = (food, g, extra = {}) => ({ food, name: food, g, per100: { kcal: 100, p: 10, c: 10, f: 1 }, ...extra });
const days = {
  '2026-09-20': { meals: [{ slot: 'Comida 1', items: [it('avena', 80), it('whey', 30)] }, { slot: 'Comida 3', items: [it('arroz', 200)] }] },
  '2026-09-21': { meals: [{ slot: 'Comida 1', items: [it('avena', 80), it('whey', 30)] }] },
  '2026-09-22': { meals: [{ slot: 'Comida 1', items: [it('avena', 60), it('whey', 30)] }, { slot: 'Comida 2', items: [it('pastilla', 11, { unit: { name: 'pastilla', g: 5.5, n: 2 } }), it('x', 50, { quick: true })] }] },
};

test('última cantidad y cantidades habituales', () => {
  const h = foodHistory(days, '2026-09-22');
  assert.equal(h.last('avena').g, 60, 'la última es la más reciente');
  assert.deepEqual(h.habitual('avena').map((q) => q.g), [80, 60], 'la más usada primero');
  assert.deepEqual(h.habitual('pastilla')[0], { g: 11, unit: { name: 'pastilla', g: 5.5, n: 2 } });
  assert.equal(h.last('x'), null, 'lo añadido rápido no cuenta');
});

test('lo que sueles poner en cada comida y lo reciente', () => {
  const h = foodHistory(days, '2026-09-22');
  assert.deepEqual(h.forSlot('Comida 1').map((x) => x.food).sort(), ['avena', 'whey']);
  assert.deepEqual(h.forSlot('Comida 3').map((x) => x.food), ['arroz']);
  assert.equal(h.recent(1)[0].food === 'avena' || h.recent(1)[0].food === 'whey' || h.recent(1)[0].food === 'pastilla', true);
  assert.equal(foodHistory(days, '2026-09-21').last('avena').g, 80, 'no mira después de «until»');
});

test('comida repetida: misma firma en días anteriores', () => {
  assert.equal(mealSignature([it('b', 1), it('a', 2), it('a', 3)]), 'a,b');
  assert.equal(timesRepeated(days, '2026-09-23', 'Comida 1', [it('whey', 30), it('avena', 70)]), 3);
  assert.equal(timesRepeated(days, '2026-09-23', 'Comida 3', [it('arroz', 200)]), 0, 'un solo alimento no cuenta como comida');
});
