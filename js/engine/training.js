// Entrenamiento: resolución de ejercicios, volumen semanal fraccional, e1RM, progresión y
// estancamiento. Ver docs/04-motor-calculo.md §6. Puro: sin red ni DOM.

import { CATALOG } from '../training/catalog.js';
import { addDays, range } from '../dates.js';
import { e1rm } from './targets.js';

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();

/** Catálogo completo: el de la app + los ejercicios propios del usuario (exercises.json). */
export function allExercises(customDoc) {
  const custom = (customDoc?.items || []).map((x) => ({ ...x, src: 'mine' }));
  return [...custom, ...CATALOG];
}

/**
 * Encuentra el ejercicio de un elemento de la rutina o de una serie: por id, o por nombre/alias
 * (así «Press banca» escrito a mano se reconoce). null si no se reconoce.
 */
export function resolveExercise(ref, exercises) {
  if (!ref) return null;
  const id = typeof ref === 'string' ? null : ref.ex;
  const name = typeof ref === 'string' ? ref : ref.name;
  if (id) { const x = exercises.find((e) => e.id === id); if (x) return x; }
  const n = norm(name);
  if (!n) return null;
  return exercises.find((e) => norm(e.name) === n || (e.aliases || []).some((a) => norm(a) === n)) || null;
}

/** Sugerencias para autocompletar al escribir el nombre de un ejercicio. */
export function suggestExercises(q, exercises, limit = 8) {
  const toks = norm(q).split(' ').filter(Boolean);
  if (!toks.length) return [];
  const scored = [];
  for (const e of exercises) {
    const hay = norm([e.name, ...(e.aliases || [])].join(' ')).split(' ');
    if (!toks.every((t) => hay.some((w) => w.startsWith(t)))) continue;
    const first = norm(e.name).startsWith(toks[0]) ? 10 : 0;
    scored.push({ e, s: first + (e.src === 'mine' ? 5 : 0) - norm(e.name).length * 0.05 });
  }
  return scored.sort((a, b) => b.s - a.s).slice(0, limit).map((x) => x.e);
}

/** Series que cuentan (no calentamiento). */
const workSets = (sets) => (sets || []).filter((s) => !s.warmup && s.reps > 0);

/**
 * Volumen fraccional por músculo en [from, to] a partir de lo registrado.
 * @returns {{byMuscle:Object<string,number>, unknown:string[], sessions:number}}
 */
export function loggedVolume(days, from, to, exercises) {
  const byMuscle = {}, unknown = new Set();
  let sessions = 0;
  for (const d of range(from, to)) {
    const sets = workSets(days[d]?.session?.sets);
    if (sets.length) sessions++;
    for (const s of sets) {
      const ex = resolveExercise(s, exercises);
      if (!ex) { unknown.add(s.name); continue; }
      for (const [m, w] of Object.entries(ex.muscles)) byMuscle[m] = (byMuscle[m] || 0) + w;
    }
  }
  return { byMuscle, unknown: [...unknown], sessions };
}

/**
 * Volumen semanal planificado a partir de la rutina. Si se entrena más (o menos) sesiones por
 * semana que días tiene la rutina, cada día pesa sesiones / días.
 */
export function plannedVolume(routine, exercises, sessionsPerWeek = null) {
  const byMuscle = {}, unknown = new Set();
  const nDays = routine?.days?.length || 0;
  const k = sessionsPerWeek && nDays ? sessionsPerWeek / nDays : 1;
  for (const day of routine?.days || []) {
    for (const it of day.items || []) {
      const ex = resolveExercise(it, exercises);
      if (!ex) { unknown.add(it.name); continue; }
      for (const [m, w] of Object.entries(ex.muscles)) byMuscle[m] = (byMuscle[m] || 0) + w * (it.sets || 0) * k;
    }
  }
  return { byMuscle, unknown: [...unknown] };
}

/**
 * Historial de un ejercicio: por sesión, la mejor serie (e1RM) y las series.
 * @returns {{date, sets:object[], best:{kg,reps,rpe,e1rm}}[]}  ordenado por fecha
 */
export function exerciseHistory(days, exId, exercises) {
  const out = [];
  for (const d of Object.keys(days).sort()) {
    const sets = workSets(days[d]?.session?.sets).filter((s) => resolveExercise(s, exercises)?.id === exId);
    if (!sets.length) continue;
    let best = null;
    for (const s of sets) {
      const r = e1rm(s.kg, s.reps, s.rpe ?? 10);
      if (!r || !r.confident) continue;
      if (!best || r.value > best.e1rm) best = { kg: s.kg, reps: s.reps, rpe: s.rpe, e1rm: r.value };
    }
    out.push({ date: d, sets, best });
  }
  return out;
}

/**
 * Tendencia de fuerza: compara la mediana de las 3 últimas sesiones con la de las 3 anteriores.
 * sube (≥ +1,5 %) · estable · baja (≤ −3 %). Necesita 4 sesiones con e1RM fiable.
 */
export function strengthTrend(history) {
  const v = history.map((h) => h.best?.e1rm).filter((x) => x != null);
  if (v.length < 4) return { status: 'pocos', change: null };
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const recent = med(v.slice(-3)), prev = med(v.slice(-6, -3).length ? v.slice(-6, -3) : v.slice(0, -3));
  const change = (recent - prev) / prev;
  return { status: change >= 0.015 ? 'sube' : change <= -0.03 ? 'baja' : 'estable', change };
}

/**
 * Doble progresión: si en la última sesión TODAS las series llegaron al tope del rango con
 * RPE ≤ objetivo, sugerir subir la carga (≈ +2,5 %, redondeado al disco de 1,25 kg por lado → 2,5 kg).
 */
export function progressionHint(lastSets, item) {
  const sets = workSets(lastSets);
  if (!sets.length || !item?.reps) return null;
  const top = item.reps[1] ?? item.reps[0];
  const target = item.rpe ?? 10;
  const allTop = sets.length >= Math.min(item.sets || 1, sets.length) && sets.every((s) => s.reps >= top && (s.rpe == null || s.rpe <= target));
  if (!allTop) return null;
  const kg = Math.max(...sets.map((s) => s.kg || 0));
  if (!kg) return null;
  const step = kg >= 40 ? 2.5 : 1;
  const next = Math.ceil((kg * 1.025) / step) * step;
  return { kg: next > kg ? next : kg + step, from: kg };
}

/** Músculos entrenados (con series registradas o planificadas) en la semana que acaba en `date`. */
export function musclesTrained(days, date, exercises, routine) {
  const v = loggedVolume(days, addDays(date, -6), date, exercises).byMuscle;
  const keys = Object.keys(v).length ? Object.keys(v) : Object.keys(plannedVolume(routine, exercises).byMuscle);
  return keys;
}
