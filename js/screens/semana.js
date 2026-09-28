// Semana: los 7 días de un vistazo (revisar y validar cada uno), el balance de la semana y el
// acceso al control semanal. También lo usa el primer paso del control.

import { $, $$, esc, fmt, fmtK, num, int, toast, openSheet, closeSheet, bindSeg, icon, alertBox, signed } from '../ui/ui.js';
import { addDays, fmtShort, fmtDayShort, nextWeekday, range, parseISO } from '../dates.js';
import { FILES, planFor, dietStatus, kcalTarget } from '../model.js';
import { weekBalance } from '../engine/week.js';
import { adherenceMap } from '../engine/analysis.js';
import { MUSCLE_LABEL, MUSCLES } from '../training/catalog.js';
import { exercisesOf, volumeBars } from './exercises.js';
import { currentControlWeek } from './control.js';

const DIET = {
  logged: 'Lo apuntado es todo',
  plan: 'Según plan',
  over: 'Me pasé',
  under: 'Me quedé corto',
  unknown: 'No lo sé',
};

/** Semana mostrada: la que toca cerrar (ver control.js) desplazada `offset` semanas. */
export function weekRange(ctx, offset = 0) {
  const to = addDays(currentControlWeek(ctx), 7 * offset);
  return { from: addDays(to, -6), to };
}

export function balanceFor(ctx, from, to, { allDays = false } = {}) {
  const data = ctx.data();
  const checkins = Object.keys(data.days).filter((d) => data.days[d]?.checkin).map((d) => ({ date: d, checkin: data.days[d].checkin }));
  return weekBalance(data, from, to, { analysis: ctx.analysis(), adherence: adherenceMap(checkins, data.days), exercises: exercisesOf(ctx), until: allDays ? null : ctx.today() });
}

// ---------------------------------------------------------------- tabla de días
function dietLabel(r) {
  const d = r.diet;
  if (!d) return r.loggedKcal != null ? `${fmtK(r.loggedKcal)} apuntadas` : 'Sin validar';
  if (d.status === 'logged') return `${fmtK(r.loggedKcal ?? 0)} kcal`;
  if (d.status === 'plan') return `Plan · ${fmtK(r.target)}`;
  if (d.status === 'over' || d.status === 'under') return d.kcal_delta != null ? `Plan ${d.kcal_delta > 0 ? '+' : '−'}${fmtK(Math.abs(d.kcal_delta))}` : DIET[d.status];
  return 'No lo sé';
}

export function renderDays(ctx, from, to) {
  const b = balanceFor(ctx, from, to, { allDays: true }); // la tabla enseña los 7 días (los futuros, apagados)
  const today = ctx.today();
  const pending = b.rows.filter((r) => !r.validated && r.date <= today).length;
  return `<div class="card">
    <div class="ch"><h2>Día a día</h2><span class="aux">${pending ? `${pending} sin validar` : 'todo validado ✓'}</span></div>
    <div class="muted small" style="margin:-6px 0 8px">Toca un día para revisarlo o corregirlo.</div>
    ${b.rows.map((r) => {
      const future = r.date > today;
      const ok = r.validated;
      return `<button class="dayrow ${future ? 'future' : ''}" data-day="${r.date}" ${future ? 'disabled' : ''}>
        <span class="dd"><b>${esc(fmtDayShort(r.date))}</b><i class="st ${ok ? 'ok' : future ? '' : 'pend'}"></i></span>
        <span class="dv"><b class="num">${r.weight != null ? fmt(r.weight) : '—'}</b><small>kg</small></span>
        <span class="dv wide"><b class="${!ok && !future ? 'warn' : ''}">${future ? '' : esc(dietLabel(r))}</b><small>${r.mealsLogged ? `${r.mealsLogged} comidas apuntadas` : 'dieta'}</small></span>
        <span class="dv"><b class="num">${r.steps != null ? (r.steps >= 1000 ? `${fmt(r.steps / 1000, 1)}k` : fmtK(r.steps)) : '—'}</b><small>pasos</small></span>
        <span class="dv"><b>${r.trained === true ? (r.sets ? `${r.sets} s.` : '✓') : r.trained === false ? 'Desc.' : '—'}</b><small>entreno</small></span>
      </button>`;
    }).join('')}
    ${pending ? `<button class="btn secondary sm" id="allPlan" style="width:100%;margin-top:10px">Marcar los ${pending} días sin validar como «según plan»</button>` : ''}
  </div>`;
}

