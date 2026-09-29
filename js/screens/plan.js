// Plan: rutina, dieta, suplementos/medicación y objetivos. Cada cambio crea una versión con fecha y motivo.

import { $, $$, esc, fmt, fmtK, num, int, toast, openSheet, closeSheet, bindSeg, segValue, icon, ask } from '../ui/ui.js';
import { addDays, fmtShort, weekStart } from '../dates.js';
import { defaultMeso, mesoWeek, mesoLength, rirRamp } from '../engine/meso.js';
import { FILES, currentPlan, newPlanVersion, kcalTarget, versionNumber, planKcal, assumesPlan } from '../model.js';
import { GOALS, GOAL_LABEL, goalOf, rateBand, bandText, rateVerdict, MAINTAIN_BAND, GAIN_RATE } from '../engine/targets.js';
import { hallProjection } from '../engine/energy.js';
import { writeSummary } from '../summary.js';
import { exercisesOf, musclesLine, datalist, assignSheet, volumeBars } from './exercises.js';
import { MUSCLES } from '../training/catalog.js';
import { exportPlan, parsePlan, extractJson } from '../plan-io.js';
import { resolveExercise, plannedVolume } from '../engine/training.js';
import { recipeSheet, unitLabel } from './meals.js';
import { recipeFood, recipeTotals } from '../foods/recipes.js';
import { macrosFor } from '../foods/db.js';

const TABS = [['rutina', 'Rutina'], ['dieta', 'Dieta'], ['recetas', 'Recetas'], ['supl', 'Suplem.'], ['obj', 'Objetivos']];

function plan(ctx) { return ctx.store.get(FILES.plan); }

/** Guarda una nueva versión del plan. */
function savePlan(ctx, mutate, reason) {
  const doc = plan(ctx);
  const before = currentPlan(doc);
  const after = structuredClone(before);
  mutate(after);
  const auto = diffText(before, after);
  if (!auto) { toast('Sin cambios'); return false; }
  const why = reason?.trim() || auto;
  ctx.store.update(FILES.plan, (d) => newPlanVersion(d, { reason: why, mutate }), `Plan: ${why}`);
  toast('Plan actualizado');
  writeSummary(ctx);
  return true;
}

/** Resumen legible de lo que cambió entre dos versiones. */
export function diffText(a, b) {
  if (!a || !b) return '';
  const out = [];
  const kd = (x, y, l) => { if (x !== y) out.push(`${l} ${fmtK(x)} → ${fmtK(y)}`); };
  kd(a.diet.kcal?.train ?? null, b.diet.kcal?.train ?? null, 'kcal entreno');
  kd(a.diet.kcal?.rest ?? null, b.diet.kcal?.rest ?? null, 'kcal descanso');
  kd(a.diet.protein_g ?? null, b.diet.protein_g ?? null, 'proteína');
  kd(a.diet.carbs_g ?? null, b.diet.carbs_g ?? null, 'carbohidratos');
  kd(a.diet.fat_g ?? null, b.diet.fat_g ?? null, 'grasas');
  if (JSON.stringify(a.diet.meals) !== JSON.stringify(b.diet.meals) || (a.diet.meals_mode || 'fixed') !== (b.diet.meals_mode || 'fixed')) out.push('comidas');
  if (JSON.stringify(a.diet.rules) !== JSON.stringify(b.diet.rules)) out.push('reglas de dieta');
  const noMeso = (r) => JSON.stringify({ ...r, meso: undefined });
  if (noMeso(a.routine) !== noMeso(b.routine)) out.push('rutina');
  if (JSON.stringify(a.routine.meso || null) !== JSON.stringify(b.routine.meso || null)) out.push(b.routine.meso ? `mesociclo ${b.routine.meso.weeks}${b.routine.meso.deload ? '+1' : ''} semanas desde ${fmtShort(b.routine.meso.start)}` : 'sin mesociclo');
  const sa = new Set(a.supplements.map((s) => s.name)), sb = new Set(b.supplements.map((s) => s.name));
  for (const n of sb) if (!sa.has(n)) out.push(`+${n}`);
  for (const n of sa) if (!sb.has(n)) out.push(`−${n}`);
  if (!out.some((x) => x.startsWith('+') || x.startsWith('−')) && JSON.stringify(a.supplements) !== JSON.stringify(b.supplements)) out.push('suplementos');
  if (goalOf(a) !== goalOf(b)) out.push(`objetivo: ${GOAL_LABEL[goalOf(b)].toLowerCase()}`);
  const noGoal = (t) => JSON.stringify({ ...(t || {}), goal: undefined });
  if (noGoal(a.targets) !== noGoal(b.targets)) out.push('objetivos');
  if (a.phase !== b.phase || a.micro !== b.micro) out.push(`fase ${b.phase || '—'}${b.micro ? ` micro ${b.micro}` : ''}`);
  return out.join(', ');
}

// ---------------------------------------------------------------- render
export function render(ctx) {
  const doc = plan(ctx);
  const v = currentPlan(doc);
  if (!v) return `<div class="card empty"><b>Sin plan</b>Cargando…</div>`;
  const tab = ctx.state.planTab || 'rutina';
  const prevReason = v.reason ? `“${esc(v.reason)}”` : '';
  const head = `<div class="card ver">
      <div class="vi">v${versionNumber(doc, v)}</div>
      <div style="flex:1;min-width:0"><b style="font-size:15px">${esc([v.phase && `Fase ${v.phase}`, v.micro && `Micro ${v.micro}`].filter(Boolean).join(' · ') || 'Plan actual')}</b><div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Desde ${esc(fmtShort(v.from))} ${prevReason}</div></div>
      <button class="link" id="history">Historial</button>
    </div>
    <div class="g2" style="margin:-4px 0 12px">
      <button class="btn secondary sm" id="planImport" style="width:100%">Importar plan</button>
      <button class="btn secondary sm" id="planExport" style="width:100%">Exportar / Claude</button>
    </div>
    <div class="seg" id="planSeg" style="margin-bottom:12px">${TABS.map(([k, l]) => `<button data-v="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const body = tab === 'recetas' ? renderRecipes(ctx) : tab === 'dieta' ? renderDiet(v) : tab === 'supl' ? renderSupp(v) : tab === 'obj' ? renderTargets(ctx, v) : renderRoutine(ctx, v);
  return head + body;
}

function renderRoutine(ctx, v) {
  const days = v.routine.days;
  if (!days.length) return `<div class="card empty"><b>Sin rutina</b>Crea tu primer día de entreno.<div style="margin-top:12px"><button class="btn primary" data-editday="-1">${icon.plus} Añadir día</button></div></div>`;
  const i = Math.min(ctx.state.planDay || 0, days.length - 1);
  const d = days[i];
  const exs = exercisesOf(ctx);
  const vol = plannedVolume(v.routine, exs, v.targets?.sessions);
  return `${mesoCard(ctx, v)}<div class="daytabs" id="dayTabs">${days.map((x, k) => `<button data-v="${k}" class="${k === i ? 'on' : ''}">${esc(x.name)}</button>`).join('')}<button data-v="new" aria-label="Añadir día">${icon.plus}</button></div>
    <div class="card"><div class="ch"><h2>${esc(d.name)}</h2><span class="aux">${d.items.reduce((a, x) => a + (x.sets || 0), 0)} series</span></div>
      ${d.warmup ? `<div class="tip" style="margin:-4px 0 10px"><span><b>Calentamiento:</b> <span style="white-space:pre-line">${esc(d.warmup)}</span></span></div>` : ''}
      ${d.items.map((x, k) => { const ex = resolveExercise(x, exs); return `<div class="pe"><span class="ex-n">${k + 1}</span><div class="ex-t"><b>${esc(x.name)}</b><span>${esc(x.sets)} × ${esc((x.reps || []).join('–'))}${x.rpe ? ` · RPE ${esc(x.rpe)}` : ''}</span>
        ${ex ? `<div class="muted small" style="font-weight:600">${esc(musclesLine(ex))}</div>` : `<div><button class="link" data-assign="${esc(x.name)}" style="color:var(--amber);padding:2px 0">Sin músculos asignados · Asignar</button></div>`}
        ${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}</div></div>`; }).join('') || '<div class="muted">Sin ejercicios.</div>'}
      <button class="btn secondary sm" style="margin-top:12px;width:100%" data-editday="${i}">${icon.edit} Editar ${esc(d.name)}</button>
    </div>
    <div class="card"><div class="ch"><h2>Volumen semanal planificado</h2><span class="aux">series por músculo</span></div>
      ${volumeBars(vol.byMuscle)}
      <div class="muted small" style="margin-top:8px">Con ${esc(v.targets?.sessions || days.length)} sesiones por semana (Objetivos) repartidas entre los ${days.length} días de la rutina. Franja verde: 10–20 series (Pelland 2025); el trabajo indirecto cuenta ½.${vol.unknown.length ? ` Sin contar (sin músculos asignados): ${esc(vol.unknown.join(', '))}.` : ''}</div>
    </div>`;
}

