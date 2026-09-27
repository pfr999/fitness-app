import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allExercises, resolveExercise, suggestExercises, loggedVolume, plannedVolume, exerciseHistory, strengthTrend, progressionHint } from '../js/engine/training.js';
import { CATALOG, MUSCLES } from '../js/training/catalog.js';

const EX = allExercises({ items: [{ id: 'mine:1', name: 'Remo invertido', muscles: { espalda: 1, biceps: 0.5 } }] });

test('catálogo coherente', () => {
  const keys = new Set(MUSCLES.map(([k]) => k));
  const ids = new Set();
  for (const e of CATALOG) {
    assert.ok(!ids.has(e.id), `id duplicado ${e.id}`); ids.add(e.id);
    for (const [m, w] of Object.entries(e.muscles)) {
      assert.ok(keys.has(m), `${e.id}: músculo desconocido ${m}`);
      assert.ok(w === 1 || w === 0.5, `${e.id}: peso ${w}`);
    }
    assert.ok(Object.values(e.muscles).includes(1), `${e.id}: sin músculo directo`);
  }
  assert.ok(CATALOG.length >= 90);
});

test('reconoce ejercicios escritos a mano, sin acentos ni mayúsculas', () => {
  assert.equal(resolveExercise('Press banca', EX)?.id, 'press_banca');
  assert.equal(resolveExercise('press plano con barra', EX)?.id, 'press_banca');
  assert.equal(resolveExercise('Curl de isquios sentado', EX)?.id, 'curl_femoral_sentado');
  assert.equal(resolveExercise('Sentadilla trasera en MP barra alta', EX)?.id, 'sentadilla_multipower');
  assert.equal(resolveExercise({ ex: 'mine:1', name: 'lo que sea' }, EX)?.id, 'mine:1');
  assert.equal(resolveExercise('Ejercicio inventado', EX), null);
});

test('autocompletar', () => {
  const s = suggestExercises('press incl', EX).map((e) => e.id);
  assert.ok(s.includes('press_incl_barra') && s.includes('press_incl_manc'));
  assert.equal(suggestExercises('remo inv', EX)[0].id, 'mine:1');
});

test('volumen fraccional registrado y planificado', () => {
  const days = {
    '2026-09-22': { session: { sets: [
      { name: 'Press banca', kg: 80, reps: 8, rpe: 8 }, { name: 'Press banca', kg: 80, reps: 8, rpe: 8 },
      { name: 'Press banca', kg: 40, reps: 10, warmup: true },
      { name: 'Ejercicio raro', kg: 10, reps: 10 },
    ] } },
  };
  const v = loggedVolume(days, '2026-09-21', '2026-09-27', EX);
  assert.equal(v.byMuscle.pecho, 2);
  assert.equal(v.byMuscle.triceps, 1);
  assert.deepEqual(v.unknown, ['Ejercicio raro']);
  assert.equal(v.sessions, 1);
  const p = plannedVolume({ days: [{ name: 'D1', items: [{ name: 'Sentadilla', sets: 4 }, { name: 'Prensa', sets: 3 }] }] }, EX);
  assert.equal(p.byMuscle.cuadriceps, 7);
  assert.equal(p.byMuscle.gluteos, 5.5);
  assert.equal(plannedVolume({ days: [{ name: 'D1', items: [{ name: 'Sentadilla', sets: 4 }] }, { name: 'D2', items: [] }] }, EX, 4).byMuscle.cuadriceps, 8, '4 sesiones con 2 días: cada día cuenta doble');
});

test('historial, tendencia de fuerza y doble progresión', () => {
  const days = {};
  const kgs = [100, 100, 102.5, 102.5, 105, 107.5];
  kgs.forEach((kg, i) => { days[`2026-09-0${i + 1}`] = { session: { sets: [{ name: 'Sentadilla', kg, reps: 8, rpe: 8 }, { name: 'Sentadilla', kg, reps: 6, rpe: 5 }] } }; });
  const h = exerciseHistory(days, 'sentadilla', EX);
  assert.equal(h.length, 6);
  assert.equal(h[0].best.kg, 100, 'la serie a RPE 5 no cuenta para el e1RM');
  assert.equal(strengthTrend(h).status, 'sube');
  const flat = Object.fromEntries(Object.entries(days).map(([d]) => [d, { session: { sets: [{ name: 'Sentadilla', kg: 100, reps: 8, rpe: 8 }] } }]));
  assert.equal(strengthTrend(exerciseHistory(flat, 'sentadilla', EX)).status, 'estable');

  const item = { sets: 3, reps: [6, 8], rpe: 9 };
  assert.deepEqual(progressionHint([{ kg: 100, reps: 8, rpe: 8 }, { kg: 100, reps: 8, rpe: 9 }, { kg: 100, reps: 8, rpe: 9 }], item), { kg: 102.5, from: 100 });
  assert.equal(progressionHint([{ kg: 100, reps: 8, rpe: 8 }, { kg: 100, reps: 7, rpe: 9 }], item), null, 'no todas al tope');
  assert.equal(progressionHint([{ kg: 12, reps: 8, rpe: 8 }], { sets: 1, reps: [6, 8], rpe: 9 }).kg, 13, 'mancuernas: salto de 1 kg');
});
