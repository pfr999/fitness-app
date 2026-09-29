// Control semanal: medidas → fotos → cómo ha ido → resumen y decisión. Pasos saltables.

import { $, $$, esc, fmt, fmtK, num, int, toast, openSheet, bindSeg, icon, alertBox, signed, ask } from '../ui/ui.js';
import { addDays, fmtShort, range, lastWeekday, nextWeekday, nearestWeekday, weekday, daysBetween, fmtDayShort } from '../dates.js';
import { FILES, POSES, planFor, checkinPhotoPath, dietStatus } from '../model.js';
import { analyze, weekSummary } from '../engine/analysis.js';
import { MDC, isRealChange } from '../engine/body.js';
import { processPhoto, hydratePhotos, forgetPhoto } from '../photos.js';
import { buildSummary, writeSummary } from '../summary.js';
import { rpRecommendation } from '../engine/targets.js';
import { musclesTrained } from '../engine/training.js';
import { MUSCLES, MUSCLE_LABEL } from '../training/catalog.js';
import { exercisesOf } from './exercises.js';
import { renderLanding, bindLanding, renderDays, bindDays, renderBalance, balanceFor } from './semana.js';

const STEPS = ['Revisar los días', 'Medidas', 'Fotos', 'Cómo ha ido', 'Entreno', 'Balance y decisión'];

/** Inicio del periodo de control actual: el último día de control (p. ej. domingo) hasta hoy. */
// Un control pertenece a la semana que termina en el día de control (domingo) más cercano a su
// fecha: hecho el lunes, cierra la semana que acabó el domingo; hecho el sábado, la que acaba mañana.
const wdOf = (ctx) => ctx.store.get(FILES.config)?.checkin_weekday ?? 0;
export const weekEndOf = (ctx, date) => nearestWeekday(date, wdOf(ctx));

/** Semana que toca cerrar ahora: de lunes a miércoles, la que acaba de terminar; después, la que acaba el próximo día de control. */
export function currentControlWeek(ctx) {
  const today = ctx.today(), wd = wdOf(ctx);
  const last = lastWeekday(today, wd);
  return daysBetween(last, today) <= 3 ? last : nextWeekday(today, wd);
}

/** Control (fecha) de la semana que termina en `weekEnd`, si existe. */
export function checkinOfWeek(ctx, weekEnd) {
  const days = ctx.store.allDays();
  return Object.keys(days).filter((d) => days[d]?.checkin && weekEndOf(ctx, d) === weekEnd).sort().pop() || null;
}

/** ¿Toca control? Sin control para la semana actual y ya es su día de control (o se ha pasado). El primero, cualquier día. */
export function isDue(ctx) {
  const days = ctx.store.allDays();
  if (!Object.keys(days).some((d) => days[d]?.checkin)) return true;
  const W = currentControlWeek(ctx);
  return !checkinOfWeek(ctx, W) && ctx.today() >= W;
}

function thisWeekCheckin(ctx) {
  return checkinOfWeek(ctx, currentControlWeek(ctx));
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
    weekEnd: day.checkin ? weekEndOf(ctx, date) : currentControlWeek(ctx),
    origDate: day.checkin ? date : null,
    photoDate: ck.photos_from || date,
    weight: day.weight ?? null,
    measures: ck.measures || {},
    skinfolds: ck.skinfolds || {},
    photos: ck.photos || [],
    ratings: ck.ratings || {},
    adherence: ck.adherence || { status: 'plan', kcal_week: null },
    autoreg: ck.autoreg || {},
    note: ck.note || '',
    decision: ck.decision || { type: 'keep', text: '' },
  };
}

// ---------------------------------------------------------------- render
/** Abre el recorrido del control (nuevo o editando uno existente). */
export function startControl(ctx, date, editing = false, quick = false) {
  const first = quick ? QUICK[0] : 1;
  ctx.state.ctl = { active: true, step: first, draft: newDraft(ctx, date), editing, quick };
  ctx.nav({ tab: 'domingo', ctlStep: first });
}
/** Control rápido (semana sin incidencias): medidas, fotos y balance con la decisión. */
const QUICK = [2, 3, 6];
const seqOf = (st) => (st?.quick ? QUICK : [1, 2, 3, 4, 5, 6]);

