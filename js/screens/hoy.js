// Pantalla Hoy: subpestañas Día · Comidas · Entreno.

import { $, $$, esc, fmt, fmtK, num, int, toast, openSheet, closeSheet, bindSeg, icon } from '../ui/ui.js';
import { addDays, fmtShort, fmtLong, range } from '../dates.js';
import { FILES, planFor, sumItems } from '../model.js';
import { isDue } from './control.js';
import * as meals from './meals.js';
import * as workout from './workout.js';

const SUBS = [['dia', 'Día'], ['comidas', 'Comidas'], ['entreno', 'Entreno']];

export function render(ctx) {
  const sub = ctx.state.hoySub;
  const seg = `<div class="seg" id="hoySeg" style="margin-bottom:12px">${SUBS.map(([k, l]) => `<button data-v="${k}" class="${k === sub ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const body = sub === 'comidas' ? meals.render(ctx) : sub === 'entreno' ? workout.render(ctx) : renderDay(ctx);
  return seg + dateNav(ctx) + body;
}

export function bind(root, ctx) {
  bindSeg(root, '#hoySeg', (v) => { ctx.state.hoySub = v; ctx.render(); });
  $('#prevDay', root)?.addEventListener('click', () => { ctx.state.date = addDays(ctx.state.date, -1); ctx.render(); });
  $('#nextDay', root)?.addEventListener('click', () => { if (ctx.state.date < ctx.today()) { ctx.state.date = addDays(ctx.state.date, 1); ctx.render(); } });
  $('#toToday', root)?.addEventListener('click', () => { ctx.state.date = ctx.today(); ctx.render(); });
  if (ctx.state.hoySub === 'dia') bindDay(root, ctx);
  if (ctx.state.hoySub === 'entreno') workout.bind(root, ctx);
  if (ctx.state.hoySub === 'comidas') meals.bind(root, ctx);
}

function dateNav(ctx) {
  const d = ctx.state.date, isToday = d === ctx.today();
  return `<div class="row" style="margin:-2px 0 12px">
    <button class="mini" id="prevDay" aria-label="Día anterior">${icon.back}</button>
    <div style="text-align:center"><b style="font-size:14.5px">${isToday ? 'Hoy' : esc(fmtLong(d))}</b>${isToday ? '' : `<div><button class="link" id="toToday" style="padding:2px 0">Volver a hoy</button></div>`}</div>
    <button class="mini" id="nextDay" aria-label="Día siguiente" ${isToday ? 'disabled style="opacity:.35"' : ''}>${icon.chevron}</button>
  </div>`;
}

// ---------------------------------------------------------------- Día
function renderDay(ctx) {
  const date = ctx.state.date;
  const day = ctx.store.day(date);
  const prev = ctx.store.day(addDays(date, -1));
  const a = ctx.analysis();
  const L = a.latest || {};
  const v = planFor(ctx.store.get(FILES.plan), date);
  const rate = L.rate ? `${fmt(L.rate.kgWeek, 2)}/sem` : '—';
  const rateHint = !L.rateReliable && L.dataDays ? `<div class="hint">El ritmo es fiable a partir de 14 días de datos (llevas ${L.dataDays}).</div>` : '';
  const due = date === ctx.today() && isDue(ctx);
  const tr = day.trained === true ? 'Sí' : day.trained === false ? 'Descanso' : '—';
  const supp = v?.supplements || [];
  const taken = new Set(day.supplements_taken || []);

  return `
  ${due ? `<button class="sunday" id="goControl"><span class="ic">${icon.sunday}</span><div><b>Toca control semanal</b><span>Medidas, fotos y revisión · unos 5 min</span></div><span class="go">${icon.chevron}</span></button>` : ''}
  <div class="card hero">
    <div class="lbl"><label for="wIn">Peso en ayunas</label><span class="muted">${prev.weight != null ? `Día anterior ${fmt(prev.weight)}` : ''}</span></div>
    <div class="weight"><input id="wIn" inputmode="decimal" enterkeyhint="done" placeholder="—" value="${day.weight != null ? fmt(day.weight) : ''}" aria-label="Peso en kilos"><span class="u">kg</span></div>
    <div class="stats3">
      <div><div class="k">Tendencia</div><div class="v num">${L.trend ? fmt(L.trend.level) + ' kg' : '—'}</div></div>
      <div><div class="k">Ritmo</div><div class="v num ${L.rate && L.rate.kgWeek < 0 ? 'up' : ''}">${rate}</div></div>
      <div><div class="k">Gasto est.</div><div class="v num">${L.tdeeReliable ? fmtK(L.tdee.E) : '—'}</div></div>
    </div>
    ${rateHint}
    <button class="btn primary" style="margin-top:16px" id="saveW">${icon.check}Guardar</button>
  </div>

  <div class="quick">
    <button class="qk ${day.steps != null ? 'done' : ''}" data-open="daily"><span class="k">Pasos</span><span class="v num ${day.steps == null ? 'empty' : ''}">${day.steps != null ? fmtK(day.steps) : '+ Añadir'}</span></button>
    <button class="qk ${day.sleep_h != null || day.note ? 'done' : ''}" data-open="daily"><span class="k">Sueño</span><span class="v num ${day.sleep_h == null ? 'empty' : ''}">${day.sleep_h != null ? fmt(day.sleep_h) + ' h' : '+ Añadir'}</span></button>
    <button class="qk ${day.meals?.length ? 'done' : ''}" id="goMeals"><span class="k">Comido</span><span class="v num ${day.meals?.length ? '' : 'empty'}">${day.meals?.length ? fmtK(sumItems(day.meals.flatMap((m) => m.items)).kcal) : 'Añadir'}</span></button>
    <button class="qk ${day.trained != null ? 'done' : ''}" id="toggleTrain"><span class="k">Entreno</span><span class="v ${day.trained == null ? 'empty' : ''}">${tr}</span></button>
  </div>

  ${supp.length ? `<div class="card"><div class="ch"><h2>Suplementos y medicación</h2><span class="aux">${[...taken].filter((n) => supp.some((s) => s.name === n)).length}/${supp.length}</span></div>
    ${supp.map((s) => `<label class="chk"><input type="checkbox" data-supp="${esc(s.name)}" ${taken.has(s.name) ? 'checked' : ''}><div><b>${esc(s.name)}</b><small>${esc([s.dose, s.timing].filter(Boolean).join(' · '))}</small></div>${s.kind === 'medication' ? '<span class="badge b t">Medicación</span>' : ''}</label>`).join('')}
  </div>` : ''}
  ${day.note ? `<div class="card flat"><div class="muted small" style="font-weight:700;margin-bottom:4px">Nota</div><div style="white-space:pre-wrap">${esc(day.note)}</div></div>` : ''}`;
}