// ---------------------------------------------------------------- mesociclo
function mesoCard(ctx, v) {
  const m = v.routine.meso;
  if (!m) return `<div class="card"><div class="ch"><h2>Mesociclo</h2><span class="aux">sin configurar</span></div>
    <div class="muted small" style="margin:-6px 0 12px">Bloques de 4–6 semanas: el esfuerzo sube cada semana (menos repeticiones en reserva, RIR) y la última es de descarga para recuperar. En Entreno verás en qué semana estás y qué esfuerzo toca.</div>
    <button class="btn secondary sm" id="mesoEdit" style="width:100%">Configurar mesociclo</button></div>`;
  const w = mesoWeek(m, ctx.today());
  const total = mesoLength(m);
  const cells = Array.from({ length: total }, (_, i) => {
    const dl = m.deload && i === total - 1;
    const cur = w && !w.done && !w.before && w.week === i + 1;
    return `<div class="mw ${cur ? 'on' : ''} ${dl ? 'mdl' : ''} ${w && (w.done || w.week > i + 1) ? 'past' : ''}"><b>S${i + 1}</b><span>${dl ? 'Descarga' : `RIR ${m.rir?.[i] ?? rirRamp(m.weeks)[i]}`}</span></div>`;
  }).join('');
  const status = w.before ? `Empieza el ${fmtShort(m.start)}` : w.done ? 'Terminado: toca empezar otro' : w.deload ? `Semana ${w.week} de ${total}: descarga` : `Semana ${w.week} de ${total} · RIR ${w.rir} (RPE ${w.rpe})`;
  return `<div class="card"><div class="ch"><h2>Mesociclo</h2><span class="aux">desde ${esc(fmtShort(m.start))}</span></div>
    <div class="small" style="font-weight:800;margin:-6px 0 10px;color:${w.done ? 'var(--amber)' : 'var(--accent)'}">${status}</div>
    <div class="mweeks" style="grid-template-columns:repeat(${total},minmax(0,1fr))">${cells}</div>
    ${m.deload ? '<div class="muted small" style="margin-top:8px">Descarga: la mitad de series y ~10 % menos de peso, lejos del fallo (RPE 6).</div>' : ''}
    <div class="g2" style="margin-top:12px"><button class="btn secondary sm" id="mesoEdit" style="width:100%">Editar</button><button class="btn ${w.done ? 'primary' : 'secondary'} sm" id="mesoNew" style="width:100%">Empezar otro</button></div></div>`;
}

function mesoSheet(ctx, { fresh = false } = {}) {
  const v = currentPlan(plan(ctx));
  const today = ctx.today();
  const cur = v.routine.meso;
  const w = cur && mesoWeek(cur, today);
  // uno nuevo empieza este lunes si el anterior acabó (o no hay); si no, el lunes siguiente
  const nextStart = !cur || w?.done ? weekStart(today) : addDays(weekStart(today), 7);
  let m = fresh || !cur ? defaultMeso(nextStart, cur?.weeks || 4) : structuredClone(cur);
  if (fresh && cur) m.deload = cur.deload;
  const paint = (sh) => {
    $('#msWeeks', sh).innerHTML = [3, 4, 5, 6].map((n) => `<button type="button" data-v="${n}" class="${m.weeks === n ? 'on' : ''}">${n}</button>`).join('');
    $('#msRir', sh).innerHTML = m.rir.map((r, i) => `<div class="msr"><span>Semana ${i + 1}</span><div class="chipset sm">${[4, 3, 2, 1, 0].map((x) => `<button type="button" data-w="${i}" data-r="${x}" class="${r === x ? 'on' : ''}">${x}</button>`).join('')}</div></div>`).join('') + (m.deload ? `<div class="msr"><span>Semana ${m.weeks + 1}</span><b style="font-size:13px">Descarga</b></div>` : '');
    $$('#msWeeks button', sh).forEach((b) => b.addEventListener('click', () => { m.weeks = +b.dataset.v; m.rir = rirRamp(m.weeks); paint(sh); }));
    $$('#msRir [data-r]', sh).forEach((b) => b.addEventListener('click', () => { m.rir[+b.dataset.w] = +b.dataset.r; paint(sh); }));
  };
  openSheet(`<h3>${fresh || !cur ? 'Mesociclo nuevo' : 'Editar mesociclo'}</h3>
    <div class="muted">RIR = repeticiones que te quedan en reserva al acabar la serie (RIR 2 ≈ RPE 8). Lo normal: empezar en 3 y acabar en 1.</div>
    <div class="stack" style="margin-top:12px">
      <div class="field"><label for="msStart">Empieza (lunes)</label><input class="inp" type="date" id="msStart" value="${m.start}"></div>
      <div class="field"><label>Semanas de carga</label><div class="chipset" id="msWeeks"></div></div>
      <div class="field"><label>Semana de descarga al final</label><div class="seg" id="msDl"><button data-v="1" class="${m.deload ? 'on' : ''}">Sí</button><button data-v="0" class="${m.deload ? '' : 'on'}">No</button></div></div>
      <div class="field"><label>RIR objetivo por semana</label><div id="msRir"></div></div>
      ${cur && !fresh ? '<button class="link" id="msOff" style="color:var(--amber)">Quitar el mesociclo</button>' : ''}
      <div class="sheet-actions"><button class="btn primary" id="msSave">Guardar nueva versión</button></div>
    </div>`, {
    bind: (sh) => {
      paint(sh);
      bindSeg(sh, '#msDl', (x) => { m.deload = x === '1'; paint(sh); });
      $('#msOff', sh)?.addEventListener('click', () => { if (savePlan(ctx, (p) => { delete p.routine.meso; }, 'Quita el mesociclo')) { closeSheet(); ctx.render(); } });
      $('#msSave', sh).addEventListener('click', () => {
        const start = $('#msStart', sh).value;
        if (!start) return toast('Pon la fecha de inicio');
        m.start = weekStart(start);
        if (savePlan(ctx, (p) => { p.routine.meso = structuredClone(m); }, `Mesociclo ${m.weeks}${m.deload ? '+1' : ''} semanas desde ${fmtShort(m.start)}`)) { closeSheet(); ctx.render(); }
      });
    },
  });
}

// ---------------------------------------------------------------- recetas, comidas guardadas y mis alimentos
function renderRecipes(ctx) {
  const doc = ctx.store.get(FILES.foods) || {};
  const byName = (a, b) => a.name.localeCompare(b.name, 'es');
  const recipes = (doc.recipes || []).filter((r) => r.items?.length).map((r, i) => ({ r, i })).sort((a, b) => byName(a.r, b.r));
  const saved = (doc.saved_meals || []).map((r, i) => ({ r, i })).sort((a, b) => byName(a.r, b.r));
  const favs = doc.favorites || [];
  const ingr = (r) => esc(r.items.slice(0, 4).map((x) => x.name.split(',')[0]).join(' · ') + (r.items.length > 4 ? ` · +${r.items.length - 4}` : ''));
  return `<div class="card"><div class="ch"><h2>Recetas</h2><button class="btn primary sm" id="recNew">${icon.plus} Nueva</button></div>
      <div class="muted small" style="margin:-6px 0 8px">Tus platos de siempre, preparados con calma: ingredientes, preparación y, si cocinas para varios días, el peso cocinado. Al apuntar eliges si van como plato o por ingredientes (y ajustas lo de ese día).</div>
      ${recipes.map(({ r, i }) => { const f = recipeFood(r), t = recipeTotals(r); return `<button class="rcp" data-rec="${i}"><b>${esc(r.name)}</b><span>${ingr(r)}</span><small>${fmtK(f.per100.kcal)} kcal/100 g · P ${fmt(f.per100.p)}${f.units ? ` · ración ${fmtK(f.units[0].g)} g = ${fmtK(t.kcal / r.servings)} kcal` : ''}${r.steps ? ' · con preparación' : ''}</small></button>`; }).join('') || '<div class="empty-meal">Todavía ninguna. Crea la primera con «Nueva».</div>'}
    </div>
    <div class="card"><div class="ch"><h2>Comidas guardadas</h2><button class="btn secondary sm" id="smNew">${icon.plus} Nueva</button></div>
      <div class="muted small" style="margin:-6px 0 8px">Alimentos que sueles comer juntos (p. ej. tu desayuno). Se añaden sueltos, cada uno con su cantidad.</div>
      ${saved.map(({ r, i }) => { const t = recipeTotals(r); return `<button class="rcp" data-sm="${i}"><b>${esc(r.name)}</b><span>${ingr(r)}</span><small>${fmtK(t.kcal)} kcal · P ${fmtK(t.p)}</small></button>`; }).join('') || '<div class="empty-meal">Ninguna. También se crean desde el ⋯ de una comida → «Guardar como comida».</div>'}
    </div>
    <div class="card"><div class="ch"><h2>Mis alimentos</h2><span class="aux">${favs.length}</span></div>
      <div class="muted small" style="margin:-6px 0 8px">Tus fijos con su cantidad. Se añaden con la ⭐ al elegir la cantidad de un alimento.</div>
      ${favs.map((f, i) => { const x = macrosFor(f.food.per100, f.g); return `<div class="row-edit"><div class="t"><b>${esc(f.food.name)}</b><span>${f.unit ? `${fmt(f.unit.n, f.unit.n % 1 ? 1 : 0)} ${esc(unitLabel(f.unit.name, f.unit.n))} · ` : ''}${fmtK(f.g)} g · ${fmtK(x.kcal)} kcal · P ${fmtK(x.p)}</span></div><div class="ops"><button class="mini danger" data-favdel="${i}" aria-label="Quitar ${esc(f.food.name)}">${icon.trash}</button></div></div>`; }).join('') || '<div class="empty-meal">Ninguno todavía.</div>'}
    </div>`;
}

