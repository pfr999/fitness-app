// Plan: rutina, dieta, suplementos/medicación y objetivos. Cada cambio crea una versión con fecha y motivo.

import { $, $$, esc, fmt, fmtK, num, int, toast, openSheet, closeSheet, bindSeg, segValue, icon } from '../ui/ui.js';
import { addDays, fmtShort } from '../dates.js';
import { FILES, currentPlan, newPlanVersion, kcalTarget } from '../model.js';
import { hallProjection } from '../engine/energy.js';
import { writeSummary } from '../summary.js';

const TABS = [['rutina', 'Rutina'], ['dieta', 'Dieta'], ['supl', 'Suplem.'], ['obj', 'Objetivos']];

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
  kd(a.diet.kcal.train, b.diet.kcal.train, 'kcal entreno');
  kd(a.diet.kcal.rest, b.diet.kcal.rest, 'kcal descanso');
  kd(a.diet.protein_g, b.diet.protein_g, 'proteína');
  kd(a.diet.carbs_g, b.diet.carbs_g, 'carbohidratos');
  kd(a.diet.fat_g, b.diet.fat_g, 'grasas');
  if (JSON.stringify(a.diet.meals) !== JSON.stringify(b.diet.meals)) out.push('comidas');
  if (JSON.stringify(a.diet.rules) !== JSON.stringify(b.diet.rules)) out.push('reglas de dieta');
  if (JSON.stringify(a.routine) !== JSON.stringify(b.routine)) out.push('rutina');
  const sa = new Set(a.supplements.map((s) => s.name)), sb = new Set(b.supplements.map((s) => s.name));
  for (const n of sb) if (!sa.has(n)) out.push(`+${n}`);
  for (const n of sa) if (!sb.has(n)) out.push(`−${n}`);
  if (!out.some((x) => x.startsWith('+') || x.startsWith('−')) && JSON.stringify(a.supplements) !== JSON.stringify(b.supplements)) out.push('suplementos');
  if (JSON.stringify(a.targets) !== JSON.stringify(b.targets)) out.push('objetivos');
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
      <div class="vi">v${esc(v.v)}</div>
      <div style="flex:1;min-width:0"><b style="font-size:15px">${esc([v.phase && `Fase ${v.phase}`, v.micro && `Micro ${v.micro}`].filter(Boolean).join(' · ') || 'Plan actual')}</b><div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Desde ${esc(fmtShort(v.from))} ${prevReason}</div></div>
      <button class="link" id="history">Historial</button>
    </div>
    <div class="qa">
      <button data-quick="kcal">${icon.flame}Kcal</button>
      <button data-quick="targets">${icon.target}Objetivos</button>
      <button data-quick="day">${icon.dumbbell}Rutina</button>
      <button data-quick="supp">${icon.pill}Suplem.</button>
    </div>
    <div class="seg" id="planSeg" style="margin-bottom:12px">${TABS.map(([k, l]) => `<button data-v="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const body = tab === 'dieta' ? renderDiet(v) : tab === 'supl' ? renderSupp(v) : tab === 'obj' ? renderTargets(ctx, v) : renderRoutine(ctx, v);
  return head + body;
}

function renderRoutine(ctx, v) {
  const days = v.routine.days;
  if (!days.length) return `<div class="card empty"><b>Sin rutina</b>Crea tu primer día de entreno.<div style="margin-top:12px"><button class="btn primary" data-editday="-1">${icon.plus} Añadir día</button></div></div>`;
  const i = Math.min(ctx.state.planDay || 0, days.length - 1);
  const d = days[i];
  return `<div class="daytabs" id="dayTabs">${days.map((x, k) => `<button data-v="${k}" class="${k === i ? 'on' : ''}">${esc(x.name)}</button>`).join('')}<button data-v="new" aria-label="Añadir día">${icon.plus}</button></div>
    <div class="card"><div class="ch"><h2>${esc(d.name)}</h2><span class="aux">${d.items.reduce((a, x) => a + (x.sets || 0), 0)} series</span></div>
      ${d.items.map((x, k) => `<div class="pe"><span class="ex-n">${k + 1}</span><div class="ex-t"><b>${esc(x.name)}</b><span>${esc(x.sets)} × ${esc((x.reps || []).join('–'))}${x.rpe ? ` · RPE ${esc(x.rpe)}` : ''}</span>${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}</div></div>`).join('') || '<div class="muted">Sin ejercicios.</div>'}
      <button class="btn secondary sm" style="margin-top:12px;width:100%" data-editday="${i}">${icon.edit} Editar ${esc(d.name)}</button>
    </div>`;
}

function renderDiet(v) {
  const d = v.diet;
  const kcalMacros = d.protein_g * 4 + d.carbs_g * 4 + d.fat_g * 9;
  return `<div class="card"><div class="ch"><h2>Objetivos diarios</h2><button class="link" data-quick="diet">Editar</button></div>
      <div class="g2">
        <div class="card flat" style="margin:0;padding:12px"><div class="muted small" style="font-weight:700">Día de entreno</div><div style="font-size:24px;font-weight:800" class="num">${fmtK(d.kcal.train)}</div></div>
        <div class="card flat" style="margin:0;padding:12px"><div class="muted small" style="font-weight:700">Día de descanso</div><div style="font-size:24px;font-weight:800" class="num">${fmtK(d.kcal.rest)}</div></div>
      </div>
      <div class="g3" style="margin-top:10px;text-align:center">
        <div><div class="muted small" style="font-weight:700">Proteína</div><b class="num">${fmtK(d.protein_g)} g</b></div>
        <div><div class="muted small" style="font-weight:700">Carbos</div><b class="num">${fmtK(d.carbs_g)} g</b></div>
        <div><div class="muted small" style="font-weight:700">Grasas</div><b class="num">${fmtK(d.fat_g)} g</b></div>
      </div>
      <div class="hint">Los macros suman ${fmtK(kcalMacros)} kcal.</div>
    </div>
    <div class="card"><div class="ch"><h2>Comidas y porciones</h2><button class="link" data-quick="diet">Editar</button></div>
      ${(d.meals || []).map((m) => `<div class="meal"><span>${esc(m.slot)}</span><div class="por">${Object.entries(m.portions || {}).filter(([, n]) => n).map(([k, n]) => `<span class="${esc(k)}">${esc(n)}${esc(k)}</span>`).join('')}</div></div>`).join('') || '<div class="muted">Sin comidas definidas.</div>'}
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
  const auto = !t.rate_pct_week;
  const rate = t.rate_pct_week || a.latest?.rateTarget || [0.4, 0.7];
  const r = (l, val) => `<tr><td>${l}</td><td class="n">${val}</td></tr>`;
  return `<div class="card"><div class="ch"><h2>Objetivos</h2><button class="link" data-quick="targets">Editar</button></div>
      <table class="t">
        ${r('Ritmo de pérdida', `${fmt(rate[0])}–${fmt(rate[1])} %/sem ${auto ? '<span class="badge n">auto</span>' : ''}`)}
        ${r('Peso objetivo', t.weight_kg ? `${fmt(t.weight_kg)} kg` : '—')}
        ${r('Cintura objetivo', t.waist_cm ? `${fmt(t.waist_cm)} cm` : '—')}
        ${r('Pasos diarios', t.steps ? fmtK(t.steps) : '—')}
        ${r('Sesiones / semana', t.sessions ?? '—')}
        ${r('Sueño', t.sleep_h ? `≥ ${fmt(t.sleep_h)} h` : '—')}
      </table>
      ${auto ? '<div class="hint">El ritmo automático depende de tu % graso estimado (más delgado → más lento).</div>' : ''}
    </div>`;
}

// ---------------------------------------------------------------- bind
export function bind(root, ctx) {
  bindSeg(root, '#planSeg', (v) => { ctx.state.planTab = v; ctx.render(); });
  $('#history', root)?.addEventListener('click', () => historySheet(ctx));
  $$('#dayTabs button', root).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.v === 'new') return daySheet(ctx, -1);
    ctx.state.planDay = +b.dataset.v; ctx.render();
  }));
  $$('[data-editday]', root).forEach((b) => b.addEventListener('click', () => daySheet(ctx, +b.dataset.editday)));
  $$('[data-supp]', root).forEach((b) => b.addEventListener('click', () => suppSheet(ctx, +b.dataset.supp, b.dataset.kind)));
  $$('[data-quick]', root).forEach((b) => b.addEventListener('click', () => {
    const q = b.dataset.quick;
    if (q === 'kcal') kcalSheet(ctx);
    else if (q === 'targets') targetsSheet(ctx);
    else if (q === 'diet') dietSheet(ctx);
    else if (q === 'day') { ctx.state.planTab = 'rutina'; ctx.render(); daySheet(ctx, currentPlan(plan(ctx)).routine.days.length ? Math.min(ctx.state.planDay || 0, currentPlan(plan(ctx)).routine.days.length - 1) : -1); }
    else if (q === 'supp') { ctx.state.planTab = 'supl'; ctx.render(); }
  }));
}

