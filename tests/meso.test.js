import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rirRamp, defaultMeso, mesoWeek, mesoLength, deloadSets, deloadKg } from '../js/engine/meso.js';

test('rampa de RIR: de 3 a 1', () => {
  assert.deepEqual(rirRamp(4), [3, 2, 2, 1]);
  assert.deepEqual(rirRamp(3), [3, 2, 1]);
  assert.deepEqual(rirRamp(5), [3, 3, 2, 2, 1]);
});

test('semana del mesociclo, descarga y fin', () => {
  const m = defaultMeso('2026-09-28', 4); // lunes
  assert.equal(mesoLength(m), 5);
  assert.equal(mesoWeek(m, '2026-09-27').before, true);
  const w1 = mesoWeek(m, '2026-09-28');
  assert.deepEqual([w1.week, w1.rir, w1.rpe, w1.deload], [1, 3, 7, false]);
  assert.equal(mesoWeek(m, '2026-10-19').rir, 1, 'semana 4');
  const dl = mesoWeek(m, '2026-10-26');
  assert.deepEqual([dl.week, dl.deload, dl.rpe], [5, true, 6]);
  assert.equal(mesoWeek(m, '2026-11-02').done, true);
  assert.equal(mesoWeek({ ...m, deload: false }, '2026-10-26').done, true, 'sin descarga acaba antes');
});

test('descarga: mitad de series y 10 % menos', () => {
  assert.equal(deloadSets(4), 2);
  assert.equal(deloadSets(3), 2);
  assert.equal(deloadKg(100), 90);
  assert.equal(deloadKg(127.5), 115);
  assert.equal(deloadKg(12), 11);
});