function renderDiet(v) {
  const d = v.diet;
  const kcalMacros = (d.protein_g || 0) * 4 + (d.carbs_g || 0) * 4 + (d.fat_g || 0) * 9;
  const pk = planKcal(v);
  const g = (x) => (x ? `${fmtK(x)} g` : '—');
  return `<div class="g2" style="margin-bottom:12px">
      <button class="btn primary" data-quick="kcal">${icon.flame} Ajustar kcal</button>
      <button class="btn secondary" data-quick="diet">${icon.edit} Editar dieta</button>
    </div>
    <div class="hint" style="margin:-4px 0 12px">«Ajustar kcal» te enseña el ritmo previsto antes de guardar. «Editar dieta» cambia macros, comidas y reglas. Kcal y macros son opcionales.</div>
    <div class="card"><div class="ch"><h2>Objetivos diarios</h2></div>
      ${!pk ? '<div class="muted small" style="margin:-6px 0 10px">Sin kcal objetivo: Comidas enseña lo que llevas, sin compararlo con nada.</div>' : ''}
      <div class="g2">
        <div class="card flat" style="margin:0;padding:12px"><div class="muted small" style="font-weight:700">Día de entreno</div><div style="font-size:24px;font-weight:800" class="num">${pk ? fmtK(pk.train) : '—'}</div></div>
        <div class="card flat" style="margin:0;padding:12px"><div class="muted small" style="font-weight:700">Día de descanso</div><div style="font-size:24px;font-weight:800" class="num">${pk ? fmtK(pk.rest) : '—'}</div></div>
      </div>
      <div class="g3" style="margin-top:10px;text-align:center">
        <div><div class="muted small" style="font-weight:700">Proteína</div><b class="num">${g(d.protein_g)}</b></div>
        <div><div class="muted small" style="font-weight:700">Carbos</div><b class="num">${g(d.carbs_g)}</b></div>
        <div><div class="muted small" style="font-weight:700">Grasas</div><b class="num">${g(d.fat_g)}</b></div>
      </div>
      ${kcalMacros ? `<div class="hint">Los macros suman ${fmtK(kcalMacros)} kcal.</div>` : ''}
    </div>
    <div class="card"><div class="ch"><h2>Comidas</h2><button class="link" data-quick="diet">Editar</button></div>
      ${d.meals_mode === 'free'
        ? '<div class="muted">Libres: cada día añades las comidas que hagas. Lo que cuenta es el total del día.</div>'
        : `<div class="muted small" style="margin:-6px 0 6px">Fijas: aparecen cada día${(d.meals || []).some((m) => m.target || (m.portions && Object.keys(m.portions).length)) ? '' : ', sin objetivo propio (cuenta el total del día)'}.</div>
          ${((d.meals || []).length ? d.meals : [1, 2, 3].map((n) => ({ slot: `Comida ${n}` }))).map((m) => `<div class="meal"><span>${esc(m.slot)}</span>${m.target ? `<span class="muted small num">P ${fmtK(m.target.p || 0)} · C ${fmtK(m.target.c || 0)} · G ${fmtK(m.target.f || 0)} g</span>` : `<div class="por">${Object.entries(m.portions || {}).filter(([, n]) => n).map(([k, n]) => `<span class="${esc(k)}">${esc(n)}${esc(k)}</span>`).join('')}</div>`}</div>`).join('')}`}
    </div>
    <div class="card"><div class="ch"><h2>Reglas</h2><button class="link" data-quick="diet">Editar</button></div>
      ${(d.rules || []).map((r) => `<div style="font-size:14px;margin-bottom:6px">${esc(r)}</div>`).join('') || '<div class="muted">Sin reglas.</div>'}
    </div>`;
}

function renderSupp(v) {
  const list = (kind) => v.supplements.map((s, i) => ({ s, i })).filter(({ s }) => (s.kind || 'supplement') === kind);
  const rows = (items) => items.map(({ s, i }) => `<div class="row-edit"><div class="t"><b>${esc(s.name)}</b><span>${esc([s.dose, s.timing].filter(Boolean).join(' · '))}</span></div><div class="ops"><button class="mini" data-supp="${i}" aria-label="Editar ${esc(s.name)}">${icon.edit}</button></div></div>`).join('');
  const sup = list('supplement'), med = list('medication');
  return `<div class="card"><div class="ch"><h2>Suplementos</h2><button class="link" data-supp="-1" data-kind="supplement">+ Añadir</button></div>${rows(sup) || '<div class="muted">Nada registrado.</div>'}</div>
    <div class="card"><div class="ch"><h2>Medicación</h2><button class="link" data-supp="-1" data-kind="medication">+ Añadir</button></div>${rows(med) || '<div class="muted">Nada registrado.</div>'}</div>`;
}

function renderTargets(ctx, v) {
  const t = v.targets || {};
  const a = ctx.analysis();
  const goal = goalOf(v);
  const band = rateBand(v, { bfPct: a.body?.bfMid ?? null, sex: ctx.store.get(FILES.config)?.profile?.sex });
  const r = (l, val) => `<tr><td>${l}</td><td class="n">${val}</td></tr>`;
  const HINT = {
    loss: 'Pérdida: el ritmo automático depende de tu % graso estimado (más delgado → más lento).',
    maintain: `Mantenimiento: peso estable (±${fmt(MAINTAIN_BAND, 2)} %/sem). Te avisa si la tendencia se sale 2 semanas seguidas; pasarte de kcal no se marca.`,
    gain: `Volumen: ganar despacio (${fmt(GAIN_RATE[0], 2)}–${fmt(GAIN_RATE[1], 2)} %/sem) para no sumar grasa de más; pasarte de kcal no se marca.`,
    none: 'Sin objetivo: solo registras. Ves tus datos y tendencias sin franjas, avisos ni comparaciones con el plan.',
  };
  return `<div class="card"><div class="ch"><h2>Objetivos</h2><button class="link" data-quick="targets">Editar</button></div>
      <table class="t">
        ${r('Objetivo', `<b>${esc(GOAL_LABEL[goal])}</b>`)}
        ${band ? r('Ritmo', `${esc(bandText(band))} ${band.auto ? '<span class="badge n">auto</span>' : ''}`) : ''}
        ${goal === 'loss' || goal === 'gain' ? r('Peso objetivo', t.weight_kg ? `${fmt(t.weight_kg)} kg` : '—') : ''}
        ${r('Cintura objetivo', t.waist_cm ? `${fmt(t.waist_cm)} cm` : '—')}
        ${r('Pasos diarios', t.steps ? fmtK(t.steps) : '—')}
        ${r('Sesiones / semana', t.sessions ?? '—')}
        ${r('Sueño', t.sleep_h ? `≥ ${fmt(t.sleep_h)} h` : '—')}
      </table>
      <div class="hint">${HINT[goal]}</div>
    </div>`;
}

// ---------------------------------------------------------------- bind
export function bind(root, ctx) {
  bindSeg(root, '#planSeg', (v) => ctx.nav({ planTab: v }));
  $('#history', root)?.addEventListener('click', () => historySheet(ctx));
  $('#planImport', root)?.addEventListener('click', () => importSheet(ctx));
  $('#planExport', root)?.addEventListener('click', () => exportSheet(ctx));
  $$('#dayTabs button', root).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.v === 'new') return daySheet(ctx, -1);
    ctx.state.planDay = +b.dataset.v; ctx.render();
  }));
  const doc = () => ctx.store.get(FILES.foods) || {};
  const done = () => ctx.render();
  $('#recNew', root)?.addEventListener('click', () => recipeSheet(ctx, null, { onDone: done }));
  $$('[data-rec]', root).forEach((b) => b.addEventListener('click', () => recipeSheet(ctx, doc().recipes[+b.dataset.rec], { onDone: done })));
  $('#smNew', root)?.addEventListener('click', () => recipeSheet(ctx, null, { kind: 'saved', onDone: done }));
  $$('[data-sm]', root).forEach((b) => b.addEventListener('click', () => recipeSheet(ctx, doc().saved_meals[+b.dataset.sm], { kind: 'saved', onDone: done })));
  $$('[data-favdel]', root).forEach((b) => b.addEventListener('click', () => {
    const f = doc().favorites[+b.dataset.favdel];
    ctx.store.update(FILES.foods, (d) => { d.favorites = (d.favorites || []).filter((x) => x !== undefined && x.food.id !== f.food.id); if (!d.favorites.length) delete d.favorites; return d; }, `Quita de Mis alimentos: ${f.food.name}`);
    ctx.render();
    toast(`${f.food.name} quitado`, { action: { label: 'Deshacer', fn: () => { ctx.store.update(FILES.foods, (d) => { d.favorites = [...(d.favorites || []), f]; return d; }, `Vuelve a Mis alimentos: ${f.food.name}`); ctx.render(); } } });
  }));
  $('#mesoEdit', root)?.addEventListener('click', () => mesoSheet(ctx));
  $('#mesoNew', root)?.addEventListener('click', () => mesoSheet(ctx, { fresh: true }));
  $$('[data-editday]', root).forEach((b) => b.addEventListener('click', () => daySheet(ctx, +b.dataset.editday)));
  $$('[data-assign]', root).forEach((b) => b.addEventListener('click', () => assignSheet(ctx, b.dataset.assign, () => ctx.render())));
  $$('[data-supp]', root).forEach((b) => b.addEventListener('click', () => suppSheet(ctx, +b.dataset.supp, b.dataset.kind)));
  $$('[data-quick]', root).forEach((b) => b.addEventListener('click', () => {
    const q = b.dataset.quick;
    if (q === 'kcal') kcalSheet(ctx);
    else if (q === 'targets') targetsSheet(ctx);
    else if (q === 'diet') dietSheet(ctx);
  }));
}

