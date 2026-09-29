import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recipeTotals, recipeFood, recipeWeight } from '../js/foods/recipes.js';

const r = {
  id: 'rec:1', name: 'Arroz con pollo',
  items: [
    { food: 'arroz', name: 'Arroz crudo', g: 500, per100: { kcal: 350, p: 7, c: 78, f: 1 } },
    { food: 'pollo', name: 'Pollo crudo', g: 1000, per100: { kcal: 110, p: 23, c: 0, f: 2 } },
  ],
  cooked_g: 2500, servings: 5,
};

test('totales y valores por 100 g de lo cocinado', () => {
  const t = recipeTotals(r);
  assert.equal(t.kcal, 2850);
  assert.equal(t.g, 1500);
  const f = recipeFood(r);
  assert.equal(f.per100.kcal, 114, '2850 kcal / 2500 g cocinados');
  assert.equal(f.per100.p, 10.6);
  assert.deepEqual(f.units, [{ name: 'ración', g: 500 }]);
});

test('sin peso cocinado usa la suma en crudo', () => {
  const x = { ...r, cooked_g: null, servings: null };
  assert.equal(recipeWeight(x), 1500);
  assert.equal(recipeFood(x).per100.kcal, 190);
  assert.equal(recipeFood(x).units, undefined);
});