export function bindDays(root, ctx, from, to, onChange) {
  $$('[data-day]', root).forEach((b) => b.addEventListener('click', () => dayReviewSheet(ctx, b.dataset.day, onChange)));
  $('#allPlan', root)?.addEventListener('click', () => {
    const today = ctx.today();
    const days = range(from, to).filter((d) => d <= today && !dietStatus(ctx.store.day(d)));
    for (const d of days) ctx.store.updateDay(d, (x) => { x.diet = { status: 'plan' }; }, `Revisión ${fmtShort(d)}: según plan`);
    toast(`${days.length} días marcados según plan`);
    onChange();
  });
}

// ---------------------------------------------------------------- revisar un día
export function dayReviewSheet(ctx, date, onDone) {
  const day = ctx.store.day(date);
  const v = planFor(ctx.store.get(FILES.plan), date);
  const routineDays = v?.routine?.days || [];
  const ds = dietStatus(day) || { status: null };
  const meals = (day.meals || []).filter((m) => m.items?.length);
  const logged = meals.length ? day.meals.reduce((a, m) => a + m.items.reduce((s, it) => s + (it.per100.kcal * it.g) / 100, 0), 0) : null;
  const target = kcalTarget(v, day.trained);
  const st = { diet: ds.status, delta: ds.kcal_delta != null ? Math.abs(ds.kcal_delta) : null, trained: day.trained, session: day.session?.day || null };
  const dietOpt = (k, l) => `<button type="button" data-v="${k}" class="${st.diet === k ? 'on' : ''}">${l}</button>`;
  openSheet(`<h3>${esc(fmtDayShort(date))} · revisar</h3>
    <div class="stack" style="margin-top:12px">
      <div class="g3">
        <div class="field"><label for="rW">Peso (kg)</label><input class="inp" id="rW" inputmode="decimal" value="${day.weight != null ? fmt(day.weight) : ''}" placeholder="—"></div>
        <div class="field"><label for="rS">Pasos</label><input class="inp" id="rS" inputmode="numeric" value="${day.steps != null ? fmtK(day.steps) : ''}" placeholder="—"></div>
        <div class="field"><label for="rZ">Sueño (h)</label><input class="inp" id="rZ" inputmode="decimal" value="${day.sleep_h != null ? fmt(day.sleep_h) : ''}" placeholder="—"></div>
      </div>

      <div class="field"><label>Entreno</label>
        <div class="chipset" id="rT"><button type="button" data-v="rest" class="${st.trained === false ? 'on' : ''}">Descanso</button>${routineDays.map((d) => `<button type="button" data-v="${esc(d.name)}" class="${st.trained === true && st.session === d.name ? 'on' : ''}">${esc(d.name)}</button>`).join('')}<button type="button" data-v="other" class="${st.trained === true && !routineDays.some((d) => d.name === st.session) ? 'on' : ''}">Otro</button></div>
        ${day.session?.sets?.length ? `<div class="hint">${day.session.sets.length} series apuntadas ese día.</div>` : ''}
      </div>

      <div class="field"><label>Dieta · objetivo ${fmtK(target)} kcal</label>
        <div class="card flat" style="margin:0 0 8px;padding:10px 12px"><div class="row"><span class="small" style="font-weight:700">${meals.length ? `Apuntado: ${fmtK(logged)} kcal en ${meals.length} ${meals.length === 1 ? 'comida' : 'comidas'}` : 'Nada apuntado ese día'}</span><button class="link" id="rMeals" type="button">Apuntar comidas</button></div></div>
        <div class="chipset" id="rD">${meals.length ? dietOpt('logged', 'Lo apuntado es todo') : ''}${dietOpt('plan', 'Según plan')}${dietOpt('over', 'Me pasé')}${dietOpt('under', 'Me quedé corto')}${dietOpt('unknown', 'No lo sé')}</div>
        <div id="rDelta" ${st.diet === 'over' || st.diet === 'under' ? '' : 'hidden'} style="margin-top:10px">
          <div class="unit-wrap"><input class="inp" id="rDv" inputmode="numeric" value="${st.delta != null ? fmtK(st.delta) : ''}" placeholder="¿Cuánto, aproximadamente?"><span class="u">kcal</span></div>
          <div class="hint">Respecto al plan de ese día. Ej.: cena fuera ≈ 700 más. Si no lo sabes, déjalo vacío y ese día no contará para calcular el gasto.</div>
        </div>
      </div>

      <div class="field"><label for="rN">Nota del día</label><textarea class="inp" id="rN" placeholder="Opcional">${esc(day.note || '')}</textarea></div>
      <div class="sheet-actions"><button class="btn primary" id="rSave">Guardar ${esc(fmtDayShort(date))}</button></div>
    </div>`, {
    bind: (sh) => {
      bindSeg(sh, '#rT', (val) => {
        if (val === 'rest') { st.trained = false; st.session = null; }
        else if (val === 'other') { st.trained = true; st.session = st.session && !routineDays.some((d) => d.name === st.session) ? st.session : null; }
        else { st.trained = true; st.session = val; }
      });
      bindSeg(sh, '#rD', (val) => {
        st.diet = val;
        $('#rDelta', sh).hidden = !(val === 'over' || val === 'under');
        if (!$('#rDelta', sh).hidden) $('#rDv', sh).focus();
      });
      $('#rMeals', sh).addEventListener('click', () => {
        closeSheet();
        setTimeout(() => ctx.nav({ tab: 'hoy', hoySub: 'comidas', date }), 80); // tras cerrar la hoja en el historial
      });
      $('#rSave', sh).addEventListener('click', () => {
        const w = num($('#rW', sh).value);
        if ($('#rW', sh).value.trim() && (w == null || w < 25 || w > 350)) return toast('Peso no válido');
        if (!st.diet) return toast('Elige cómo fue la dieta ese día');
        const dv = int($('#rDv', sh).value);
        ctx.store.updateDay(date, (d) => {
          if (w == null) delete d.weight; else d.weight = w;
          d.steps = int($('#rS', sh).value) ?? undefined;
          d.sleep_h = num($('#rZ', sh).value) ?? undefined;
          if (st.trained === false) { d.trained = false; }
          else if (st.trained === true) { d.trained = true; if (st.session) d.session = { ...(d.session || {}), day: st.session }; }
          d.diet = st.diet === 'over' || st.diet === 'under'
            ? { status: st.diet, ...(dv != null ? { kcal_delta: st.diet === 'under' ? -Math.abs(dv) : Math.abs(dv) } : {}) }
            : { status: st.diet };
          if (st.diet === 'logged') d.meals_complete = true;
          d.note = $('#rN', sh).value.trim() || undefined;
        }, `Revisión ${fmtShort(date)}: ${DIET[st.diet].toLowerCase()}`);
        toast(`${fmtDayShort(date)} revisado`);
        closeSheet();
        onDone?.();
      });
    },
  });
}