const reasonField = `<div class="field"><label for="why">Motivo (opcional)</label><input class="inp" id="why" placeholder="p. ej. ritmo lento 2 semanas"></div>`;

// ---------------------------------------------------------------- kcal con previsión
function kcalSheet(ctx) {
  const v = currentPlan(plan(ctx));
  const a = ctx.analysis();
  const L = a.latest || {};
  // sin kcal en el plan se parte del gasto medido (o de 2.000) redondeado a 50
  const pk = planKcal(v);
  const start = pk || (() => { const k = L.tdeeReliable ? Math.round(L.tdee.E / 50) * 50 : 2000; return { train: k, rest: k }; })();
  let train = start.train, rest = start.rest;
  const forecast = () => {
    if (!L.tdeeReliable || !L.trend) return `<div class="forecast a"><div class="row"><span>Previsión disponible cuando haya 21 días de datos de peso.</span></div></div>`;
    const tmp = structuredClone(v); tmp.diet.kcal = { train, rest };
    const I = kcalTarget(tmp, undefined);
    const goal = ['loss', 'gain'].includes(goalOf(v)) ? v.targets?.weight_kg ?? null : null;
    const h = hallProjection({ W0: L.trend.level, E0: L.tdee.E, intake: I, goal, rho: a.rho });
    const lo = hallProjection({ W0: L.trend.level, E0: L.tdee.E + L.tdee.sd, intake: I, rho: a.rho });
    const hi = hallProjection({ W0: L.trend.level, E0: L.tdee.E - L.tdee.sd, intake: I, rho: a.rho });
    const pct = (h.rateWeek / L.trend.level) * 100; // cambio previsto, con signo
    const vd = rateVerdict(L.rateTarget, pct);
    return `<div class="forecast ${!vd || vd.status === 'in' ? '' : 'a'}">
      <div class="row"><span>Ritmo previsto</span><b class="num">${fmt(h.rateWeek, 2)} kg/sem</b></div>
      <div class="row"><span>Rango (±1σ del gasto)</span><b class="num">${fmt(lo.rateWeek, 2)} a ${fmt(hi.rateWeek, 2)}</b></div>
      <div class="row"><span>% peso/semana</span><b class="num">${pct > 0 ? '+' : ''}${fmt(pct, 2)} %${vd ? (vd.status === 'in' ? ' · en objetivo' : ` · objetivo: ${esc(bandText(L.rateTarget))}`) : ''}</b></div>
      ${goal ? `<div class="row"><span>${fmt(goal)} kg hacia</span><b class="num">${h.days ? fmtShort(addDays(ctx.today(), Math.round(h.days))) : 'no alcanzable'}</b></div>` : ''}
    </div>`;
  };
  const stepper = (id, label, val) => `<div class="muted small" style="font-weight:700;margin-top:10px">${label}</div>
    <div class="stepperbig" style="margin-top:6px"><button type="button" data-step="${id}" data-d="-50" aria-label="Menos 50">−</button><div class="val"><b class="num" id="${id}">${fmtK(val)}</b><span id="${id}D">${pk ? 'sin cambio' : 'nuevo'}</span></div><button type="button" data-step="${id}" data-d="50" aria-label="Más 50">+</button></div>`;
  openSheet(`<h3>Ajustar kcal</h3><div class="muted">Con previsión según tu gasto medido${L.tdeeReliable ? ` (${fmtK(L.tdee.E)} ± ${fmtK(L.tdee.sd)} kcal)` : ''}.</div>
    ${stepper('kT', 'Día de entreno', train)}${stepper('kR', 'Día de descanso', rest)}
    <label class="chk" style="border:0;padding:4px 0 10px"><input type="checkbox" id="kLink" checked><div><b>Mover los dos a la vez</b></div></label>
    <div id="kFc">${forecast()}</div>
    ${reasonField}
    <button class="btn primary" id="kSave" style="margin-top:12px">Guardar nueva versión</button>`, {
    bind: (sh) => {
      const paint = () => {
        $('#kT', sh).textContent = fmtK(train); $('#kR', sh).textContent = fmtK(rest);
        const dT = pk ? train - pk.train : null, dR = pk ? rest - pk.rest : null;
        $('#kTD', sh).textContent = !pk ? 'nuevo' : dT ? `${dT > 0 ? '+' : '−'}${Math.abs(dT)} kcal` : 'sin cambio';
        $('#kRD', sh).textContent = !pk ? 'nuevo' : dR ? `${dR > 0 ? '+' : '−'}${Math.abs(dR)} kcal` : 'sin cambio';
        $('#kFc', sh).innerHTML = forecast();
      };
      $$('[data-step]', sh).forEach((b) => b.addEventListener('click', () => {
        const d = +b.dataset.d, both = $('#kLink', sh).checked;
        if (b.dataset.step === 'kT' || both) train += d;
        if (b.dataset.step === 'kR' || both) rest += d;
        paint();
      }));
      $('#kSave', sh).addEventListener('click', () => {
        if (savePlan(ctx, (p) => { p.diet.kcal = { train, rest }; }, $('#why', sh).value)) { closeSheet(); ctx.render(); }
      });
    },
  });
}

