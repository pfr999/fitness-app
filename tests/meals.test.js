import { test } from 'node:test';
import assert from 'node:assert/strict';

// meals.js importa módulos de interfaz; se prueban sus funciones puras con un DOM mínimo
globalThis.document = { querySelector: () => null };
const { mealPlan, unitLabel } = await import('../js/screens/meals.js');

test('plan de comidas: por defecto 3 fijas; libres sin lista', () => {
  assert.deepEqual(mealPlan({ diet: {} }).list.map((m) => m.slot), ['Comida 1', 'Comida 2', 'Comida 3']);
  assert.equal(mealPlan({ diet: { meals_mode: 'free', meals: [{ slot: 'A' }] } }).mode, 'free');
  assert.deepEqual(mealPlan({ diet: { meals: [{ slot: 'Intra-entreno' }] } }).list.map((m) => m.slot), ['Intra-entreno']);
});

test('plural de unidades', () => {
  assert.equal(unitLabel('pastilla', 4), 'pastillas');
  assert.equal(unitLabel('pastilla', 1), 'pastilla');
  assert.equal(unitLabel('ración', 2), 'raciones');
  assert.equal(unitLabel('scoop', 2), 'scoops');
  assert.equal(unitLabel('nuez', 3), 'nueces');
  assert.equal(unitLabel('rebanada de pan', 2), 'rebanadas de pan');
});