// ---------------------------------------------------------------- balance
const pct = (v, t) => (v != null && t ? Math.round((v / t) * 100) : null);
const barRow = (label, val, tgt, unit, { dec = 0, good = null } = {}) => {
  const p = pct(val, tgt);
  const tone = good == null ? '' : good ? 'up' : 'warn';
  return `<div class="mac" style="margin-bottom:10px"><div class="row"><b>${label}</b><span class="num"><b class="${tone}" style="font-weight:800">${val != null ? fmt(val, dec) : '—'}</b>${tgt != null ? ` / ${fmt(tgt, dec)}` : ''} ${unit}${p != null ? ` · ${p} %` : ''}</span></div>
    <div class="bar"><i style="width:${Math.min(100, p ?? 0)}%;${good === false ? 'background:var(--amber)' : ''}"></i></div></div>`;
};

export function renderBalance(ctx, from, to) {
  const b = balanceFor(ctx, from, to);
  const e = b.energy, m = b.macros, t = b.training;
  const a = ctx.analysis();
  const tgtRate = a.latest?.rateTarget;
  const loss = b.weight.pctWeek != null ? -b.weight.pctWeek : null;
  const muscles = MUSCLES.filter(([k]) => t.volume[k]);
  return `<div class="card">
      <div class="ch"><h2>Balance de la semana</h2><span class="aux">${esc(fmtShort(from))}–${esc(fmtShort(to))}</span></div>
      <div class="g2" style="margin-bottom:12px">
        <div class="card flat" style="margin:0;padding:12px"><div class="muted small" style="font-weight:700">Kcal media / día</div><div style="font-size:24px;font-weight:800" class="num">${e.kcalMean != null ? fmtK(e.kcalMean) : '—'}</div><div class="small muted">objetivo ${e.targetMean != null ? fmtK(e.targetMean) : '—'}</div></div>
        <div class="card flat" style="margin:0;padding:12px"><div class="muted small" style="font-weight:700">Déficit medio</div><div style="font-size:24px;font-weight:800" class="num">${e.deficit != null ? fmtK(e.deficit) : '—'}</div><div class="small muted">${e.tdee != null ? `gasto ${fmtK(e.tdee)}` : 'gasto: faltan datos'}</div></div>
      </div>
      <div class="small muted" style="margin:-4px 0 12px">Kcal: ${e.logged} ${e.logged === 1 ? 'día registrado' : 'días registrados'}, ${e.estimated} estimados${e.unknown ? `, ${e.unknown} sin dato` : ''}${e.pending ? `, <b class="warn">${e.pending} sin validar</b> (cuentan como plan)` : ''}.</div>

      ${m ? `<div class="grp">Macros (media de ${m.days} ${m.days === 1 ? 'día registrado' : 'días registrados'})</div>
        ${barRow('Proteína', m.p, m.target.p, 'g', { good: m.p >= m.target.p * 0.9 })}
        ${barRow('Carbohidratos', m.c, m.target.c, 'g')}
        ${barRow('Grasas', m.f, m.target.f, 'g')}` : `<div class="muted small" style="margin-bottom:10px">Macros: sin días con las comidas apuntadas completas.</div>`}

      <div class="grp">Actividad</div>
      ${barRow('Pasos / día', b.steps.mean, b.steps.target, '', { good: b.steps.mean != null && b.steps.target ? b.steps.mean >= b.steps.target * 0.9 : null })}
      ${barRow('Sesiones', t.sessions, t.target, '', { good: t.target ? t.sessions >= t.target : null })}
      ${barRow('Sueño', b.sleep.mean, b.sleep.target, 'h', { dec: 1, good: b.sleep.mean != null && b.sleep.target ? b.sleep.mean >= b.sleep.target - 0.3 : null })}

      <div class="grp">Peso</div>
      <table class="t">
        <tr><td>Tendencia</td><td class="n">${b.weight.start != null ? `${fmt(b.weight.start)} → ${fmt(b.weight.end)} kg` : '—'}</td></tr>
        <tr><td>Cambio</td><td class="n ${b.weight.change < 0 ? 'up' : ''}">${b.weight.change != null ? `${signed(b.weight.change)} kg` : '—'}</td></tr>
        <tr><td>Ritmo</td><td class="n ${loss != null && tgtRate ? (loss >= tgtRate[0] && loss <= tgtRate[1] ? 'up' : 'warn') : ''}">${loss != null ? `${fmt(-loss, 2)} %/sem` : '—'}${tgtRate ? ` <span class="muted">(obj. ${fmt(tgtRate[0])}–${fmt(tgtRate[1])})</span>` : ''}</td></tr>
        <tr><td>Pesadas</td><td class="n">${b.weight.weighIns}/7</td></tr>
      </table>

      ${muscles.length ? `<div class="grp">Series por músculo (${t.sets} series)</div>${volumeBars(t.volume)}` : ''}
    </div>`;
}

