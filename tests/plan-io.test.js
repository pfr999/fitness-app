import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportPlan, parsePlan, extractJson } from '../js/plan-io.js';
import { emptyPlan } from '../js/model.js';

const base = () => {
  const v = structuredClone(emptyPlan().versions[0]);
  v.routine.days = [{ name: 'Día 1', items: [{ name: 'Sentadilla', sets: 4, reps: [6, 8], rpe: 8 }] }];
  v.supplements = [{ name: 'Creatina', dose: '5 g', timing: 'Comida', kind: 'supplement' }];
  return v;
};

test('exportar e importar da el mismo plan (ida y vuelta)', () => {
  const v = base();
  const out = exportPlan(v);
  const w = structuredClone(emptyPlan().versions[0]);
  parsePlan(JSON.parse(JSON.stringify(out))).apply(w);
  assert.deepEqual(w.routine, v.routine);
  assert.deepEqual(w.diet.kcal, v.diet.kcal);
  assert.deepEqual(w.supplements, v.supplements);
});

test('importación parcial: solo cambia lo que viene', () => {
  const v = base();
  const r = parsePlan({ formato: 'recomp-plan', rutina: { dias: [{ nombre: 'Torso', ejercicios: [{ nombre: 'Press banca', series: 3, reps: 8 }] }] } });
  assert.deepEqual(r.sections, ['rutina']);
  r.apply(v);
  assert.equal(v.routine.days[0].name, 'Torso');
  assert.deepEqual(v.routine.days[0].items[0].reps, [8, 8]);
  assert.equal(v.supplements[0].name, 'Creatina', 'lo demás se mantiene');
});

test('extrae el JSON aunque venga con texto o en bloque de código', () => {
  const t = 'Aquí tienes tu plan:\n```json\n{ "formato": "recomp-plan", "fase": "1e" }\n```\n¡Suerte!';
  assert.equal(extractJson(t).fase, '1e');
  assert.throws(() => extractJson('sin json'), /No encuentro/);
});

test('errores claros y avisos', () => {
  assert.throws(() => parsePlan({ formato: 'otro' }), /no reconocido/);
  assert.throws(() => parsePlan({ dieta: { kcal_entreno: 50, kcal_descanso: 2000, proteina_g: 1, carbohidratos_g: 1, grasas_g: 1 } }), /kcal_entreno/);
  assert.throws(() => parsePlan({}), /ninguna sección/);
  const r = parsePlan({ dieta: { kcal_entreno: 3000, kcal_descanso: 2600, proteina_g: 100, carbohidratos_g: 100, grasas_g: 20 } });
  assert.match(r.warnings[0], /macros suman/);
  const m = parsePlan({ rutina: { dias: [{ nombre: 'D', ejercicios: [{ nombre: 'Remo anillas', series: 3, reps: [8, 12], musculos: { espalda: 1, biceps: 0.5, raro: 3 } }] }] } });
  assert.deepEqual(m.exercises, [{ name: 'Remo anillas', muscles: { espalda: 1, biceps: 0.5 } }]);
});

test('comidas: modo fijo con objetivo por comida y modo libre', () => {
  const v = structuredClone(emptyPlan().versions[0]);
  v.diet.meals_mode = 'fixed';
  v.diet.meals = [{ slot: 'Comida 1', target: { p: 50, c: 80, f: 20 } }, { slot: 'Intra-entreno', portions: { C: 1 } }, { slot: 'Comida 3' }];
  const w = structuredClone(emptyPlan().versions[0]);
  parsePlan(JSON.parse(JSON.stringify(exportPlan(v)))).apply(w);
  assert.deepEqual(w.diet.meals, v.diet.meals);
  assert.equal(w.diet.meals_mode, 'fixed');
  const free = parsePlan({ dieta: { kcal_entreno: 2600, kcal_descanso: 2300, proteina_g: 190, carbohidratos_g: 270, grasas_g: 70, modo_comidas: 'libres', comidas: [{ nombre: 'X' }] } });
  free.apply(w);
  assert.equal(w.diet.meals_mode, 'free');
  assert.deepEqual(w.diet.meals, [], 'en modo libre no hay lista fija');
});

test('mesociclo: ida y vuelta, se conserva si no viene y null lo quita', () => {
  const v = base();
  v.routine.meso = { start: '2026-09-28', weeks: 4, rir: [3, 2, 2, 1], deload: true };
  const w = structuredClone(emptyPlan().versions[0]);
  parsePlan(JSON.parse(JSON.stringify(exportPlan(v)))).apply(w);
  assert.deepEqual(w.routine.meso, v.routine.meso);
  parsePlan({ rutina: { dias: [] } }).apply(w);
  assert.equal(w.routine.meso.weeks, 4, 'sin «mesociclo» se conserva');
  parsePlan({ rutina: { dias: [], mesociclo: null } }).apply(w);
  assert.equal(w.routine.meso, undefined);
  assert.throws(() => parsePlan({ rutina: { dias: [], mesociclo: { inicio: 'ayer', semanas: 4 } } }), /fecha/);
});

test('calentamiento por día: ida y vuelta y ausente si no hay', () => {
  const v = base();
  v.routine.days[0].warmup = '3 min de respiración\nmovilidad de hombros';
  const out = exportPlan(v);
  assert.equal(out.rutina.dias[0].calentamiento, v.routine.days[0].warmup);
  const w = structuredClone(emptyPlan().versions[0]);
  parsePlan(JSON.parse(JSON.stringify(out))).apply(w);
  assert.equal(w.routine.days[0].warmup, v.routine.days[0].warmup);
  assert.equal('calentamiento' in exportPlan(base()).rutina.dias[0], false);
});