/** Semana sin incidencias: todos los días hasta hoy validados (y ninguno «no lo sé»). */
function weekIsClean(ctx, weekEnd) {
  const to = weekEnd < ctx.today() ? weekEnd : ctx.today();
  for (let d = addDays(weekEnd, -6); d <= to; d = addDays(d, 1)) {
    const ds = dietStatus(ctx.store.day(d));
    if (!ds || ds.status === 'unknown') return false;
  }
  return true;
}

export function render(ctx) {
  const st = ctx.state.ctl;
  if (!st?.active) return renderLanding(ctx, { done: controlCard(ctx), history: historyList(ctx, thisWeekCheckin(ctx)) });
  const seq = seqOf(st);
  if (!seq.includes(st.step)) st.step = seq[0];
  const n = st.step, pos = seq.indexOf(n), last = pos === seq.length - 1;
  const d = st.draft;
  const body = n === 1 ? stepDays(ctx, d) : n === 2 ? stepMeasures(ctx, d) : n === 3 ? stepPhotos(ctx, d) : n === 4 ? stepWeek(ctx, d) : n === 5 ? stepTraining(ctx, d) : stepSummary(ctx, d);
  return `<div class="stepper">${seq.map((_, i) => `<i class="${i <= pos ? 'on' : ''}"></i>`).join('')}</div>
    <div class="steplbl"><b>${STEPS[n - 1]}</b><span class="muted">${st.quick ? 'Rápido · ' : ''}${pos + 1} de ${seq.length}</span></div>
    ${body}
    <div class="navbtns">
      <button class="btn secondary" id="prev" style="width:auto;padding:0 18px;${pos === 0 ? 'visibility:hidden' : ''}" aria-label="Paso anterior">${icon.back}</button>
      <button class="btn primary" id="next">${last ? 'Guardar control' : 'Siguiente'}</button>
    </div>
    ${!last ? `<button class="link" id="skip" style="width:100%;text-align:center;margin-top:6px">Saltar este paso</button>` : ''}
    ${st.quick ? '<button class="link" id="toFull" style="width:100%;text-align:center">Hacer el control completo (6 pasos)</button>' : ''}
    <button class="link" id="cancelEdit" style="width:100%;text-align:center">Salir del control sin guardar</button>
    ${st.draft.origDate ? `<button class="link" id="delCk" style="width:100%;text-align:center;color:var(--amber)">Borrar este control</button>` : ''}`;
}

