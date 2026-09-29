// Importar / exportar el plan en «formato Recomp»: JSON con claves en español, pensado para
// diseñarlo con Claude y pegarlo en la app. Ver docs/formato-plan.md. Puro: sin red ni DOM.

export const FORMAT = 'recomp-plan';

// objetivo de la fase: interno ↔ formato Recomp
const GOAL_OUT = { loss: 'perdida', maintain: 'mantenimiento', gain: 'volumen', none: 'sin_objetivo' };
const GOAL_IN = Object.fromEntries(Object.entries(GOAL_OUT).map(([k, v]) => [v, k]));

const num = (v) => (v === null || v === undefined || v === '' ? null : Number.isFinite(+v) ? +v : NaN);

/** Plan interno (una versión) → formato Recomp. */
export function exportPlan(v) {
  return {
    formato: FORMAT,
    version: 1,
    fase: v.phase || '',
    micro: v.micro || '',
    objetivos: {
      objetivo: GOAL_OUT[v.targets?.goal] || 'perdida',
      peso_kg: v.targets?.weight_kg ?? null,
      cintura_cm: v.targets?.waist_cm ?? null,
      pasos: v.targets?.steps ?? null,
      sesiones_semana: v.targets?.sessions ?? null,
      sueno_h: v.targets?.sleep_h ?? null,
      ritmo_pct_semana: v.targets?.rate_pct_week ?? null,
    },
    dieta: {
      kcal_entreno: v.diet.kcal?.train ?? null,
      kcal_descanso: v.diet.kcal?.rest ?? null,
      proteina_g: v.diet.protein_g ?? null,
      carbohidratos_g: v.diet.carbs_g ?? null,
      grasas_g: v.diet.fat_g ?? null,
      modo_comidas: v.diet.meals_mode === 'free' ? 'libres' : 'fijas',
      comidas: (v.diet.meals || []).map((m) => ({ nombre: m.slot, ...(m.portions && Object.keys(m.portions).length ? { porciones: m.portions } : {}), ...(m.target ? { objetivo: { proteina_g: m.target.p, carbohidratos_g: m.target.c, grasas_g: m.target.f } } : {}) })),
      reglas: v.diet.rules || [],
    },
    rutina: {
      ...(v.routine.meso ? { mesociclo: { inicio: v.routine.meso.start, semanas: v.routine.meso.weeks, rir: v.routine.meso.rir, descarga: !!v.routine.meso.deload } } : {}),
      dias: (v.routine.days || []).map((d) => ({
        nombre: d.name,
        ...(d.warmup ? { calentamiento: d.warmup } : {}),
        ejercicios: d.items.map((it) => ({ nombre: it.name, series: it.sets, reps: it.reps, rpe: it.rpe ?? null, ...(it.note ? { nota: it.note } : {}) })),
      })),
    },
    suplementos: (v.supplements || []).map((s) => ({ nombre: s.name, dosis: s.dose || '', momento: s.timing || '', tipo: s.kind === 'medication' ? 'medicacion' : 'suplemento' })),
  };
}

/** Saca el JSON de un texto pegado (acepta que venga dentro de un bloque ```json … ``` o con texto alrededor). */
export function extractJson(text) {
  const t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : t;
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('No encuentro un bloque { … } en el texto pegado');
  try {
    return JSON.parse(body.slice(a, b + 1));
  } catch (e) {
    throw new Error(`El texto no es JSON válido: ${e.message}`);
  }
}

/**
 * Valida y convierte. Las secciones que no vengan se mantienen del plan actual.
 * @returns {{apply:(v)=>void, sections:string[], exercises:{name:string, muscles:object}[], warnings:string[]}}
 */
