import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, search, norm } from '../js/foods/search.js';

const ITEMS = [
  { id: 'off:1', name: 'Patatas Cocidas', brand: 'Hacendado', stores: 'Mercadona', qty: '660 g (400 g)', scans: 42, src: 'off' },
  { id: 'gen:9', name: 'Pollo relleno, asado al horno', src: 'gen' },
  { id: 'gen:8', name: 'Pechuga de pollo sin piel, a la plancha', src: 'gen' },
  { id: 'gen:1', name: 'Patata, cocida (hervida)', aliases: ['papa'], src: 'gen' },
  { id: 'gen:2', name: 'Patatas fritas', src: 'gen' },
  { id: 'off:2', name: 'Copos de avena', brand: 'Hacendado', stores: 'Mercadona', scans: 900, src: 'off' },
  { id: 'off:3', name: 'Copos de avena', brand: 'Crownfield', stores: 'Lidl', scans: 400, src: 'off' },
  { id: 'gen:3', name: 'Pechuga de pollo, a la plancha', src: 'gen' },
  { id: 'mine:1', name: 'Whey chocolate', brand: 'Mi marca', src: 'mine' },
];
const IDX = buildIndex(ITEMS);
const ids = (q, o) => search(IDX, q, o).map((x) => x.id);

test('normaliza acentos y mayúsculas', () => {
  assert.equal(norm('Pájaros ÁRBOL'), 'pajaros arbol');
});

test('el ejemplo del usuario: palabras en cualquier orden, tienda → marca blanca, formato', () => {
  assert.equal(ids('patata mercadona cocida bote')[0], 'off:1');
  assert.equal(ids('bote patata hacendado')[0], 'off:1');
});

test('prefijos y sinónimos de preparación', () => {
  assert.ok(ids('pat coc').includes('gen:1'));
  assert.ok(ids('patata hervida').includes('off:1'), 'hervida ≈ cocida');
  assert.ok(ids('papa cocida').includes('gen:1'), 'alias');
});

test('todas las palabras de contenido deben coincidir; tienda y formato no son obligatorias', () => {
  assert.ok(!ids('patata frita').includes('gen:1'));
  assert.ok(ids('patata cocida bote').includes('gen:1'), 'bote no es obligatorio');
  assert.equal(ids('patata cocida mercadona')[0], 'off:1', 'la tienda ordena');
});

test('lo escrito tal cual gana a los sinónimos', () => {
  assert.ok(['gen:3', 'gen:8'].includes(ids('pechuga pollo plancha')[0]));
  assert.ok(ids('pechuga pollo plancha').indexOf('gen:9') === -1 || ids('pechuga pollo plancha').indexOf('gen:9') > 1);
});

test('la tienda prioriza su marca', () => {
  assert.equal(ids('avena lidl')[0], 'off:3');
  assert.equal(ids('avena mercadona')[0], 'off:2');
  assert.equal(ids('avena').length, 2);
});

test('lo frecuente y lo propio va primero', () => {
  assert.equal(ids('avena', { frequent: { 'off:3': 5 } })[0], 'off:3');
  assert.equal(ids('whey')[0], 'mine:1');
  assert.ok(['gen:3', 'gen:8'].includes(ids('pollo plancha')[0]));
});

test('consulta vacía no devuelve nada', () => {
  assert.deepEqual(ids('   '), []);
});
