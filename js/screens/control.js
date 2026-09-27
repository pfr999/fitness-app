// Control semanal: medidas → fotos → cómo ha ido → resumen y decisión. Pasos saltables.

import { $, $$, esc, fmt, fmtK, num, toast, openSheet, bindSeg, icon, alertBox, signed } from '../ui/ui.js';
import { addDays, fmtShort, range, lastWeekday, weekday, daysBetween, fmtDayShort } from '../dates.js';
import { FILES, POSES, planFor } from '../model.js';
import { analyze, weekSummary } from '../engine/analysis.js';
import { MDC, isRealChange } from '../engine/body.js';
import { processPhoto, hydratePhotos, forgetPhoto } from '../photos.js';
import { buildSummary, writeSummary } from '../summary.js';

const STEPS = ['Medidas', 'Fotos', 'Cómo ha ido', 'Resumen y decisión'];

/** Inicio del periodo de control actual: el último día de control (p. ej. domingo) hasta hoy. */
function periodStart(ctx) {
  const cfg = ctx.store.get(FILES.config) || {};
  return lastWeekday(ctx.today(), cfg.checkin_weekday ?? 0);
}

/** ¿Toca control? Hoy es el día de control y aún no hay control en este periodo, o hace más de 8 días del último. */
export function isDue(ctx) {
  const today = ctx.today();
  const cfg = ctx.store.get(FILES.config) || {};
  const days = ctx.store.allDays();
  const last = Object.keys(days).filter((d) => d <= today && days[d]?.checkin).sort().pop();
  if (!last) return true; // aún no hay ningún control: el primero se puede hacer cualquier día
  if (last >= periodStart(ctx)) return false;
  if (weekday(today) === (cfg.checkin_weekday ?? 0)) return true;
  return !!last && daysBetween(last, today) > 8;
}

/** Control ya hecho en el periodo actual (se puede hacer cualquier día; cuenta hasta el siguiente día de control). */
function thisWeekCheckin(ctx) {
  const today = ctx.today(), from = periodStart(ctx);
  const days = ctx.store.allDays();
  return Object.keys(days).filter((d) => d >= from && d <= today && days[d]?.checkin).sort().pop() || null;
}

function prevCheckin(ctx, date) {
  const days = ctx.store.allDays();
  const d = Object.keys(days).filter((x) => x < date && days[x]?.checkin).sort().pop();
  return d ? { date: d, ...days[d] } : null;
}

function newDraft(ctx, date) {
  const day = ctx.store.day(date);
  const ck = day.checkin ? structuredClone(day.checkin) : {};
  return {
    date,
    weight: day.weight ?? null,
    measures: ck.measures || {},
    skinfolds: ck.skinfolds || {},
    photos: ck.photos || [],
    ratings: ck.ratings || {},
    adherence_days: ck.adherence_days || {},
    note: ck.note || '',
    decision: ck.decision || { type: 'keep', text: '' },
  };
}

// ---------------------------------------------------------------- render
export function render(ctx) {
  const st = (ctx.state.ctl ||= { step: 1, draft: null, editing: false });
  const done = thisWeekCheckin(ctx);
  if (done && !st.editing) return renderDone(ctx, done);
  if (!st.draft) st.draft = newDraft(ctx, done || ctx.today());
  const n = st.step;
  const body = n === 1 ? stepMeasures(ctx, st.draft) : n === 2 ? stepPhotos(ctx, st.draft) : n === 3 ? stepWeek(ctx, st.draft) : stepSummary(ctx, st.draft);
  return `<div class="stepper">${STEPS.map((_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</div>
    <div class="steplbl"><b>${STEPS[n - 1]}</b><span class="muted">${n} de ${STEPS.length}</span></div>
    ${body}
    <div class="navbtns">
      <button class="btn secondary" id="prev" style="width:auto;padding:0 18px;${n === 1 ? 'visibility:hidden' : ''}" aria-label="Paso anterior">${icon.back}</button>
      <button class="btn primary" id="next">${n === STEPS.length ? 'Guardar control' : 'Siguiente'}</button>
    </div>
    ${n < STEPS.length ? `<button class="link" id="skip" style="width:100%;text-align:center;margin-top:6px">Saltar este paso</button>` : ''}
    ${st.editing ? `<button class="link" id="cancelEdit" style="width:100%;text-align:center">Cancelar edición</button>` : ''}`;
}