export function parsePlan(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Formato no reconocido');
  if (obj.formato && obj.formato !== FORMAT) throw new Error(`Formato «${obj.formato}» no reconocido (se espera «${FORMAT}»)`);
  const errs = [], warnings = [], sections = [], ops = [], exercises = [];
  const need = (cond, msg) => { if (!cond) errs.push(msg); };

  if ('fase' in obj || 'micro' in obj) {
    sections.push('fase');
    ops.push((v) => { if ('fase' in obj) v.phase = String(obj.fase ?? ''); if ('micro' in obj) v.micro = String(obj.micro ?? ''); });
  }

  if (obj.objetivos) {
    const o = obj.objetivos;
    const t = {};
    for (const [k, dst] of [['peso_kg', 'weight_kg'], ['cintura_cm', 'waist_cm'], ['pasos', 'steps'], ['sesiones_semana', 'sessions'], ['sueno_h', 'sleep_h']]) {
      if (!(k in o)) continue;
      const n = num(o[k]);
      need(!Number.isNaN(n), `objetivos.${k} debe ser un número`);
      t[dst] = n;
    }
    if ('objetivo' in o) {
      const g = GOAL_IN[String(o.objetivo || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_')];
      need(g, 'objetivos.objetivo debe ser "perdida", "mantenimiento", "volumen" o "sin_objetivo"');
      t.goal = g;
    }
    if ('ritmo_pct_semana' in o) {
      const r = o.ritmo_pct_semana;
      need(r === null || (Array.isArray(r) && r.length === 2 && r.every((x) => x !== null && Number.isFinite(+x))), 'objetivos.ritmo_pct_semana debe ser null o [mín, máx]');
      t.rate_pct_week = r === null ? null : [Math.min(+r[0], +r[1]), Math.max(+r[0], +r[1])];
    }
    sections.push('objetivos');
    ops.push((v) => { v.targets = { ...(v.targets || {}), ...t }; });
  }

  if (obj.dieta) {
    const d = obj.dieta;
    // kcal y macros son opcionales (null = sin objetivo); si vienen, deben ser razonables
    const kt = num(d.kcal_entreno), kr = num(d.kcal_descanso) ?? kt;
    need(kt == null || (kt > 800 && kt < 8000), 'dieta.kcal_entreno fuera de rango');
    need(kr == null || (kr > 800 && kr < 8000), 'dieta.kcal_descanso fuera de rango');
    for (const k of ['proteina_g', 'carbohidratos_g', 'grasas_g']) need(num(d[k]) == null || num(d[k]) >= 0, `dieta.${k} debe ser un número o null`);
    const meals = (d.comidas || []).map((m, i) => {
      need(m && m.nombre, `dieta.comidas[${i}] sin nombre`);
      const out = { slot: String(m?.nombre || '') };
      const por = Object.fromEntries(Object.entries(m?.porciones || {}).filter(([k, n]) => ['P', 'C', 'G', 'F', 'L'].includes(k) && +n > 0).map(([k, n]) => [k, +n]));
      if (Object.keys(por).length) out.portions = por;
      if (m?.objetivo) out.target = { p: num(m.objetivo.proteina_g) || 0, c: num(m.objetivo.carbohidratos_g) || 0, f: num(m.objetivo.grasas_g) || 0 };
      return out;
    });
    const kcalMacros = 4 * (num(d.proteina_g) || 0) + 4 * (num(d.carbohidratos_g) || 0) + 9 * (num(d.grasas_g) || 0);
    if (kt && kcalMacros && [d.proteina_g, d.carbohidratos_g, d.grasas_g].every((x) => num(x) != null) && Math.abs(kcalMacros - kt) > kt * 0.12) warnings.push(`Los macros suman ${Math.round(kcalMacros)} kcal y el objetivo de entreno es ${Math.round(kt)} kcal.`);
    sections.push('dieta');
    ops.push((v) => {
      const free = /libre/i.test(d.modo_comidas || '');
      v.diet = { kcal: { train: kt, rest: kr }, protein_g: num(d.proteina_g) || null, carbs_g: num(d.carbohidratos_g) || null, fat_g: num(d.grasas_g) || null, meals_mode: free ? 'free' : 'fixed', meals: free ? [] : meals, rules: (d.reglas || []).map(String).filter(Boolean) };
    });
  }

  if (obj.rutina) {
    const days = obj.rutina.dias;
    need(Array.isArray(days), 'rutina.dias debe ser una lista (puede estar vacía)');
    const out = (days || []).map((day, i) => {
      need(day?.nombre, `rutina.dias[${i}] sin nombre`);
      need(Array.isArray(day?.ejercicios), `rutina.dias[${i}].ejercicios debe ser una lista`);
      return {
        name: String(day?.nombre || `Día ${i + 1}`),
        ...(day?.calentamiento ? { warmup: String(day.calentamiento) } : {}),
        items: (day?.ejercicios || []).map((e, j) => {
          const reps = Array.isArray(e?.reps) ? e.reps.map(Number) : [Number(e?.reps), Number(e?.reps)];
          need(e?.nombre, `rutina.dias[${i}].ejercicios[${j}] sin nombre`);
          need(num(e?.series) > 0, `«${e?.nombre}»: series debe ser > 0`);
          need(reps.length === 2 && reps.every((x) => x > 0), `«${e?.nombre}»: reps debe ser un número o [mín, máx]`);
          if (e?.musculos && typeof e.musculos === 'object') exercises.push({ name: String(e.nombre), muscles: Object.fromEntries(Object.entries(e.musculos).filter(([, w]) => w === 1 || w === 0.5)) });
          return { name: String(e?.nombre || ''), sets: num(e?.series), reps: [Math.min(...reps), Math.max(...reps)], ...(e?.rpe != null ? { rpe: num(e.rpe) } : {}), ...(e?.nota ? { note: String(e.nota) } : {}) };
        }),
      };
    });
    // mesociclo: si no viene, se conserva el que hubiera; null lo quita
    let meso;
    if ('mesociclo' in obj.rutina) {
      const m = obj.rutina.mesociclo;
      if (m === null) meso = null;
      else {
        const weeks = num(m?.semanas);
        need(/^\d{4}-\d{2}-\d{2}$/.test(m?.inicio || ''), 'rutina.mesociclo.inicio debe ser una fecha AAAA-MM-DD');
        need(weeks >= 1 && weeks <= 12, 'rutina.mesociclo.semanas debe estar entre 1 y 12');
        const rir = Array.isArray(m?.rir) ? m.rir.map(Number) : null;
        need(!rir || (rir.length === weeks && rir.every((x) => x >= 0 && x <= 5)), 'rutina.mesociclo.rir: un RIR (0–5) por semana de carga');
        meso = { start: m?.inicio, weeks, ...(rir ? { rir } : {}), deload: m?.descarga !== false };
      }
    }
    sections.push('rutina');
    ops.push((v) => {
      const keep = v.routine?.meso;
      v.routine = { days: out };
      if (meso) v.routine.meso = meso;
      else if (meso === undefined && keep) v.routine.meso = keep;
    });
  }

  if (obj.suplementos) {
    need(Array.isArray(obj.suplementos), 'suplementos debe ser una lista');
    const s = (obj.suplementos || []).map((x, i) => {
      need(x?.nombre, `suplementos[${i}] sin nombre`);
      return { name: String(x?.nombre || ''), dose: x?.dosis || undefined, timing: x?.momento || undefined, kind: /medic/i.test(x?.tipo || '') ? 'medication' : 'supplement' };
    });
    sections.push('suplementos');
    ops.push((v) => { v.supplements = s; });
  }

  if (!sections.length) errs.push('No hay ninguna sección que importar (fase, objetivos, dieta, rutina, suplementos)');
  if (errs.length) throw new Error(errs.join(' · '));
  return { apply: (v) => ops.forEach((op) => op(v)), sections, exercises, warnings };
}