// ---------------------------------------------------------------- dieta
function dietSheet(ctx) {
  const v = currentPlan(plan(ctx));
  const d = structuredClone(v.diet);
  d.rules ||= [];
  d.kcal ||= { train: null, rest: null };
  const val = (x) => (x ?? '');
  let mode = d.meals_mode === 'free' ? 'free' : 'fixed';
  d.meals = (d.meals || []).length ? d.meals : [1, 2, 3].map((n) => ({ slot: `Comida ${n}` }));
  // cada comida: nombre + objetivo opcional (sin objetivo · gramos de macros · porciones)
  const kindOf = (m) => (m.target ? 'g' : m.portions && Object.keys(m.portions).length ? 'por' : 'none');
  const mealRow = (m, i) => { const k = kindOf(m); return `<div class="card flat" data-meal="${i}" data-kind="${k}" style="padding:10px;margin-bottom:8px">
      <div class="row" style="gap:6px"><input class="inp sm" data-f="slot" value="${esc(m.slot)}" placeholder="Nombre (Comida 1, Intra-entreno…)" style="flex:1">
        <button type="button" class="mini" data-upmeal="${i}" aria-label="Subir">${icon.up}</button><button type="button" class="mini danger" data-delmeal="${i}" aria-label="Quitar comida">${icon.trash}</button></div>
      <div class="seg" data-kseg style="margin-top:8px"><button type="button" data-v="none" class="${k === 'none' ? 'on' : ''}">Sin objetivo</button><button type="button" data-v="g" class="${k === 'g' ? 'on' : ''}">Macros (g)</button><button type="button" data-v="por" class="${k === 'por' ? 'on' : ''}">Porciones</button></div>
      <div class="g3" data-kg style="margin-top:8px" ${k === 'g' ? '' : 'hidden'}>${[['p', 'P'], ['c', 'C'], ['f', 'G']].map(([f, l]) => `<div class="unit-wrap"><input class="inp sm" data-t="${f}" inputmode="decimal" value="${m.target?.[f] ?? ''}" placeholder="0"><span class="u">${l} g</span></div>`).join('')}</div>
      <div class="g3" data-kpor style="margin-top:8px" ${k === 'por' ? '' : 'hidden'}>${['P', 'C', 'G'].map((f) => `<div class="unit-wrap"><input class="inp sm" data-p="${f}" inputmode="decimal" value="${m.portions?.[f] ?? ''}" placeholder="0"><span class="u">${f}</span></div>`).join('')}</div>
    </div>`; };
  openSheet(`<h3>Dieta</h3>
    <div class="stack" style="margin-top:12px">
      <div class="g2"><div class="field"><label for="dT">Kcal entreno</label><input class="inp" id="dT" inputmode="numeric" value="${val(d.kcal.train)}" placeholder="opcional"></div><div class="field"><label for="dR">Kcal descanso</label><input class="inp" id="dR" inputmode="numeric" value="${val(d.kcal.rest)}" placeholder="igual"></div></div>
      <div class="g3"><div class="field"><label for="dP">Proteína g</label><input class="inp" id="dP" inputmode="numeric" value="${val(d.protein_g)}" placeholder="—"></div><div class="field"><label for="dC">Carbos g</label><input class="inp" id="dC" inputmode="numeric" value="${val(d.carbs_g)}" placeholder="—"></div><div class="field"><label for="dF">Grasas g</label><input class="inp" id="dF" inputmode="numeric" value="${val(d.fat_g)}" placeholder="—"></div></div>
      <div class="hint" id="dSum"></div>
      <div class="hint">Todo es opcional: deja vacío lo que no quieras fijar (sin kcal, Comidas solo enseña lo que llevas). Si solo pones las de entreno, valen para todos los días.</div>
      <div class="grp">Comidas</div>
      <div class="seg" id="mMode"><button type="button" data-v="fixed" class="${mode === 'fixed' ? 'on' : ''}">Fijas</button><button type="button" data-v="free" class="${mode === 'free' ? 'on' : ''}">Libres (las añado cada día)</button></div>
      <div class="hint" id="mHint"></div>
      <div id="mFixed" ${mode === 'fixed' ? '' : 'hidden'}>
        <div id="meals">${d.meals.map(mealRow).join('')}</div>
        <button class="btn secondary sm" id="addMeal" type="button" style="width:100%">${icon.plus} Añadir comida</button>
      </div>
      <div class="field"><label for="dRules">Reglas (una por línea)</label><textarea class="inp" id="dRules">${esc(d.rules.join('\n'))}</textarea></div>
      ${reasonField}
      <div class="sheet-actions"><button class="btn primary" id="dSave">Guardar nueva versión</button></div>
    </div>`, {
    bind: (sh) => {
      const sum = () => { $('#dSum', sh).textContent = `Los macros suman ${fmtK((int($('#dP', sh).value) || 0) * 4 + (int($('#dC', sh).value) || 0) * 4 + (int($('#dF', sh).value) || 0) * 9)} kcal.`; };
      ['#dP', '#dC', '#dF'].forEach((s) => $(s, sh).addEventListener('input', sum)); sum();
      const hint = () => { $('#mHint', sh).textContent = mode === 'fixed' ? 'Aparecen cada día en Comidas. El objetivo por comida es opcional: si no pones ninguno, solo cuenta el total del día.' : 'Cada día añades las comidas que hagas (con el nombre que quieras). Solo cuenta el total del día.'; };
      hint();
      bindSeg(sh, '#mMode', (val) => { mode = val; $('#mFixed', sh).hidden = val !== 'fixed'; hint(); });
      const collect = () => $$('[data-meal]', sh).map((row) => {
        const k = $('[data-kseg] button.on', row)?.dataset.v || 'none';
        const m = { slot: $('[data-f="slot"]', row).value.trim() };
        if (k === 'g') m.target = Object.fromEntries(['p', 'c', 'f'].map((f) => [f, num($(`[data-t="${f}"]`, row).value) || 0]));
        if (k === 'por') m.portions = Object.fromEntries(['P', 'C', 'G'].map((f) => [f, num($(`[data-p="${f}"]`, row).value) || 0]).filter(([, n]) => n));
        return m;
      }).filter((m) => m.slot);
      const redraw = (meals) => { $('#meals', sh).innerHTML = meals.map(mealRow).join(''); bindRows(); };
      const bindRows = () => {
        $$('[data-delmeal]', sh).forEach((b) => b.addEventListener('click', () => { const m = collect(); m.splice(+b.dataset.delmeal, 1); redraw(m); }));
        $$('[data-upmeal]', sh).forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.upmeal; if (!i) return; const m = collect(); [m[i - 1], m[i]] = [m[i], m[i - 1]]; redraw(m); }));
        $$('[data-meal]', sh).forEach((row) => $$('[data-kseg] button', row).forEach((b) => b.addEventListener('click', () => {
          $$('[data-kseg] button', row).forEach((x) => x.classList.toggle('on', x === b));
          $('[data-kg]', row).hidden = b.dataset.v !== 'g';
          $('[data-kpor]', row).hidden = b.dataset.v !== 'por';
        })));
      };
      bindRows();
      $('#addMeal', sh).addEventListener('click', () => { const m = collect(); redraw([...m, { slot: `Comida ${m.length + 1}` }]); });
      $('#dSave', sh).addEventListener('click', () => {
        const next = {
          ...d,
          // vacío = sin objetivo (null); las kcal de descanso vacías = las de entreno
          kcal: { train: int($('#dT', sh).value) || null, rest: int($('#dR', sh).value) || int($('#dT', sh).value) || null },
          protein_g: int($('#dP', sh).value) || null, carbs_g: int($('#dC', sh).value) || null, fat_g: int($('#dF', sh).value) || null,
          meals_mode: mode,
          meals: mode === 'fixed' ? collect() : [],
          rules: $('#dRules', sh).value.split('\n').map((s) => s.trim()).filter(Boolean),
        };
        if (savePlan(ctx, (p) => { p.diet = next; }, $('#why', sh).value)) { closeSheet(); ctx.render(); }
      });
    },
  });
}