export function bind(root, ctx) {
  const st = ctx.state.ctl;
  if (!st?.active) { bindLanding(root, ctx); return bindDone(root, ctx); }
  const d = st.draft;
  if (st.step === 1) bindDays(root, ctx, addDays(d.weekEnd, -6), d.weekEnd, () => { ctx._analysis = null; ctx.render(); });
  const seq = seqOf(st);
  const move = (k) => ctx.nav({ ctlStep: seq[Math.max(0, Math.min(seq.length - 1, seq.indexOf(st.step) + k))] });
  $('#toFull', root)?.addEventListener('click', () => { st.quick = false; ctx.nav({ ctlStep: 1 }); });
  $('#prev', root).addEventListener('click', () => move(-1));
  $('#skip', root)?.addEventListener('click', () => move(1));
  $('#cancelEdit', root)?.addEventListener('click', async () => {
    if (!(await ask({ title: '¿Salir del control?', text: 'Lo revisado de cada día ya está guardado; las medidas, valoraciones y la decisión de este control, no.', ok: 'Salir sin guardar', danger: true }))) return;
    ctx.state.ctl = null; ctx.render();
  });
  $('#next', root).addEventListener('click', () => (st.step === seq[seq.length - 1] ? save(ctx) : move(1)));
  bindHistory(root, ctx);

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
  const setKcal = () => {
    const n = int($('#adhVal', root)?.value);
    d.adherence.kcal_week = n == null ? null : Math.abs(n) * (d.adherence.status === 'under' ? -1 : 1);
  };
  bindSeg(root, '#adh', (v) => {
    d.adherence.status = v;
    const box = $('#adhKcal', root);
    box.hidden = !(v === 'over' || v === 'under');
    if (box.hidden) d.adherence.kcal_week = null; else setKcal();
  });
  $('#adhVal', root)?.addEventListener('input', setKcal);
  $$('[data-artoggle]', root).forEach((b) => b.addEventListener('click', () => b.closest('.ar').classList.toggle('open')));
  $$('[data-ar]', root).forEach((s) => s.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const [m, k] = s.dataset.ar.split('.');
    d.autoreg[m] = { soreness: 2, performance: 2, ...(d.autoreg[m] || {}), [k]: +b.dataset.v };
    $$('button', s).forEach((x) => x.classList.toggle('on', x === b));
    const r = rpRecommendation(d.autoreg[m].soreness, d.autoreg[m].performance);
    $(`[data-arval="${m}"]`, root).textContent = `${d.autoreg[m].soreness} · ${d.autoreg[m].performance}`;
    const tag = $(`[data-arrec="${m}"]`, root);
    tag.textContent = r.label; tag.className = `badge ${r.tone === 'good' ? 'g' : r.tone === 'warn' ? 'a' : 'n'}`;
  }));
  $('#note', root)?.addEventListener('input', (e) => { d.note = e.target.value; });
  $('#m-date', root)?.addEventListener('change', (e) => {
    const v = e.target.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v > ctx.today()) { e.target.value = d.date; return; }
    d.date = v;
    // el peso es el de ese día: se carga el registrado (si lo hay) para no pisarlo con el de la fecha anterior
    d.weight = ctx.store.day(v).weight ?? null;
    ctx.render();
  });
  $('#delCk', root)?.addEventListener('click', async () => {
    if (!d.origDate || !(await ask({ title: `¿Borrar el control del ${fmtShort(d.origDate)}?`, text: 'Se borran sus medidas, valoraciones y decisión. Las fotos siguen en el historial del repo.', ok: 'Borrar', danger: true }))) return;
    ctx.store.updateDay(d.origDate, (day) => { delete day.checkin; }, `Borra control ${fmtShort(d.origDate)}`);
    ctx.state.ctl = null;
    toast('Control borrado');
    ctx.render();
  });
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
      const path = FILES.photo(d.photoDate, pose);
      forgetPhoto(path);
      const up = await ctx.store.putPhoto(path, bytes, `Foto ${POSES.find((p) => p.id === pose)?.label.toLowerCase()} ${fmtShort(d.date)}`);
      if (!d.photos.includes(pose)) d.photos.push(pose);
      toast(up ? 'Foto guardada' : 'Sin conexión: foto guardada en el móvil, se subirá sola');
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
      <div class="g2" style="margin-bottom:12px">
        <div class="mfield"><label for="m-date">Fecha del control</label><input id="m-date" type="date" max="${ctx.today()}" value="${d.date}" style="font-size:17px"><div class="d">Puedes cambiarla al corregir</div></div>
        <div class="mfield"><label for="m-w">Peso (kg)</label><input id="m-w" inputmode="decimal" data-m="weight.w" value="${d.weight != null ? fmt(d.weight) : ''}" placeholder="—"><div class="d">Peso de ese día</div></div>
      </div>
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
      ${has ? `<img class="photo-img" data-photo="${FILES.photo(d.photoDate, p.id)}" alt="${p.label}" hidden>` : ''}
      ${prevHas && !has ? `<div class="thumb"><img data-photo="${checkinPhotoPath(prev.date, prev.checkin, p.id)}" alt="Anterior" hidden></div>` : ''}
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

const dias = (n) => `${n} ${n === 1 ? 'día' : 'días'}`;