function bindDay(root, ctx) {
  const date = ctx.state.date;
  $('#goControl', root)?.addEventListener('click', () => ctx.go('domingo'));
  $('#goMeals', root)?.addEventListener('click', () => { ctx.state.hoySub = 'comidas'; ctx.render(); });
  const save = () => {
    const raw = $('#wIn', root).value;
    const w = num(raw);
    if (raw.trim() && (w == null || w < 25 || w > 350)) return toast('Peso no válido');
    ctx.store.updateDay(date, (d) => { if (w == null) delete d.weight; else d.weight = w; }, w == null ? `Borra peso ${fmtShort(date)}` : `Peso ${fmtShort(date)}: ${fmt(w)} kg`);
    toast(w == null ? 'Peso borrado' : `${fmt(w)} kg guardado`);
    $('#wIn', root).blur();
  };
  $('#saveW', root).addEventListener('click', save);
  $('#wIn', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  $('#toggleTrain', root).addEventListener('click', () => {
    const cur = ctx.store.day(date).trained;
    const next = cur === true ? false : cur === false ? undefined : true;
    ctx.store.updateDay(date, (d) => { if (next === undefined) delete d.trained; else d.trained = next; }, `Entreno ${fmtShort(date)}: ${next === true ? 'sí' : next === false ? 'descanso' : 'sin marcar'}`);
    ctx.render();
  });
  $$('[data-open="daily"]', root).forEach((b) => b.addEventListener('click', () => dailySheet(ctx, date)));
  $$('[data-supp]', root).forEach((c) =>
    c.addEventListener('change', () => {
      const name = c.dataset.supp;
      ctx.store.updateDay(date, (d) => {
        const s = new Set(d.supplements_taken || []);
        c.checked ? s.add(name) : s.delete(name);
        d.supplements_taken = s.size ? [...s] : undefined;
      }, `Suplementos ${fmtShort(date)}`);
    }),
  );
}

function dailySheet(ctx, date) {
  const d = ctx.store.day(date);
  const w = d.wellness || {};
  const scale = (id, val) => `<div class="scale acc" data-scale="${id}">${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-v="${n}" class="${val === n ? 'on' : ''}">${n}</button>`).join('')}</div>`;
  openSheet(`<h3>Registro · ${esc(fmtShort(date))}</h3>
    <div class="stack" style="margin-top:12px">
      <div class="g2">
        <div class="field"><label for="dSteps">Pasos</label><input class="inp" id="dSteps" inputmode="numeric" value="${d.steps != null ? fmtK(d.steps) : ''}" placeholder="10.000"></div>
        <div class="field"><label for="dSleep">Sueño (h)</label><input class="inp" id="dSleep" inputmode="decimal" value="${d.sleep_h != null ? fmt(d.sleep_h) : ''}" placeholder="7,5"></div>
      </div>
      <div class="field"><label for="dRhr">Pulso en reposo (lpm)</label><input class="inp" id="dRhr" inputmode="numeric" value="${d.rhr ?? ''}" placeholder="58"></div>
      <div class="field"><label>Energía (1 baja · 5 alta)</label>${scale('energy', w.energy)}</div>
      <div class="field"><label>Fatiga (1 poca · 5 mucha)</label>${scale('fatigue', w.fatigue)}</div>
      <div class="field"><label for="dNote">Nota</label><textarea class="inp" id="dNote" placeholder="Lo que quieras recordar de hoy">${esc(d.note || '')}</textarea></div>
      <button class="btn primary" id="dSave">Guardar</button>
    </div>`, {
    bind: (sh) => {
      $$('.scale', sh).forEach((s) => s.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b) return;
        const was = b.classList.contains('on');
        $$('button', s).forEach((x) => x.classList.remove('on'));
        if (!was) b.classList.add('on');
      }));
      $('#dSave', sh).addEventListener('click', () => {
        const val = (sel) => $(`[data-scale="${sel}"] .on`, sh)?.dataset.v;
        ctx.store.updateDay(date, (x) => {
          x.steps = int($('#dSteps', sh).value) ?? undefined;
          x.sleep_h = num($('#dSleep', sh).value) ?? undefined;
          x.rhr = int($('#dRhr', sh).value) ?? undefined;
          x.wellness = { energy: val('energy') ? +val('energy') : undefined, fatigue: val('fatigue') ? +val('fatigue') : undefined };
          x.note = $('#dNote', sh).value.trim() || undefined;
        }, `Registro ${fmtShort(date)}`);
        closeSheet();
        toast('Guardado');
        ctx.render();
      });
    },
  });
}