// ---------------------------------------------------------------- rutina (un día)
function daySheet(ctx, idx) {
  const v = currentPlan(plan(ctx));
  const isNew = idx < 0;
  const day = isNew ? { name: `Día ${v.routine.days.length + 1}`, items: [] } : structuredClone(v.routine.days[idx]);
  const itemRow = (x, i) => `<div class="card flat" data-item="${i}" style="padding:12px;margin-bottom:8px">
      <div class="row" style="margin-bottom:8px"><input class="inp sm" data-f="name" list="exList" autocomplete="off" value="${esc(x.name)}" placeholder="Ejercicio (empieza a escribir)" style="flex:1">
        <div class="ops" style="display:flex;gap:4px"><button type="button" class="mini" data-up="${i}" aria-label="Subir">${icon.up}</button><button type="button" class="mini danger" data-del="${i}" aria-label="Quitar">${icon.trash}</button></div></div>
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px">
        <div class="unit-wrap"><input class="inp sm" data-f="sets" inputmode="numeric" value="${x.sets ?? ''}" placeholder="3"><span class="u">ser</span></div>
        <div class="unit-wrap"><input class="inp sm" data-f="lo" inputmode="numeric" value="${x.reps?.[0] ?? ''}" placeholder="8"><span class="u">de</span></div>
        <div class="unit-wrap"><input class="inp sm" data-f="hi" inputmode="numeric" value="${x.reps?.[1] ?? ''}" placeholder="10"><span class="u">a</span></div>
        <div class="unit-wrap"><input class="inp sm" data-f="rpe" inputmode="decimal" value="${x.rpe ?? ''}" placeholder="8"><span class="u">RPE</span></div>
      </div>
      <input class="inp sm" data-f="note" value="${esc(x.note || '')}" placeholder="Indicación (opcional)" style="margin-top:6px">
      <div class="musbox" data-muscles='${esc(JSON.stringify(x._muscles || {}))}' data-custom="${x._custom ? 1 : ''}">${musBox(x)}</div>
    </div>`;
  // Músculos del ejercicio: si el catálogo lo reconoce, se muestran (y se pueden cambiar);
  // si no, se marcan aquí mismo tocando cada músculo (1 toque directo, 2 indirecto ½, 3 quitar).
  const musBox = (x) => {
    const ex = x.name ? resolveExercise(x.name, exercisesOf(ctx)) : null;
    const m = x._custom ? x._muscles || {} : ex?.muscles || {};
    const showChips = x._custom || (!ex && x.name);
    const chips = MUSCLES.map(([k, l]) => `<button type="button" data-mk="${k}" class="${m[k] ? 'on' : ''}" style="${m[k] === 0.5 ? 'opacity:.7' : ''}">${l}${m[k] === 0.5 ? ' ½' : ''}</button>`).join('');
    const line = !x.name ? '<span class="muted">Escribe el ejercicio y verás sus músculos</span>'
      : x._custom ? `<b>Tus músculos:</b> ${Object.keys(m).length ? esc(musclesLine({ muscles: m })) : '<span class="warn">marca al menos uno</span>'}`
      : ex ? `${esc(musclesLine(ex))} · <button type="button" class="link" data-musedit style="padding:0">cambiar</button>`
      : '<span class="warn">No está en el catálogo: marca los músculos que trabaja</span>';
    return `<div class="small" style="margin-top:8px;font-weight:600;color:var(--ink-2)">${line}</div>${showChips ? `<div class="chipset sm" style="margin-top:6px">${chips}</div><div class="hint" style="margin-top:4px">1 toque: directo · 2: indirecto (½) · 3: quitar</div>` : ''}`;
  };
  openSheet(`<h3>${isNew ? 'Nuevo día' : `Editar ${esc(day.name)}`}</h3>
    <div class="stack" style="margin-top:12px">
      <div class="field"><label for="dayName">Nombre del día</label><input class="inp" id="dayName" value="${esc(day.name)}"></div>
      <div class="field"><label for="dayWarm">Calentamiento (opcional)</label><textarea class="inp" id="dayWarm" style="min-height:64px" placeholder="p. ej. 3 min de respiración · movilidad de hombros y cadera · 1 serie ligera del primer ejercicio">${esc(day.warmup || '')}</textarea>
        <div class="hint">Sale arriba en Entreno como «Antes de empezar». No cuenta como ejercicio.</div></div>
      ${datalist(ctx)}
      <div id="items">${day.items.map(itemRow).join('')}</div>
      <div class="hint" style="margin-top:-4px">Al escribir te sugiere ejercicios del catálogo, que ya saben qué músculos trabajan. Si escribes uno que no está, marca sus músculos debajo.</div>
      <button class="btn secondary sm" id="addItem" type="button">${icon.plus} Añadir ejercicio</button>
      ${reasonField}
      <div class="sheet-actions"><button class="btn primary" id="daySave">Guardar nueva versión</button></div>
      ${isNew ? '' : `<button class="btn secondary" id="dayDel" style="color:var(--amber)">${icon.trash} Eliminar este día</button>`}
    </div>`, {
    bind: (sh) => {
      const collect = () => $$('[data-item]', sh).map((row) => {
        const g = (f) => $(`[data-f="${f}"]`, row).value;
        const lo = int(g('lo')), hi = int(g('hi'));
        const nm = g('name').trim();
        const ex = resolveExercise(nm, exercisesOf(ctx));
        const box = $('.musbox', row);
        const custom = box.dataset.custom === '1' || (!ex && !!nm);
        const muscles = JSON.parse(box.dataset.muscles || '{}');
        return { name: nm, ...(ex ? { ex: ex.id } : {}), sets: int(g('sets')) || 0, reps: [lo ?? hi ?? 0, hi ?? lo ?? 0], rpe: num(g('rpe')) ?? undefined, note: g('note').trim() || undefined, _custom: custom, _muscles: muscles };
      });
      const redraw = (items) => { $('#items', sh).innerHTML = items.map(itemRow).join(''); bindRows(); };
      const bindRows = () => {
        $$('[data-item]', sh).forEach((row) => {
          const box = $('.musbox', row);
          const repaint = () => {
            const it = { name: $('[data-f="name"]', row).value.trim(), _custom: box.dataset.custom === '1', _muscles: JSON.parse(box.dataset.muscles || '{}') };
            box.innerHTML = musBox(it);
            bindBox();
          };
          const bindBox = () => {
            $('[data-musedit]', box)?.addEventListener('click', () => {
              const ex = resolveExercise($('[data-f="name"]', row).value.trim(), exercisesOf(ctx));
              box.dataset.custom = '1';
              box.dataset.muscles = JSON.stringify(ex?.muscles || {});
              repaint();
            });
            $$('[data-mk]', box).forEach((b) => b.addEventListener('click', () => {
              const m = JSON.parse(box.dataset.muscles || '{}'), k = b.dataset.mk;
              if (!m[k]) m[k] = 1; else if (m[k] === 1) m[k] = 0.5; else delete m[k];
              box.dataset.muscles = JSON.stringify(m);
              box.dataset.custom = '1';
              repaint();
            }));
          };
          bindBox();
          let t;
          $('[data-f="name"]', row).addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { if (box.dataset.custom !== '1') repaint(); }, 250); });
          $('[data-f="name"]', row).addEventListener('change', () => { if (box.dataset.custom !== '1') repaint(); });
        });
        $$('[data-del]', sh).forEach((b) => b.addEventListener('click', () => { const it = collect(); it.splice(+b.dataset.del, 1); redraw(it); }));
        $$('[data-up]', sh).forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.up; if (!i) return; const it = collect(); [it[i - 1], it[i]] = [it[i], it[i - 1]]; redraw(it); }));
      };
      bindRows();
      $('#addItem', sh).addEventListener('click', () => { redraw([...collect(), { name: '', sets: 3, reps: [8, 10], rpe: 8 }]); $$('[data-item]', sh).pop()?.querySelector('[data-f="name"]').focus(); });
      $('#daySave', sh).addEventListener('click', async () => {
        const items = collect().filter((x) => x.name);
        const noMuscles = items.filter((x) => x._custom && !Object.values(x._muscles).includes(1));
        if (noMuscles.length && !(await ask({ title: 'Ejercicios sin músculos', text: `${noMuscles.map((x) => x.name).join(', ')}: sin músculo directo marcado. No contarán en el volumen.`, ok: 'Guardar igualmente' }))) return;
        // ejercicios con músculos propios → exercises.json (se reconocen por nombre en adelante)
        const customs = items.filter((x) => x._custom && Object.values(x._muscles).includes(1));
        if (customs.length) {
          ctx.store.update(FILES.exercises, (doc) => {
            doc = doc && typeof doc === 'object' ? doc : {};
            doc.items ||= [];
            for (const c of customs) {
              const prev = doc.items.find((e) => e.name.toLowerCase() === c.name.toLowerCase());
              const id = prev?.id || `mine:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
              c.ex = id;
              doc.items = [...doc.items.filter((e) => e.id !== id), { id, name: c.name, muscles: c._muscles }];
            }
            return doc;
          }, `Ejercicios propios: ${customs.map((c) => c.name).join(', ')}`);
        }
        const clean = items.map(({ _custom, _muscles, ...x }) => x);
        const warmup = $('#dayWarm', sh).value.trim();
        const next = { name: $('#dayName', sh).value.trim() || day.name, ...(warmup ? { warmup } : {}), items: clean };
        const ok = savePlan(ctx, (p) => { if (isNew) p.routine.days.push(next); else p.routine.days[idx] = next; }, $('#why', sh).value);
        if (ok) { if (isNew) ctx.state.planDay = v.routine.days.length; closeSheet(); ctx.render(); }
      });
      $('#dayDel', sh)?.addEventListener('click', async () => {
        if (!(await ask({ title: `¿Eliminar ${day.name}?`, text: 'Se quita de la rutina en una versión nueva del plan; las anteriores lo conservan.', ok: 'Eliminar', danger: true }))) return;
        if (savePlan(ctx, (p) => { p.routine.days.splice(idx, 1); }, $('#why', sh).value || `Quita ${day.name}`)) { ctx.state.planDay = 0; closeSheet(); ctx.render(); }
      });
    },
  });
}

// ---------------------------------------------------------------- suplementos / medicación
function suppSheet(ctx, idx, kind = 'supplement') {
  const v = currentPlan(plan(ctx));
  const isNew = idx < 0;
  const s = isNew ? { name: '', dose: '', timing: '', kind } : structuredClone(v.supplements[idx]);
  openSheet(`<h3>${isNew ? 'Añadir' : 'Editar'} ${s.kind === 'medication' ? 'medicación' : 'suplemento'}</h3>
    <div class="stack" style="margin-top:12px">
      <div class="field"><label for="sName">Nombre</label><input class="inp" id="sName" value="${esc(s.name)}" autofocus></div>
      <div class="g2"><div class="field"><label for="sDose">Dosis</label><input class="inp" id="sDose" value="${esc(s.dose || '')}" placeholder="5 g"></div><div class="field"><label for="sTime">Momento</label><input class="inp" id="sTime" value="${esc(s.timing || '')}" placeholder="Desayuno"></div></div>
      <div class="field"><label>Tipo</label><div class="seg" id="sKind"><button data-v="supplement" class="${s.kind !== 'medication' ? 'on' : ''}">Suplemento</button><button data-v="medication" class="${s.kind === 'medication' ? 'on' : ''}">Medicación</button></div></div>
      ${reasonField}
      <button class="btn primary" id="sSave">${isNew ? 'Añadir desde hoy' : 'Guardar'}</button>
      ${isNew ? '' : `<button class="btn secondary" id="sDel" style="color:var(--amber)">${icon.trash} Dejar de tomar</button>`}
    </div>`, {
    bind: (sh) => {
      bindSeg(sh, '#sKind');
      $('#sSave', sh).addEventListener('click', () => {
        const next = { name: $('#sName', sh).value.trim(), dose: $('#sDose', sh).value.trim() || undefined, timing: $('#sTime', sh).value.trim() || undefined, kind: segValue(sh, '#sKind') };
        if (!next.name) return toast('Pon un nombre');
        if (savePlan(ctx, (p) => { if (isNew) p.supplements.push(next); else p.supplements[idx] = next; }, $('#why', sh).value)) { ctx.state.planTab = 'supl'; closeSheet(); ctx.render(); }
      });
      $('#sDel', sh)?.addEventListener('click', async () => {
        if (!(await ask({ title: `¿Dejar de tomar «${s.name}»?`, text: 'Se crea una versión nueva del plan; las anteriores lo conservan.', ok: 'Dejar de tomar', danger: true }))) return;
        if (savePlan(ctx, (p) => { p.supplements.splice(idx, 1); }, $('#why', sh).value)) { closeSheet(); ctx.render(); }
      });
    },
  });
}

// ---------------------------------------------------------------- objetivos
function targetsSheet(ctx) {
  const v = currentPlan(plan(ctx));
  const t = v.targets || {};
  const goal0 = goalOf(v);
  let goal = goal0;
  const manual0 = Array.isArray(t.rate_pct_week);
  // el ritmo depende del objetivo: estos textos cambian al elegir otro
  const RATE = {
    loss: { label: 'Ritmo de pérdida (% peso/semana)', auto: 'Automático (según % graso)', lo: 'Mín. pérdida', hi: 'Máx. pérdida' },
    maintain: { label: 'Franja de peso estable (% peso/semana)', auto: `Automático (±${fmt(MAINTAIN_BAND, 2)})`, lo: 'Mín. (p. ej. −0,2)', hi: 'Máx. (p. ej. 0,2)' },
    gain: { label: 'Ritmo de ganancia (% peso/semana)', auto: `Automático (${fmt(GAIN_RATE[0], 2)}–${fmt(GAIN_RATE[1], 2)})`, lo: 'Mín. ganancia', hi: 'Máx. ganancia' },
  };
  const rv = (i) => (manual0 ? fmt(t.rate_pct_week[i], 2) : '');
  openSheet(`<h3>Objetivos y fase</h3>
    <div class="stack" style="margin-top:12px">
      <div class="field"><label>Objetivo</label><div class="chipset" id="tGoal">${GOALS.map(([k, l]) => `<button type="button" data-v="${k}" class="${goal === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
        <div class="hint" id="tGoalHint"></div></div>
      <div class="g2"><div class="field"><label for="tPhase">Fase</label><input class="inp" id="tPhase" value="${esc(v.phase || '')}" placeholder="A"></div><div class="field"><label for="tMicro">Microciclo</label><input class="inp" id="tMicro" value="${esc(v.micro || '')}" placeholder="2/6"></div></div>
      <div class="g2"><div class="field" id="tWBox"><label for="tW">Peso objetivo (kg)</label><input class="inp" id="tW" inputmode="decimal" value="${t.weight_kg != null ? fmt(t.weight_kg) : ''}"></div><div class="field"><label for="tWaist">Cintura objetivo (cm)</label><input class="inp" id="tWaist" inputmode="decimal" value="${t.waist_cm != null ? fmt(t.waist_cm) : ''}"></div></div>
      <div class="g3"><div class="field"><label for="tSteps">Pasos</label><input class="inp" id="tSteps" inputmode="numeric" value="${t.steps != null ? fmtK(t.steps) : ''}"></div><div class="field"><label for="tSess">Sesiones</label><input class="inp" id="tSess" inputmode="numeric" value="${t.sessions ?? ''}"></div><div class="field"><label for="tSleep">Sueño (h)</label><input class="inp" id="tSleep" inputmode="decimal" value="${t.sleep_h != null ? fmt(t.sleep_h) : ''}"></div></div>
      <div id="tRateBox">
        <div class="field"><label id="tRateL"></label><div class="seg" id="tAuto"><button data-v="auto" class="${manual0 ? '' : 'on'}"></button><button data-v="manual" class="${manual0 ? 'on' : ''}">Manual</button></div></div>
        <div class="g2" id="tManual" ${manual0 ? '' : 'hidden'} style="margin-top:10px"><div class="field"><label for="tR0" id="tR0L"></label><input class="inp" id="tR0" inputmode="decimal" value="${rv(0)}"></div><div class="field"><label for="tR1" id="tR1L"></label><input class="inp" id="tR1" inputmode="decimal" value="${rv(1)}"></div></div>
      </div>
      ${reasonField}
      <div class="sheet-actions"><button class="btn primary" id="tSave">Guardar nueva versión</button></div>
    </div>`, {
    bind: (sh) => {
      const HINT = {
        loss: 'Perder grasa: franja de ritmo según tu % graso, aviso si vas demasiado rápido o lento, y en Comidas se marca pasarse de kcal.',
        maintain: 'Mantener el peso: aviso si la tendencia se sale de la franja 2 semanas. Pasarse de kcal no se marca.',
        gain: 'Volumen: ganar despacio, con aviso si ganas demasiado rápido o lento. Pasarse de kcal no se marca.',
        none: 'Solo registrar: ves tus datos y tendencias sin franjas, avisos ni comparaciones con el plan. Kcal y macros de la dieta pasan a ser opcionales.',
      };
      const paint = () => {
        $('#tGoalHint', sh).textContent = HINT[goal];
        $('#tRateBox', sh).hidden = goal === 'none';
        $('#tWBox', sh).hidden = !(goal === 'loss' || goal === 'gain');
        if (goal === 'none') return;
        $('#tRateL', sh).textContent = RATE[goal].label;
        $('#tAuto button[data-v="auto"]', sh).textContent = RATE[goal].auto;
        $('#tR0L', sh).textContent = RATE[goal].lo;
        $('#tR1L', sh).textContent = RATE[goal].hi;
      };
      paint();
      bindSeg(sh, '#tGoal', (val) => {
        // la franja manual de un objetivo no vale para otro: al cambiar, vuelve a automático
        if (val !== goal && val !== goal0) { $$('#tAuto button', sh).forEach((b) => b.classList.toggle('on', b.dataset.v === 'auto')); $('#tManual', sh).hidden = true; $('#tR0', sh).value = ''; $('#tR1', sh).value = ''; }
        goal = val; paint();
      });
      bindSeg(sh, '#tAuto', (val) => { $('#tManual', sh).hidden = val === 'auto'; });
      $('#tSave', sh).addEventListener('click', () => {
        const manual = goal !== 'none' && segValue(sh, '#tAuto') === 'manual';
        const r0 = num($('#tR0', sh).value), r1 = num($('#tR1', sh).value);
        if (manual && (r0 == null || r1 == null)) return toast('Pon el mínimo y el máximo del ritmo, o elige automático');
        if (manual && goal !== 'maintain' && (r0 < 0 || r1 < 0)) return toast('En pérdida y volumen el ritmo va en positivo (p. ej. 0,5)');
        const next = {
          ...t,
          goal,
          weight_kg: $('#tWBox', sh).hidden ? t.weight_kg ?? null : num($('#tW', sh).value), waist_cm: num($('#tWaist', sh).value),
          steps: int($('#tSteps', sh).value), sessions: int($('#tSess', sh).value), sleep_h: num($('#tSleep', sh).value),
          rate_pct_week: manual ? [Math.min(r0, r1), Math.max(r0, r1)] : null,
        };
        const phase = $('#tPhase', sh).value.trim(), micro = $('#tMicro', sh).value.trim();
        if (savePlan(ctx, (p) => { p.targets = next; p.phase = phase; p.micro = micro; }, $('#why', sh).value)) { closeSheet(); ctx.render(); }
      });
    },
  });
}

// ---------------------------------------------------------------- historial
function historySheet(ctx) {
  const vs = [...plan(ctx).versions].sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : b.v - a.v));
  const cur = currentPlan(plan(ctx));
  const canDelete = vs.length > 1;
  openSheet(`<h3>Historial del plan</h3>
    <div class="muted small" style="margin-top:2px">Una versión por día en que cambias el plan, con cada cambio anotado. ${canDelete ? 'Puedes borrar una versión entera: si borras la vigente, pasa a regir la anterior.' : 'Solo hay una versión, así que no se puede borrar.'}</div>
    <div class="tl" style="margin-top:16px">
    ${vs.map((x, i) => { const n = versionNumber(plan(ctx), x); const ch = x.changes?.length ? x.changes : [{ at: null, reason: x.reason }];
      return `<div class="it ${x.v === cur.v ? 'cur' : ''}"><div class="row" style="align-items:flex-start">
        <div style="flex:1;min-width:0"><div class="d">${esc(fmtShort(x.from))} · v${n}${x.v === cur.v ? ' · vigente' : ''} · ${ch.length} ${ch.length === 1 ? 'cambio' : 'cambios'}</div>
          ${ch.slice().reverse().map((c) => `<div style="margin-top:4px"><b style="font-size:14px">${esc(c.reason || '—')}</b>${c.at ? ` <span class="muted small">${esc(new Date(c.at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }))}</span>` : ''}</div>`).join('')}
          ${vs[i + 1] ? `<div class="x" style="margin-top:4px">Respecto a v${n - 1}: ${esc(diffText(vs[i + 1], x) || 'sin cambios')}</div>` : ''}</div>
        ${canDelete ? `<button class="mini danger" data-delv="${esc(x.v)}" aria-label="Borrar versión ${n}">${icon.trash}</button>` : ''}
      </div></div>`; }).join('')}
  </div>`, {
    bind: (sh) => {
      $$('[data-delv]', sh).forEach((b) => b.addEventListener('click', async () => {
        const v = +b.dataset.delv;
        const x = vs.find((y) => y.v === v);
        if (!(await ask({ title: `¿Borrar la versión del ${fmtShort(x.from)}?`, text: 'Con todos sus cambios. No se puede deshacer desde la app (queda en el historial de GitHub).', ok: 'Borrar', danger: true }))) return;
        ctx.store.update(FILES.plan, (d) => {
          const rest = d.versions.filter((y) => y.v !== v);
          // Si se borra la versión más antigua, la siguiente pasa a cubrir desde esa fecha
          // (así ningún día anterior se queda sin plan).
          const first = rest.reduce((m, y) => (y.from < m.from ? y : m), rest[0]);
          if (first && x.from < first.from) first.from = x.from;
          return { ...d, versions: rest };
        }, `Plan: borra v${v} (${x.reason || fmtShort(x.from)})`);
        toast('Versión borrada');
        writeSummary(ctx);
        closeSheet();
        ctx.render();
      }));
    },
  });
}

// ---------------------------------------------------------------- importar / exportar (formato Recomp)
const MUSCLE_KEYS = MUSCLES.map(([k, l]) => `${k} (${l})`).join(', ');
export const CLAUDE_PROMPT = `Cuando cerremos un plan, dámelo en «formato Recomp»: un único bloque JSON (sin comentarios) con esta forma. Incluye solo las secciones que cambien; las que no vengan se quedan como están.

{
  "formato": "recomp-plan",
  "fase": "1e", "micro": "1/6",
  "objetivos": { "objetivo": "perdida", "peso_kg": 97, "cintura_cm": 91, "pasos": 10000, "sesiones_semana": 5, "sueno_h": 7.5, "ritmo_pct_semana": null },
  "dieta": {
    "kcal_entreno": 3150, "kcal_descanso": 2850, "proteina_g": 260, "carbohidratos_g": 330, "grasas_g": 85,
    "modo_comidas": "fijas",
    "comidas": [ { "nombre": "Comida 1", "objetivo": { "proteina_g": 50, "carbohidratos_g": 80, "grasas_g": 20 } }, { "nombre": "Intra-entreno", "porciones": { "C": 1 } }, { "nombre": "Comida 3" } ],
    "reglas": [ "Comida libre opcional el domingo en la cena (máx. 1.200 kcal)" ]
  },
  "rutina": { "mesociclo": { "inicio": "2026-10-05", "semanas": 4, "rir": [3, 2, 2, 1], "descarga": true },
    "dias": [ { "nombre": "Día 1 · Pierna", "calentamiento": "3 min de respiración · movilidad de cadera", "ejercicios": [
    { "nombre": "Sentadilla trasera", "series": 4, "reps": [6, 8], "rpe": 8, "nota": "barra alta" }
  ] } ] },
  "suplementos": [ { "nombre": "Creatina", "dosis": "5 g", "momento": "Con una comida", "tipo": "suplemento" } ]
}

Reglas: kcal y gramos por día; "reps" es [mín, máx]; "rpe" 1–10; "tipo" es "suplemento" o "medicacion"; "objetivo" es "perdida", "mantenimiento", "volumen" o "sin_objetivo" (solo registro: sin franjas ni avisos); "ritmo_pct_semana" es null (automático según el objetivo) o [mín, máx] en % de peso por semana (en pérdida y volumen, en positivo en la dirección del objetivo; en mantenimiento, con signo, p. ej. [-0.2, 0.2]); kcal y macros de la dieta pueden ser null (sin objetivo); "calentamiento" de cada día es opcional (texto libre; no es un ejercicio ni cuenta volumen); "mesociclo" es opcional ("inicio" un lunes, "semanas" de carga, un RIR por semana, "descarga" añade una semana final con la mitad de series; null lo quita); "modo_comidas" es "fijas" (lista de "comidas", cada una con "objetivo" en gramos, "porciones" o nada) o "libres" (sin lista; se añaden cada día); nunca repartas el total del día entre comidas si no te lo pido; porciones con claves P, C, G, F (fruta), L (lácteo). Si un ejercicio no es habitual, añade "musculos" con 1 (directo) o 0.5 (indirecto) usando: ${MUSCLE_KEYS}.`;

async function copyText(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch { openSheet(`<h3>Copiar</h3><div class="muted">Mantén pulsado para copiar.</div><pre class="claude">${esc(text)}</pre>`); }
}

function exportSheet(ctx) {
  const v = currentPlan(plan(ctx));
  const json = JSON.stringify(exportPlan(v), null, 2);
  openSheet(`<h3>Exportar el plan</h3>
    <div class="muted">Para diseñar cambios con Claude: copia tu plan actual y las instrucciones del formato, pégalo en la conversación, y cuando lo tengáis cerrado pídele el plan «en formato Recomp» y usa <b>Importar plan</b>.</div>
    <div class="stack" style="margin-top:14px">
      <button class="btn primary" id="xAll">Copiar plan + instrucciones para Claude</button>
      <button class="btn secondary" id="xJson">Copiar solo el plan (JSON)</button>
    </div>
    <pre class="claude" style="max-height:34vh">${esc(json)}</pre>`, {
    bind: (sh) => {
      $('#xAll', sh).addEventListener('click', () => copyText(`${CLAUDE_PROMPT}\n\nEste es mi plan actual:\n\n\`\`\`json\n${json}\n\`\`\``, 'Copiado: pégalo en Claude'));
      $('#xJson', sh).addEventListener('click', () => copyText(json, 'Plan copiado'));
    },
  });
}

function importSheet(ctx) {
  openSheet(`<h3>Importar plan</h3>
    <div class="muted">Pega el plan en «formato Recomp» (el bloque que te da Claude). Solo cambia lo que venga en él; antes de aplicarlo verás qué cambia.</div>
    <div class="stack" style="margin-top:12px">
      <div class="g2"><button class="btn secondary sm" id="iPaste" type="button" style="width:100%">Pegar del portapapeles</button>
        <label class="btn secondary sm" style="width:100%;position:relative">Abrir archivo<input type="file" id="iFile" accept=".json,.txt,application/json,text/plain" style="position:absolute;inset:0;opacity:0"></label></div>
      <textarea class="inp" id="iText" placeholder='{ "formato": "recomp-plan", … }' style="min-height:160px;font:500 12.5px/1.45 ui-monospace,Menlo,monospace"></textarea>
      <div id="iPreview"></div>
      <div class="sheet-actions"><button class="btn primary" id="iCheck">Revisar cambios</button></div>
    </div>`, {
    bind: (sh) => {
      let parsed = null;
      const ta = $('#iText', sh);
      $('#iPaste', sh).addEventListener('click', async () => {
        try { ta.value = await navigator.clipboard.readText(); preview(); } catch { toast('No se pudo leer el portapapeles: pégalo a mano'); }
      });
      $('#iFile', sh).addEventListener('change', async (e) => { const f = e.target.files?.[0]; if (f) { ta.value = await f.text(); preview(); } });
      ta.addEventListener('input', () => { parsed = null; $('#iCheck', sh).textContent = 'Revisar cambios'; });
      const preview = () => {
        const box = $('#iPreview', sh);
        try {
          const r = parsePlan(extractJson(ta.value));
          const before = currentPlan(plan(ctx));
          const after = structuredClone(before);
          r.apply(after);
          parsed = r;
          const diff = diffText(before, after);
          box.innerHTML = `<div class="card flat" style="margin:0">
            <div class="small" style="font-weight:800;margin-bottom:6px">Secciones: ${esc(r.sections.join(', '))}</div>
            <div class="small">${diff ? `Cambia: ${esc(diff)}` : 'No hay diferencias con tu plan actual.'}</div>
            ${r.exercises.length ? `<div class="small" style="margin-top:6px">Ejercicios con músculos definidos: ${esc(r.exercises.map((e) => e.name).join(', '))}</div>` : ''}
            ${r.warnings.map((w) => `<div class="small warn" style="margin-top:6px">⚠ ${esc(w)}</div>`).join('')}
          </div>
          <div class="field" style="margin-top:10px"><label for="iWhy">Motivo</label><input class="inp" id="iWhy" value="Plan importado (diseñado con Claude)"></div>`;
          $('#iCheck', sh).textContent = diff ? 'Aplicar como nueva versión' : 'Revisar cambios';
          if (!diff) parsed = null;
        } catch (e) {
          parsed = null;
          box.innerHTML = `<div class="err">${esc(e.message)}</div>`;
          $('#iCheck', sh).textContent = 'Revisar cambios';
        }
      };
      $('#iCheck', sh).addEventListener('click', () => {
        if (!parsed) return preview();
        const r = parsed;
        if (r.exercises.length) {
          ctx.store.update(FILES.exercises, (doc) => {
            doc = doc && typeof doc === 'object' ? doc : {};
            doc.items ||= [];
            for (const e of r.exercises) {
              if (!Object.values(e.muscles).includes(1)) continue;
              const prev = doc.items.find((x) => x.name.toLowerCase() === e.name.toLowerCase());
              const id = prev?.id || `mine:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
              doc.items = [...doc.items.filter((x) => x.id !== id), { id, name: e.name, muscles: e.muscles }];
            }
            return doc;
          }, 'Ejercicios del plan importado');
        }
        if (savePlan(ctx, (p) => r.apply(p), $('#iWhy', sh)?.value || 'Plan importado')) { closeSheet(); ctx.render(); }
      });
    },
  });
}