const reasonField = `<div class="field"><label for="why">Motivo (opcional)</label><input class="inp" id="why" placeholder="p. ej. ritmo lento 2 semanas"></div>`;

// ---------------------------------------------------------------- kcal con previsión
function kcalSheet(ctx) {
  const v = currentPlan(plan(ctx));
  const a = ctx.analysis();
  const L = a.latest || {};
  let train = v.diet.kcal.train, rest = v.diet.kcal.rest;
  const forecast = () => {
    if (!L.tdeeReliable || !L.trend) return `<div class="forecast a"><div class="row"><span>Previsión disponible cuando haya 21 días de datos de peso.</span></div></div>`;
    const tmp = structuredClone(v); tmp.diet.kcal = { train, rest };
    const I = kcalTarget(tmp, undefined);
    const goal = v.targets?.weight_kg ?? null;
    const h = hallProjection({ W0: L.trend.level, E0: L.tdee.E, intake: I, goal, rho: a.rho });
    const lo = hallProjection({ W0: L.trend.level, E0: L.tdee.E + L.tdee.sd, intake: I, rho: a.rho });
    const hi = hallProjection({ W0: L.trend.level, E0: L.tdee.E - L.tdee.sd, intake: I, rho: a.rho });
    const pct = (-h.rateWeek / L.trend.level) * 100;
    const [t0, t1] = L.rateTarget;
    const ok = pct >= t0 && pct <= t1;
    return `<div class="forecast ${ok ? '' : 'a'}">
      <div class="row"><span>Ritmo previsto</span><b class="num">${fmt(h.rateWeek, 2)} kg/sem</b></div>
      <div class="row"><span>Rango (±1σ del gasto)</span><b class="num">${fmt(lo.rateWeek, 2)} a ${fmt(hi.rateWeek, 2)}</b></div>
      <div class="row"><span>Pérdida % peso/semana</span><b class="num">${fmt(pct, 2)} % ${ok ? '· en objetivo' : `· objetivo ${fmt(t0)}–${fmt(t1)}`}</b></div>
      ${goal ? `<div class="row"><span>${fmt(goal)} kg hacia</span><b class="num">${h.days ? fmtShort(addDays(ctx.today(), Math.round(h.days))) : 'no alcanzable'}</b></div>` : ''}
    </div>`;
  };
  const stepper = (id, label, val) => `<div class="muted small" style="font-weight:700;margin-top:10px">${label}</div>
    <div class="stepperbig" style="margin-top:6px"><button type="button" data-step="${id}" data-d="-50" aria-label="Menos 50">−</button><div class="val"><b class="num" id="${id}">${fmtK(val)}</b><span id="${id}D">sin cambio</span></div><button type="button" data-step="${id}" data-d="50" aria-label="Más 50">+</button></div>`;
  openSheet(`<h3>Ajustar kcal</h3><div class="muted">Con previsión según tu gasto medido${L.tdeeReliable ? ` (${fmtK(L.tdee.E)} ± ${fmtK(L.tdee.sd)} kcal)` : ''}.</div>
    ${stepper('kT', 'Día de entreno', train)}${stepper('kR', 'Día de descanso', rest)}
    <label class="chk" style="border:0;padding:4px 0 10px"><input type="checkbox" id="kLink" checked><div><b>Mover los dos a la vez</b></div></label>
    <div id="kFc">${forecast()}</div>
    ${reasonField}
    <button class="btn primary" id="kSave" style="margin-top:12px">Guardar nueva versión</button>`, {
    bind: (sh) => {
      const paint = () => {
        $('#kT', sh).textContent = fmtK(train); $('#kR', sh).textContent = fmtK(rest);
        const dT = train - v.diet.kcal.train, dR = rest - v.diet.kcal.rest;
        $('#kTD', sh).textContent = dT ? `${dT > 0 ? '+' : '−'}${Math.abs(dT)} kcal` : 'sin cambio';
        $('#kRD', sh).textContent = dR ? `${dR > 0 ? '+' : '−'}${Math.abs(dR)} kcal` : 'sin cambio';
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
  d.meals ||= []; d.rules ||= [];
  const mealRow = (m, i) => `<div class="row-edit" data-meal="${i}" style="grid-template-columns:1fr auto">
      <div class="stack" style="gap:6px"><input class="inp sm" data-f="slot" value="${esc(m.slot)}" placeholder="Nombre de la comida">
        <div class="g3">${['P', 'C', 'G'].map((k) => `<div class="unit-wrap"><input class="inp sm" data-f="${k}" inputmode="decimal" value="${m.portions?.[k] ?? ''}" placeholder="0"><span class="u">${k}</span></div>`).join('')}</div></div>
      <button class="mini danger" data-delmeal="${i}" aria-label="Quitar comida">${icon.trash}</button></div>`;
  openSheet(`<h3>Dieta</h3>
    <div class="stack" style="margin-top:12px">
      <div class="g2"><div class="field"><label for="dT">Kcal entreno</label><input class="inp" id="dT" inputmode="numeric" value="${d.kcal.train}"></div><div class="field"><label for="dR">Kcal descanso</label><input class="inp" id="dR" inputmode="numeric" value="${d.kcal.rest}"></div></div>
      <div class="g3"><div class="field"><label for="dP">Proteína g</label><input class="inp" id="dP" inputmode="numeric" value="${d.protein_g}"></div><div class="field"><label for="dC">Carbos g</label><input class="inp" id="dC" inputmode="numeric" value="${d.carbs_g}"></div><div class="field"><label for="dF">Grasas g</label><input class="inp" id="dF" inputmode="numeric" value="${d.fat_g}"></div></div>
      <div class="hint" id="dSum"></div>
      <div class="grp">Comidas y porciones</div>
      <div id="meals">${d.meals.map(mealRow).join('')}</div>
      <button class="btn secondary sm" id="addMeal" type="button">${icon.plus} Añadir comida</button>
      <div class="field"><label for="dRules">Reglas (una por línea)</label><textarea class="inp" id="dRules">${esc(d.rules.join('\n'))}</textarea></div>
      ${reasonField}
      <button class="btn primary" id="dSave">Guardar nueva versión</button>
    </div>`, {
    bind: (sh) => {
      const sum = () => { $('#dSum', sh).textContent = `Los macros suman ${fmtK((int($('#dP', sh).value) || 0) * 4 + (int($('#dC', sh).value) || 0) * 4 + (int($('#dF', sh).value) || 0) * 9)} kcal.`; };
      ['#dP', '#dC', '#dF'].forEach((s) => $(s, sh).addEventListener('input', sum)); sum();
      const collect = () => $$('[data-meal]', sh).map((row) => ({ slot: $('[data-f="slot"]', row).value.trim(), portions: Object.fromEntries(['P', 'C', 'G'].map((k) => [k, num($(`[data-f="${k}"]`, row).value) || 0]).filter(([, n]) => n)) })).filter((m) => m.slot);
      const redraw = (meals) => { $('#meals', sh).innerHTML = meals.map(mealRow).join(''); bindDel(); };
      const bindDel = () => $$('[data-delmeal]', sh).forEach((b) => b.addEventListener('click', () => { const m = collect(); m.splice(+b.dataset.delmeal, 1); redraw(m); }));
      bindDel();
      $('#addMeal', sh).addEventListener('click', () => redraw([...collect(), { slot: '', portions: {} }]));
      $('#dSave', sh).addEventListener('click', () => {
        const next = {
          ...d,
          kcal: { train: int($('#dT', sh).value) || d.kcal.train, rest: int($('#dR', sh).value) || d.kcal.rest },
          protein_g: int($('#dP', sh).value) ?? d.protein_g, carbs_g: int($('#dC', sh).value) ?? d.carbs_g, fat_g: int($('#dF', sh).value) ?? d.fat_g,
          meals: collect(),
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
      <div class="row" style="margin-bottom:8px"><input class="inp sm" data-f="name" value="${esc(x.name)}" placeholder="Ejercicio" style="flex:1">
        <div class="ops" style="display:flex;gap:4px"><button type="button" class="mini" data-up="${i}" aria-label="Subir">${icon.up}</button><button type="button" class="mini danger" data-del="${i}" aria-label="Quitar">${icon.trash}</button></div></div>
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px">
        <div class="unit-wrap"><input class="inp sm" data-f="sets" inputmode="numeric" value="${x.sets ?? ''}" placeholder="3"><span class="u">ser</span></div>
        <div class="unit-wrap"><input class="inp sm" data-f="lo" inputmode="numeric" value="${x.reps?.[0] ?? ''}" placeholder="8"><span class="u">de</span></div>
        <div class="unit-wrap"><input class="inp sm" data-f="hi" inputmode="numeric" value="${x.reps?.[1] ?? ''}" placeholder="10"><span class="u">a</span></div>
        <div class="unit-wrap"><input class="inp sm" data-f="rpe" inputmode="decimal" value="${x.rpe ?? ''}" placeholder="8"><span class="u">RPE</span></div>
      </div>
      <input class="inp sm" data-f="note" value="${esc(x.note || '')}" placeholder="Indicación (opcional)" style="margin-top:6px">
    </div>`;
  openSheet(`<h3>${isNew ? 'Nuevo día' : `Editar ${esc(day.name)}`}</h3>
    <div class="stack" style="margin-top:12px">
      <div class="field"><label for="dayName">Nombre del día</label><input class="inp" id="dayName" value="${esc(day.name)}"></div>
      <div id="items">${day.items.map(itemRow).join('')}</div>
      <button class="btn secondary sm" id="addItem" type="button">${icon.plus} Añadir ejercicio</button>
      ${reasonField}
      <button class="btn primary" id="daySave">Guardar nueva versión</button>
      ${isNew ? '' : `<button class="btn secondary" id="dayDel" style="color:var(--amber)">${icon.trash} Eliminar este día</button>`}
    </div>`, {
    bind: (sh) => {
      const collect = () => $$('[data-item]', sh).map((row) => {
        const g = (f) => $(`[data-f="${f}"]`, row).value;
        const lo = int(g('lo')), hi = int(g('hi'));
        return { name: g('name').trim(), sets: int(g('sets')) || 0, reps: [lo ?? hi ?? 0, hi ?? lo ?? 0], rpe: num(g('rpe')) ?? undefined, note: g('note').trim() || undefined };
      });
      const redraw = (items) => { $('#items', sh).innerHTML = items.map(itemRow).join(''); bindRows(); };
      const bindRows = () => {
        $$('[data-del]', sh).forEach((b) => b.addEventListener('click', () => { const it = collect(); it.splice(+b.dataset.del, 1); redraw(it); }));
        $$('[data-up]', sh).forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.up; if (!i) return; const it = collect(); [it[i - 1], it[i]] = [it[i], it[i - 1]]; redraw(it); }));
      };
      bindRows();
      $('#addItem', sh).addEventListener('click', () => { redraw([...collect(), { name: '', sets: 3, reps: [8, 10], rpe: 8 }]); $$('[data-item]', sh).pop()?.querySelector('[data-f="name"]').focus(); });
      $('#daySave', sh).addEventListener('click', () => {
        const next = { name: $('#dayName', sh).value.trim() || day.name, items: collect().filter((x) => x.name) };
        const ok = savePlan(ctx, (p) => { if (isNew) p.routine.days.push(next); else p.routine.days[idx] = next; }, $('#why', sh).value);
        if (ok) { if (isNew) ctx.state.planDay = v.routine.days.length; closeSheet(); ctx.render(); }
      });
      $('#dayDel', sh)?.addEventListener('click', () => {
        if (!confirm(`¿Eliminar ${day.name} del plan? Las versiones anteriores lo conservan.`)) return;
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
      $('#sDel', sh)?.addEventListener('click', () => {
        if (savePlan(ctx, (p) => { p.supplements.splice(idx, 1); }, $('#why', sh).value)) { closeSheet(); ctx.render(); }
      });
    },
  });
}

// ---------------------------------------------------------------- objetivos
function targetsSheet(ctx) {
  const v = currentPlan(plan(ctx));
  const t = v.targets || {};
  const auto = !t.rate_pct_week;
  openSheet(`<h3>Objetivos y fase</h3>
    <div class="stack" style="margin-top:12px">
      <div class="g2"><div class="field"><label for="tPhase">Fase</label><input class="inp" id="tPhase" value="${esc(v.phase || '')}" placeholder="A"></div><div class="field"><label for="tMicro">Microciclo</label><input class="inp" id="tMicro" value="${esc(v.micro || '')}" placeholder="2/6"></div></div>
      <div class="g2"><div class="field"><label for="tW">Peso objetivo (kg)</label><input class="inp" id="tW" inputmode="decimal" value="${t.weight_kg != null ? fmt(t.weight_kg) : ''}"></div><div class="field"><label for="tWaist">Cintura objetivo (cm)</label><input class="inp" id="tWaist" inputmode="decimal" value="${t.waist_cm != null ? fmt(t.waist_cm) : ''}"></div></div>
      <div class="g3"><div class="field"><label for="tSteps">Pasos</label><input class="inp" id="tSteps" inputmode="numeric" value="${t.steps != null ? fmtK(t.steps) : ''}"></div><div class="field"><label for="tSess">Sesiones</label><input class="inp" id="tSess" inputmode="numeric" value="${t.sessions ?? ''}"></div><div class="field"><label for="tSleep">Sueño (h)</label><input class="inp" id="tSleep" inputmode="decimal" value="${t.sleep_h != null ? fmt(t.sleep_h) : ''}"></div></div>
      <div class="field"><label>Ritmo de pérdida</label><div class="seg" id="tAuto"><button data-v="auto" class="${auto ? 'on' : ''}">Automático (según % graso)</button><button data-v="manual" class="${auto ? '' : 'on'}">Manual</button></div></div>
      <div class="g2" id="tManual" ${auto ? 'hidden' : ''}><div class="field"><label for="tR0">Mín. %/sem</label><input class="inp" id="tR0" inputmode="decimal" value="${t.rate_pct_week ? fmt(t.rate_pct_week[0], 2) : ''}"></div><div class="field"><label for="tR1">Máx. %/sem</label><input class="inp" id="tR1" inputmode="decimal" value="${t.rate_pct_week ? fmt(t.rate_pct_week[1], 2) : ''}"></div></div>
      ${reasonField}
      <button class="btn primary" id="tSave">Guardar nueva versión</button>
    </div>`, {
    bind: (sh) => {
      bindSeg(sh, '#tAuto', (val) => { $('#tManual', sh).hidden = val === 'auto'; });
      $('#tSave', sh).addEventListener('click', () => {
        const manual = segValue(sh, '#tAuto') === 'manual';
        const r0 = num($('#tR0', sh).value), r1 = num($('#tR1', sh).value);
        const next = {
          ...t,
          weight_kg: num($('#tW', sh).value), waist_cm: num($('#tWaist', sh).value),
          steps: int($('#tSteps', sh).value), sessions: int($('#tSess', sh).value), sleep_h: num($('#tSleep', sh).value),
          rate_pct_week: manual && r0 != null && r1 != null ? [Math.min(r0, r1), Math.max(r0, r1)] : null,
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
  openSheet(`<h3>Historial del plan</h3><div class="tl" style="margin-top:16px">
    ${vs.map((x, i) => `<div class="it ${x === cur || x.v === cur.v ? 'cur' : ''}"><div class="d">${esc(fmtShort(x.from))} · v${esc(x.v)}${x.v === cur.v ? ' · vigente' : ''}</div><b>${esc(x.reason || '—')}</b>${vs[i + 1] ? `<div class="x">${esc(diffText(vs[i + 1], x))}</div>` : ''}</div>`).join('')}
  </div>`);
}