export function bind(root, ctx) {
  const st = ctx.state.ctl;
  if (!st.draft || (thisWeekCheckin(ctx) && !st.editing)) return bindDone(root, ctx);
  const d = st.draft;
  const move = (k) => { st.step = Math.max(1, Math.min(STEPS.length, st.step + k)); ctx.render(); window.scrollTo({ top: 0 }); };
  $('#prev', root).addEventListener('click', () => move(-1));
  $('#skip', root)?.addEventListener('click', () => move(1));
  $('#cancelEdit', root)?.addEventListener('click', () => { ctx.state.ctl = null; ctx.render(); });
  $('#next', root).addEventListener('click', () => (st.step === STEPS.length ? save(ctx) : move(1)));

  // Campos numéricos → borrador
  $$('[data-m]', root).forEach((inp) => inp.addEventListener('input', () => {
    const [grp, id] = inp.dataset.m.split('.');
    const v = num(inp.value);
    if (grp === 'weight') d.weight = v;
    else if (v == null) delete d[grp][id]; else d[grp][id] = v;
    const sum = $('#sumSf', root);
    if (sum) sum.textContent = fmt(Object.values(d.skinfolds).reduce((a, b) => a + b, 0)) + ' mm';
  }));
  $$('[data-rating]', root).forEach((s) => bindSeg(s.parentElement, `[data-rating="${s.dataset.rating}"]`, (v) => { d.ratings[s.dataset.rating] = +v; }));
  $$('[data-adh]', root).forEach((s) => bindSeg(s.parentElement, `[data-adh="${s.dataset.adh}"]`, (v) => { d.adherence_days[s.dataset.adh] = v === 'plan'; }));
  $('#note', root)?.addEventListener('input', (e) => { d.note = e.target.value; });
  bindSeg(root, '#decision', (v) => { d.decision.type = v; });
  $('#decisionText', root)?.addEventListener('input', (e) => { d.decision.text = e.target.value; });

  // Fotos
  $$('input[type=file][data-pose]', root).forEach((inp) => inp.addEventListener('change', async () => {
    const file = inp.files?.[0];
    if (!file) return;
    const pose = inp.dataset.pose;
    const label = inp.closest('.shot').querySelector('.lbl2');
    if (label) label.textContent = 'Subiendo…';
    try {
      const bytes = await processPhoto(file);
      const path = FILES.photo(d.date, pose);
      forgetPhoto(path);
      await ctx.store.putPhoto(path, bytes, `Foto ${POSES.find((p) => p.id === pose)?.label.toLowerCase()} ${fmtShort(d.date)}`);
      if (!d.photos.includes(pose)) d.photos.push(pose);
      toast('Foto guardada');
    } catch (e) {
      toast('No se pudo subir la foto');
      console.error(e);
    }
    ctx.render();
  }));
  hydratePhotos(root, ctx.store);
}

// ---------------------------------------------------------------- pasos
function stepMeasures(ctx, d) {
  const cfg = ctx.store.get(FILES.config) || {};
  const metrics = cfg.metrics || [];
  const prev = prevCheckin(ctx, d.date);
  const field = (m, grp) => {
    const val = d[grp][m.id];
    const p = prev?.checkin?.[grp]?.[m.id];
    const delta = val != null && p != null ? val - p : null;
    return `<div class="mfield"><label for="m-${esc(m.id)}">${esc(m.label)}</label>
      <input id="m-${esc(m.id)}" inputmode="decimal" data-m="${grp}.${esc(m.id)}" value="${val != null ? fmt(val) : ''}" placeholder="${p != null ? fmt(p) : '—'}">
      <div class="d">${p != null ? `ant. ${fmt(p)}${delta != null ? ` · <span class="${delta < 0 ? 'up' : delta > 0 ? 'warn' : ''}">${signed(delta)}</span>` : ''}` : esc(m.unit)}</div></div>`;
  };
  const per = metrics.filter((m) => m.group === 'perimeter');
  const sf = metrics.filter((m) => m.group === 'skinfold');
  const dev = metrics.filter((m) => m.group === 'device');
  const sum = Object.values(d.skinfolds).reduce((a, b) => a + b, 0);
  return `<div class="card">
      <div class="mfield" style="margin-bottom:12px"><label for="m-w">Peso (kg)</label><input id="m-w" inputmode="decimal" data-m="weight.w" value="${d.weight != null ? fmt(d.weight) : ''}" placeholder="—"><div class="d">Se guarda también como el peso del día</div></div>
      <div class="meas">${per.map((m) => field(m, 'measures')).join('')}</div>
      ${sf.length ? `<details style="margin-top:14px" ${Object.keys(d.skinfolds).length ? 'open' : ''}><summary class="link" style="list-style:none;cursor:pointer">+ Pliegues (plicómetro, mm)</summary>
        <div class="meas" style="margin-top:10px">${sf.map((m) => field(m, 'skinfolds')).join('')}</div>
        <div class="tip" style="margin-top:10px"><span>Suma: <b id="sumSf">${fmt(sum)} mm</b> · cambio mínimo detectable ≈ ${fmt(MDC.sumSkinfolds, 0)} mm</span></div></details>` : ''}
      ${dev.length ? `<div class="meas" style="margin-top:12px">${dev.map((m) => field(m, 'measures')).join('')}</div>` : ''}
    </div>
    <div class="muted small" style="padding:0 4px">Por la mañana, en ayunas. Cintura a la altura del ombligo al final de una espiración normal. Mismo lado, misma cinta.</div>`;
}