function stepWeek(ctx, d) {
  const days = ctx.store.allDays();
  const win = range(addDays(d.weekEnd, -6), d.weekEnd);
  const logged = win.filter((x) => days[x]?.meals_complete === true);
  const unlogged = win.length - logged.length;
  const a = d.adherence;
  const opt = (v, l) => `<button type="button" data-v="${v}" class="${a.status === v ? 'on' : ''}">${l}</button>`;
  const rating = (id, label, opts) => `<div class="field"><label>${label}</label><div class="chipset" data-rating="${id}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${d.ratings[id] === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
  return `<div class="card" hidden>
      <div class="ch"><h2>¿Cómo fue la semana respecto al plan?</h2></div>
      <div class="muted small" style="margin:-4px 0 10px">${logged.length ? `${dias(logged.length)} con comidas registradas: cuentan con lo registrado. ` : ''}${unlogged ? `Esta respuesta se aplica a ${logged.length ? 'los otros ' : 'los '}${dias(unlogged)} sin registrar comidas.` : 'Todos los días tienen las comidas registradas.'}</div>
      ${unlogged ? `<div class="chipset" id="adh">${opt('plan', 'Según plan')}${opt('over', 'Me pasé')}${opt('under', 'Me quedé corto')}${opt('unknown', 'No lo sé')}</div>
      <div id="adhKcal" ${a.status === 'over' || a.status === 'under' ? '' : 'hidden'} style="margin-top:12px">
        <div class="field"><label for="adhVal">¿Cuánto aproximadamente, en toda la semana? (opcional)</label>
          <div class="unit-wrap"><input class="inp" id="adhVal" inputmode="numeric" value="${a.kcal_week != null ? fmtK(Math.abs(a.kcal_week)) : ''}" placeholder="p. ej. 1.500"><span class="u">kcal</span></div></div>
        <div class="hint">Ejemplo: dos cenas fuera de unas 700 kcal de más → 1.400. Si no lo sabes, déjalo vacío: esos días no se usarán para calcular tu gasto.</div>
      </div>` : ''}
    </div>
    <div class="card"><div class="stack">
      ${rating('training', 'Valoración general del entreno', [[1, 'Mal'], [2, 'Regular'], [3, 'Bien'], [4, 'Perfecta']])}
      ${rating('sleep', 'Calidad del sueño', [[1, 'Baja'], [2, 'Media'], [3, 'Alta']])}
      ${rating('stress', 'Estrés', [[1, 'Bajo'], [2, 'Medio'], [3, 'Alto']])}
      ${rating('energy', 'Energía', [[1, 'Baja'], [2, 'Media'], [3, 'Alta']])}
    </div></div>
    <div class="card"><div class="ch"><h2>Nota de la semana</h2></div>
      <textarea class="inp" id="note" placeholder="Sensaciones, incidencias, lesiones, lo que quieras recordar…">${esc(d.note)}</textarea></div>`;
}

function stepDays(ctx, d) {
  return `<div class="muted small" style="margin:-6px 0 12px;padding:0 4px">Semana del ${esc(fmtShort(addDays(d.weekEnd, -6)))} al ${esc(fmtShort(d.weekEnd))}. Revisa cada día: peso, pasos, entreno y cómo comiste. Es lo que alimenta el balance y el cálculo de tu gasto.</div>
    ${renderDays(ctx, addDays(d.weekEnd, -6), d.weekEnd)}`;
}

function stepTraining(ctx, d) {
  const v = planFor(ctx.store.get(FILES.plan), d.date);
  const muscles = musclesTrained(ctx.store.allDays(), d.date, exercisesOf(ctx), v?.routine).filter((m) => MUSCLE_LABEL[m]);
  if (!muscles.length) return `<div class="card empty"><b>Sin entreno que valorar</b>Cuando tengas rutina o series apuntadas, aquí ajustarás las series de cada músculo.</div>`;
  const order = MUSCLES.map(([k]) => k).filter((k) => muscles.includes(k));
  const scale = (m, k, val, labels) => `<div class="scale" data-ar="${m}.${k}">${[1, 2, 3, 4].map((n) => `<button type="button" data-v="${n}" class="${val === n ? 'on' : ''}" title="${labels[n - 1]}">${n}</button>`).join('')}</div>`;
  return `<div class="card">
      <div class="ch"><h2>Autorregulación</h2><span class="method">Método RP</span></div>
      <div class="muted small" style="margin:-4px 0 12px">Todo empieza en <b>2 · 2</b> (normal). Toca un músculo solo si algo se salió de lo normal.<br>
        <b>Agujetas</b>: 1 nada · 2 se curaron de sobra · 3 justo a tiempo · 4 aún doloridas.<br>
        <b>Rendimiento</b>: 1 superé lo previsto · 2 cumplí · 3 me costó · 4 no igualé la semana anterior.</div>
      ${order.map((m) => { const a = { soreness: 2, performance: 2, ...(d.autoreg[m] || {}) }; const r = rpRecommendation(a.soreness, a.performance);
        const changed = a.soreness !== 2 || a.performance !== 2;
        return `<div class="ar ${changed ? 'open' : ''}"><button type="button" class="hd" data-artoggle style="width:100%;border:0;background:none;padding:0;color:inherit;font:inherit;text-align:left"><b>${esc(MUSCLE_LABEL[m])}</b><span style="display:flex;gap:8px;align-items:center"><span class="muted small num" data-arval="${m}">${a.soreness} · ${a.performance}</span><span class="badge ${r.tone === 'good' ? 'g' : r.tone === 'warn' ? 'a' : 'n'}" data-arrec="${m}">${r.label}</span></span></button>
          <div class="lines"><span>Agujetas</span>${scale(m, 'soreness', a.soreness, ['nada', 'curadas de sobra', 'justo a tiempo', 'aún doloridas'])}<span>Rendimiento</span>${scale(m, 'performance', a.performance, ['superé', 'cumplí', 'me costó', 'no igualé'])}</div></div>`; }).join('')}
    </div>`;
}

function previewAnalysis(ctx, d) {
  const data = ctx.data();
  const days = { ...data.days };
  const day = { ...(days[d.date] || {}) };
  if (d.weight != null) day.weight = d.weight;
  day.checkin = { measures: d.measures, skinfolds: d.skinfolds, photos: d.photos, ratings: d.ratings, adherence: d.adherence, note: d.note, decision: d.decision };
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
  // cifras de la semana revisada (las mismas que el balance), no la tendencia de hoy
  const wb = balanceFor(ctx, addDays(d.weekEnd, -6), d.weekEnd);
  const loss = wb.weight.pctWeek != null ? -wb.weight.pctWeek : L.rate ? -L.rate.pctWeek : null;
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
      <div class="k">Semana del ${fmtShort(addDays(d.weekEnd, -6))} al ${fmtShort(d.weekEnd)}</div>
      <div class="big num">${wb.weight.change != null ? `${signed(wb.weight.change)} kg` : '—'}${loss != null ? ` <span style="font-size:20px;opacity:.8">· ${fmt(-loss, 2)} %/sem</span>` : ''}</div>
      <div class="small" style="opacity:.75;margin-bottom:12px">${note}</div>
      <div class="g2">
        <div><span>Tendencia</span><b class="num">${L.trend ? fmt(L.trend.level) + ' kg' : '—'}</b></div>
        <div><span>Gasto estimado</span><b class="num">${L.tdeeReliable ? fmtK(L.tdee.E) + ' kcal' : 'en 21 días'}</b></div>
        <div><span>Cintura</span><b class="num">${d.measures.waist != null ? fmt(d.measures.waist) : '—'}${dw != null ? ` · ${signed(dw)}` : ''}</b></div>
        <div><span>Σ pliegues</span><b class="num">${sumNow != null ? fmt(sumNow) : '—'}${ds != null ? ` · ${signed(ds)}` : ''}</b></div>
      </div>
    </div>
    ${alerts.length ? `<div class="card"><div class="ch"><h2>Qué dice la semana</h2></div>${alerts.map(alertBox).join('')}</div>` : ''}
    ${renderBalance(ctx, addDays(d.weekEnd, -6), d.weekEnd)}
    <div class="card" hidden><div class="ch"><h2>Semana vs objetivos</h2></div>
      <table class="t"><tr><th>Indicador</th><th style="text-align:right">Real</th><th style="text-align:right">Obj.</th></tr>
        ${row('Ritmo de pérdida', loss != null ? fmt(loss, 2) + ' %' : '—', `${fmt(tgt[0])}–${fmt(tgt[1])}`, loss != null && L.rateReliable ? inTarget : null)}
        ${row('Pasos / día', wk.steps != null ? fmtK(wk.steps) : '—', t.steps ? fmtK(t.steps) : '—', wk.steps != null && t.steps ? wk.steps >= t.steps * 0.9 : null)}
        ${row('Sesiones', `${wk.sessions}`, t.sessions ?? '—', t.sessions ? wk.sessions >= t.sessions : null)}
        ${row('Sueño', wk.sleep != null ? fmt(wk.sleep) + ' h' : '—', t.sleep_h ? fmt(t.sleep_h) : '—', wk.sleep != null && t.sleep_h ? wk.sleep >= t.sleep_h - 0.3 : null)}
        ${row('Pesadas', `${wk.weighIns}/7`, '≥ 4', wk.weighIns >= 4)}
      </table></div>
    ${Object.keys(d.autoreg).length ? `<div class="card"><div class="ch"><h2>Series próxima semana</h2><span class="method">Método RP</span></div>
      ${Object.entries(d.autoreg).map(([m, a]) => { const r = rpRecommendation(a.soreness ?? 2, a.performance ?? 2); return `<div class="meal"><span>${esc(MUSCLE_LABEL[m] || m)}</span><span class="badge ${r.tone === 'good' ? 'g' : r.tone === 'warn' ? 'a' : 'n'}">${r.label}</span></div>`; }).join('')}
      <div class="hint">Solo aparecen los músculos que has tocado; el resto: +1 serie (todo normal).</div></div>` : ''}
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
  const v = planFor(ctx.store.get(FILES.plan), d.date);
  const shown = musclesTrained(ctx.store.allDays(), d.date, exercisesOf(ctx), v?.routine).filter((m) => MUSCLE_LABEL[m]);
  const autoreg = Object.fromEntries(shown.map((m) => [m, { soreness: 2, performance: 2, ...(d.autoreg[m] || {}) }]));
  const checkin = { autoreg: Object.keys(autoreg).length ? autoreg : undefined, measures: d.measures, skinfolds: d.skinfolds, photos: d.photos, photos_from: d.photoDate !== d.date && d.photos.length ? d.photoDate : undefined, ratings: d.ratings, adherence: d.adherence.status === 'plan' ? undefined : d.adherence, note: d.note.trim() || undefined, decision: { type: d.decision.type, text: d.decision.text.trim() || undefined } };
  const target = ctx.store.day(d.date);
  if (d.date !== d.origDate && target.checkin && !(await ask({ title: `Ya hay un control el ${fmtShort(d.date)}`, text: '¿Sustituirlo por este?', ok: 'Sustituir', danger: true }))) return;
  if (d.origDate && d.origDate !== d.date) {
    ctx.store.updateDay(d.origDate, (day) => { delete day.checkin; }, `Mueve control ${fmtShort(d.origDate)} → ${fmtShort(d.date)}`);
  }
  ctx.store.updateDay(d.date, (day) => {
    if (d.weight != null) day.weight = d.weight;
    day.checkin = structuredClone(checkin);
  }, `Control semanal ${fmtShort(d.date)}`);
  const goPlan = d.decision.type !== 'keep';
  ctx.state.ctl = null;
  toast('Control guardado');
  writeSummary(ctx);
  if (goPlan) ctx.go('plan'); else ctx.nav({ tab: 'domingo' });
}

// ---------------------------------------------------------------- tarjeta del control
function controlCard(ctx) {
  const date = thisWeekCheckin(ctx);
  if (date) return renderDone(ctx, date);
  const due = isDue(ctx);
  const clean = weekIsClean(ctx, currentControlWeek(ctx));
  return `<div class="card" style="${due ? 'border-color:var(--accent)' : ''}">
      <div class="ch"><h2>Control semanal</h2>${due ? '<span class="badge g">Toca</span>' : ''}</div>
      <div class="small" style="font-weight:700;margin:-6px 0 6px">Semana del ${esc(fmtShort(addDays(currentControlWeek(ctx), -6)))} al ${esc(fmtShort(currentControlWeek(ctx)))}</div>
      <div class="muted small" style="margin:-4px 0 12px">Revisa cada día, mídete, fotos, cómo ha ido, entreno y cierra con el balance y tu decisión. Tómate tu tiempo: de aquí salen las conclusiones.</div>
      ${clean ? `<div class="alert g">${icon.check}<div><b>Semana sin incidencias</b>Todos los días están validados. Puedes hacer el control rápido: medidas, fotos y decisión.</div></div>
      <button class="btn primary" id="startQuick">Control rápido · 3 pasos</button>
      <button class="btn secondary" id="startCk" style="margin-top:8px">Control completo (6 pasos)</button>`
    : `<button class="btn primary" id="startCk">Empezar el control semanal</button>
      <button class="link" id="startQuick" style="width:100%;text-align:center;margin-top:6px">Control rápido (medidas, fotos y decisión)</button>`}
    </div>`;
}

// ---------------------------------------------------------------- hecho
function renderDone(ctx, date) {
  const day = ctx.store.day(date);
  const c = day.checkin;
  const m = c.measures || {};
  return `<div class="card">
      <div class="row"><div><div class="muted small" style="font-weight:700">Control de la semana del ${esc(fmtShort(addDays(weekEndOf(ctx, date), -6)))} al ${esc(fmtShort(weekEndOf(ctx, date)))}</div><div style="font-size:20px;font-weight:800">${esc(fmtShort(date))} ✓</div></div>
      <button class="btn secondary sm" id="edit">${icon.edit} Editar</button></div>
      <div class="sep"></div>
      <table class="t">
        ${day.weight != null ? `<tr><td>Peso</td><td class="n">${fmt(day.weight)} kg</td></tr>` : ''}
        ${Object.entries(m).map(([k, v]) => `<tr><td>${esc(labelOf(ctx, k))}</td><td class="n">${fmt(v)}</td></tr>`).join('')}
        ${c.photos?.length ? `<tr><td>Fotos</td><td class="n">${c.photos.length}</td></tr>` : ''}
        ${c.decision?.text ? `<tr><td>Decisión</td><td class="n" style="font-weight:600">${esc(c.decision.text)}</td></tr>` : ''}
      </table>
    </div>
    <button class="btn secondary" id="copy" style="margin-bottom:4px">${icon.copy} Copiar resumen para Claude</button>
    <div class="hint" style="text-align:center;margin-bottom:12px">También queda en <b>resumen.md</b> de tu repo de datos.</div>`;
}

/** Lista de controles anteriores, cada uno editable. */
function historyList(ctx, exclude) {
  const days = ctx.store.allDays();
  const list = Object.keys(days).filter((d) => days[d]?.checkin && d !== exclude).sort().reverse();
  if (!list.length) return '';
  return `<div class="card"><div class="ch"><h2>Controles anteriores</h2></div>
    ${list.map((d) => { const c = days[d].checkin, m = c.measures || {}; return `<div class="row-edit"><div class="t"><b>${esc(fmtShort(d))}</b><span>${[days[d].weight != null && `${fmt(days[d].weight)} kg`, m.waist != null && `cintura ${fmt(m.waist)}`, c.photos?.length && `${c.photos.length} fotos`].filter(Boolean).join(' · ') || 'sin medidas'}</span></div><div class="ops"><button class="mini" data-editck="${d}" aria-label="Editar control del ${esc(fmtShort(d))}">${icon.edit}</button></div></div>`; }).join('')}
  </div>`;
}

function labelOf(ctx, id) {
  return (ctx.store.get(FILES.config)?.metrics || []).find((m) => m.id === id)?.label || id;
}

function bindDone(root, ctx) {
  $('#startCk', root)?.addEventListener('click', () => startControl(ctx, ctx.today()));
  $('#startQuick', root)?.addEventListener('click', () => startControl(ctx, ctx.today(), false, true));
  $('#edit', root)?.addEventListener('click', () => startControl(ctx, thisWeekCheckin(ctx), true));
  bindHistory(root, ctx);
  $('#copy', root)?.addEventListener('click', () => copySummary(ctx));
}

function bindHistory(root, ctx) {
  $$('[data-editck]', root).forEach((b) => b.addEventListener('click', () => startControl(ctx, b.dataset.editck, true)));
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
