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

test('receta por ingredientes: escala a lo que te sirves', async () => {
  const { recipeItemsFor, topContributors } = await import('../js/foods/recipes.js');
  const items = recipeItemsFor(r, 500); // 500 g de 2500 cocinados = 1/5
  assert.deepEqual(items.map((x) => x.g), [100, 200]);
  assert.equal(r.items[0].g, 500, 'no toca la receta');
  const top = topContributors([...items, { food: 'pollo', name: 'Pollo crudo', g: 100, per100: { kcal: 110, p: 23, c: 0, f: 2 } }], 'p');
  assert.equal(top[0].name, 'Pollo crudo');
  assert.equal(Math.round(top[0].value), 69);
  assert.ok(Math.abs(top.reduce((a, x) => a + x.share, 0) - 1) < 1e-9);
});