function stepPhotos(ctx, d) {
  const prev = prevCheckinWithPhotos(ctx, d.date);
  return `<div class="photos">${POSES.map((p) => {
    const has = d.photos.includes(p.id);
    const prevHas = prev?.checkin?.photos?.includes(p.id);
    return `<div class="shot ${has ? 'done' : ''}">
      ${has ? `<img class="photo-img" data-photo="${FILES.photo(d.date, p.id)}" alt="${p.label}" hidden>` : ''}
      ${prevHas && !has ? `<div class="thumb"><img data-photo="${FILES.photo(prev.date, p.id)}" alt="Anterior" hidden></div>` : ''}
      ${has ? `<span class="ok">✓ ${p.label}</span>` : `<span class="cam">${icon.camera}</span><span class="lbl2">${p.label}</span>`}
      <input type="file" accept="image/*" capture="environment" data-pose="${p.id}" aria-label="Foto ${p.label}">
    </div>`;
  }).join('')}</div>
  <div class="card flat" style="margin-top:12px"><div class="small" style="font-weight:600;color:var(--ink-2)">${prev ? `La miniatura es tu foto del ${fmtShort(prev.date)}: repite encuadre y postura. ` : ''}Misma luz y hora, móvil a la altura del ombligo a 2–3 m. Toca una foto hecha para repetirla.</div></div>`;
}

function prevCheckinWithPhotos(ctx, date) {
  const days = ctx.store.allDays();
  const d = Object.keys(days).filter((x) => x < date && days[x]?.checkin?.photos?.length).sort().pop();
  return d ? { date: d, ...days[d] } : null;
}