// ---------------------------------------------------------------- pantalla Semana (sin el control abierto)
export function renderLanding(ctx, { done, history }) {
  const off = ctx.state.weekOffset || 0;
  const { from, to } = weekRange(ctx, off);
  return `<div class="row" style="margin:-2px 0 12px">
      <button class="mini" id="wPrev" aria-label="Semana anterior">${icon.back}</button>
      <div style="text-align:center"><b style="font-size:14.5px">${from <= ctx.today() && ctx.today() <= to ? 'Esta semana' : to < ctx.today() && off === 0 ? 'Semana que toca cerrar' : to > ctx.today() ? 'Semana en curso' : `Semana del ${esc(fmtShort(from))}`}</b><div class="muted small">${esc(fmtShort(from))} – ${esc(fmtShort(to))}</div></div>
      <button class="mini" id="wNext" aria-label="Semana siguiente" ${from > ctx.today() || to >= ctx.today() ? 'disabled style="opacity:.35"' : ''}>${icon.chevron}</button>
    </div>
    ${off === 0 ? done : ''}
    ${renderDays(ctx, from, to)}
    ${renderBalance(ctx, from, to)}
    ${off === 0 ? history : ''}`;
}

export function bindLanding(root, ctx) {
  const off = ctx.state.weekOffset || 0;
  const { from, to } = weekRange(ctx, off);
  $('#wPrev', root)?.addEventListener('click', () => { ctx.state.weekOffset = off - 1; ctx.render(); });
  $('#wNext', root)?.addEventListener('click', () => { if (to < ctx.today()) { ctx.state.weekOffset = off + 1; ctx.render(); } });
  bindDays(root, ctx, from, to, () => { ctx._analysis = null; ctx.render(); });
}

export { parseISO };