function stepWeek(ctx, d) {
  const from = addDays(d.date, -6);
  const days = ctx.store.allDays();
  const unlogged = range(from, d.date).filter((x) => days[x]?.meals_complete !== true);
  const rating = (id, label, opts) => `<div class="field"><label>${label}</label><div class="chipset" data-rating="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${d.ratings[id] === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
  return `<div class="card">
      <div class="ch"><h2>Adherencia a la dieta</h2><span class="aux">días sin registro</span></div>
      <div class="muted small" style="margin:-4px 0 8px">Esos días se asumió el plan para el cálculo del gasto. Marca los que te saliste; se excluyen.</div>
      ${unlogged.map((x) => { const v = d.adherence_days[x]; return `<div class="meal"><span>${esc(fmtDayShort(x))}</span><div class="seg" data-adh="${x}" style="width:200px"><button data-v="plan" class="${v !== false ? 'on' : ''}">Según plan</button><button data-v="off" class="${v === false ? 'on' : ''}">Me salí</button></div></div>`; }).join('')}
    </div>
    <div class="card"><div class="stack">
      ${rating('diet', 'Adherencia a la dieta', [[1, 'Mal'], [2, 'Regular'], [3, 'Bien'], [4, 'Perfecta']])}
      ${rating('training', 'Adherencia al entreno', [[1, 'Mal'], [2, 'Regular'], [3, 'Bien'], [4, 'Perfecta']])}
      ${rating('sleep', 'Calidad del sueño', [[1, 'Baja'], [2, 'Media'], [3, 'Alta']])}
      ${rating('stress', 'Estrés', [[1, 'Bajo'], [2, 'Medio'], [3, 'Alto']])}
      ${rating('energy', 'Energía', [[1, 'Baja'], [2, 'Media'], [3, 'Alta']])}
    </div></div>
    <div class="card"><div class="ch"><h2>Nota de la semana</h2></div>
      <textarea class="inp" id="note" placeholder="Sensaciones, incidencias, lesiones, lo que quieras recordar…">${esc(d.note)}</textarea></div>`;
}

function previewAnalysis(ctx, d) {
  const data = ctx.data();
  const days = { ...data.days };
  const day = { ...(days[d.date] || {}) };
  if (d.weight != null) day.weight = d.weight;
  day.checkin = { measures: d.measures, skinfolds: d.skinfolds, photos: d.photos, ratings: d.ratings, adherence_days: d.adherence_days, note: d.note, decision: d.decision };
  days[d.date] = day;
  return { a: analyze({ ...data, days }, { today: ctx.today() }), days };
}

function stepSummary(ctx, d) {
  const { a, days } = previewAnalysis(ctx, d);
  const L = a.latest || {};
  const prev = prevCheckin(ctx, d.date);
  const pm = prev?.checkin?.measures || {};
  const dw = d.measures.waist != null && pm.waist != null ? d.measures.waist - pm.waist : null;
  const sumNow = Object.keys(d.skinfolds).length ? Object.values(d.skinfolds).reduce((x, y) => x + y, 0) : null;
  const sumPrev = prev?.checkin?.skinfolds && Object.keys(prev.checkin.skinfolds).length ? Object.values(prev.checkin.skinfolds).reduce((x, y) => x + y, 0) : null;
  const ds = sumNow != null && sumPrev != null ? sumNow - sumPrev : null;
  const loss = L.rate ? -L.rate.pctWeek : null;
  const tgt = L.rateTarget || [0.4, 0.7];
  const inTarget = loss != null && loss >= tgt[0] && loss <= tgt[1];
  const note = loss == null ? 'Aún no hay datos de peso suficientes.' : !L.rateReliable ? 'Con menos de 14 días de datos el ritmo es orientativo.' : inTarget ? `Dentro del objetivo ${fmt(tgt[0])}–${fmt(tgt[1])} %.` : loss < tgt[0] ? `Por debajo del objetivo ${fmt(tgt[0])}–${fmt(tgt[1])} %.` : `Por encima de ${fmt(tgt[1])} %: riesgo para la masa magra.`;
  const wk = weekSummary({ days, plan: ctx.store.get(FILES.plan) }, d.date);
  const t = wk.targets;

  const extra = [];
  if (dw != null) extra.push(isRealChange(dw, MDC.waist)
    ? { tone: dw < 0 ? 'good' : 'warn', title: `Cintura ${signed(dw)} cm`, text: 'Cambio por encima del margen de error de la medida.' }
    : { tone: 'info', title: `Cintura ${signed(dw)} cm: dentro del margen de error`, text: `Cambio mínimo detectable ≈ ${fmt(MDC.waist)} cm. Mira la tendencia de varias semanas.` });
  if (ds != null) extra.push(isRealChange(ds, MDC.sumSkinfolds)
    ? { tone: ds < 0 ? 'good' : 'warn', title: `Pliegues ${signed(ds)} mm`, text: 'Cambio por encima del margen de error.' }
    : { tone: 'info', title: `Pliegues ${signed(ds)} mm: dentro del margen`, text: `Cambio mínimo detectable ≈ ${fmt(MDC.sumSkinfolds, 0)} mm.` });
  const alerts = [...(a.alerts || []), ...extra];

  const row = (l, real, obj, good) => `<tr><td>${l}</td><td class="n ${good == null ? '' : good ? 'up' : 'warn'}">${real}</td><td class="o">${obj}</td></tr>`;
  return `<div class="sum-hero">
      <div class="k">Últimos 7 días · ${fmtShort(wk.from)}–${fmtShort(wk.to)}</div>
      <div class="big num">${loss != null ? `${fmt(-loss, 2)} %/sem` : '—'}</div>
      <div class="small" style="opacity:.75;margin-bottom:12px">${note}</div>
      <div class="g2">
        <div><span>Tendencia</span><b class="num">${L.trend ? fmt(L.trend.level) + ' kg' : '—'}</b></div>
        <div><span>Gasto estimado</span><b class="num">${L.tdeeReliable ? fmtK(L.tdee.E) + ' kcal' : 'en 21 días'}</b></div>
        <div><span>Cintura</span><b class="num">${d.measures.waist != null ? fmt(d.measures.waist) : '—'}${dw != null ? ` · ${signed(dw)}` : ''}</b></div>
        <div><span>Σ pliegues</span><b class="num">${sumNow != null ? fmt(sumNow) : '—'}${ds != null ? ` · ${signed(ds)}` : ''}</b></div>
      </div>
    </div>
    ${alerts.length ? `<div class="card"><div class="ch"><h2>Qué dice la semana</h2></div>${alerts.map(alertBox).join('')}</div>` : ''}
    <div class="card"><div class="ch"><h2>Semana vs objetivos</h2></div>
      <table class="t"><tr><th>Indicador</th><th style="text-align:right">Real</th><th style="text-align:right">Obj.</th></tr>
        ${row('Ritmo de pérdida', loss != null ? fmt(loss, 2) + ' %' : '—', `${fmt(tgt[0])}–${fmt(tgt[1])}`, loss != null && L.rateReliable ? inTarget : null)}
        ${row('Pasos / día', wk.steps != null ? fmtK(wk.steps) : '—', t.steps ? fmtK(t.steps) : '—', wk.steps != null && t.steps ? wk.steps >= t.steps * 0.9 : null)}
        ${row('Sesiones', `${wk.sessions}`, t.sessions ?? '—', t.sessions ? wk.sessions >= t.sessions : null)}
        ${row('Sueño', wk.sleep != null ? fmt(wk.sleep) + ' h' : '—', t.sleep_h ? fmt(t.sleep_h) : '—', wk.sleep != null && t.sleep_h ? wk.sleep >= t.sleep_h - 0.3 : null)}
        ${row('Pesadas', `${wk.weighIns}/7`, '≥ 4', wk.weighIns >= 4)}
      </table></div>
    <div class="card"><div class="ch"><h2>Tu decisión</h2></div>
      <div class="seg" id="decision" style="margin-bottom:10px">${[['keep', 'Mantener'], ['adjust', 'Ajustar plan'], ['phase', 'Nueva fase']].map(([v, l]) => `<button data-v="${v}" class="${d.decision.type === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <textarea class="inp" id="decisionText" placeholder="Qué decides y por qué (queda en el historial)">${esc(d.decision.text)}</textarea>
      <div class="hint">Si ajustas, después de guardar te llevo al Plan para hacer el cambio.</div>
    </div>`;
}

// ---------------------------------------------------------------- guardar
async function save(ctx) {
  const st = ctx.state.ctl;
  const d = st.draft;
  const checkin = { measures: d.measures, skinfolds: d.skinfolds, photos: d.photos, ratings: d.ratings, adherence_days: d.adherence_days, note: d.note.trim() || undefined, decision: { type: d.decision.type, text: d.decision.text.trim() || undefined } };
  ctx.store.updateDay(d.date, (day) => {
    if (d.weight != null) day.weight = d.weight;
    day.checkin = structuredClone(checkin);
  }, `Control semanal ${fmtShort(d.date)}`);
  const goPlan = d.decision.type !== 'keep';
  ctx.state.ctl = null;
  toast('Control guardado');
  writeSummary(ctx);
  ctx.go(goPlan ? 'plan' : 'domingo');
}

// ---------------------------------------------------------------- hecho
function renderDone(ctx, date) {
  const day = ctx.store.day(date);
  const c = day.checkin;
  const m = c.measures || {};
  return `<div class="card">
      <div class="row"><div><div class="muted small" style="font-weight:700">Control de esta semana</div><div style="font-size:20px;font-weight:800">${esc(fmtShort(date))} ✓</div></div>
      <button class="btn secondary sm" id="edit">${icon.edit} Editar</button></div>
      <div class="sep"></div>
      <table class="t">
        ${day.weight != null ? `<tr><td>Peso</td><td class="n">${fmt(day.weight)} kg</td></tr>` : ''}
        ${Object.entries(m).map(([k, v]) => `<tr><td>${esc(labelOf(ctx, k))}</td><td class="n">${fmt(v)}</td></tr>`).join('')}
        ${c.photos?.length ? `<tr><td>Fotos</td><td class="n">${c.photos.length}</td></tr>` : ''}
        ${c.decision?.text ? `<tr><td>Decisión</td><td class="n" style="font-weight:600">${esc(c.decision.text)}</td></tr>` : ''}
      </table>
    </div>
    <button class="btn primary" id="copy">${icon.copy} Copiar resumen para Claude</button>
    <div class="hint" style="text-align:center">También queda en <b>resumen.md</b> de tu repo de datos.</div>`;
}

function labelOf(ctx, id) {
  return (ctx.store.get(FILES.config)?.metrics || []).find((m) => m.id === id)?.label || id;
}

function bindDone(root, ctx) {
  $('#edit', root)?.addEventListener('click', () => { ctx.state.ctl = { step: 1, draft: newDraft(ctx, thisWeekCheckin(ctx)), editing: true }; ctx.render(); });
  $('#copy', root)?.addEventListener('click', () => copySummary(ctx));
}

export async function copySummary(ctx) {
  const text = buildSummary(ctx);
  try {
    await navigator.clipboard.writeText(text);
    toast('Resumen copiado');
  } catch {
    openSheet(`<h3>Resumen para Claude</h3><div class="muted">Mantén pulsado para copiar.</div><pre class="claude">${esc(text)}</pre>`);
  }
}
