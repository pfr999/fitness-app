// Pantalla Hoy: subpestañas Día · Comidas · Entreno.

import { $, $$, esc, fmt, fmtK, num, int, toast, openSheet, closeSheet, bindSeg, icon } from '../ui/ui.js';
import { addDays, fmtShort, fmtLong, range } from '../dates.js';
import { FILES, planFor, sumItems, kcalTarget, dietStatus } from '../model.js';
import { dayReviewSheet } from './semana.js';
import { isDue } from './control.js';
import * as meals from './meals.js';
import { mealPlan } from './meals.js';
import * as workout from './workout.js';

const SUBS = [['dia', 'Día'], ['comidas', 'Comidas'], ['entreno', 'Entreno']];

export function render(ctx) {
  const sub = ctx.state.hoySub;
  const seg = `<div class="seg" id="hoySeg" style="margin-bottom:12px">${SUBS.map(([k, l]) => `<button data-v="${k}" class="${k === sub ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const body = sub === 'comidas' ? meals.render(ctx) : sub === 'entreno' ? workout.render(ctx) : renderDay(ctx);
  return seg + dateNav(ctx) + body;
}

export function bind(root, ctx) {
  bindSeg(root, '#hoySeg', (v) => ctx.nav({ hoySub: v }));
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
  const supp = v?.supplements || [];
  const taken = new Set(day.supplements_taken || []);
  const nTaken = [...taken].filter((n) => supp.some((s) => s.name === n)).length;
  // lista del día: cada línea con su estado y a dónde lleva
  const meals = (day.meals || []).filter((m) => m.items?.length);
  const mp = mealPlan(v);
  const slots = mp.mode === 'fixed' ? mp.list.length : 0;
  const kcalNow = meals.length ? sumItems(meals.flatMap((m) => m.items)).kcal : 0;
  const sets = (day.session?.sets || []).filter((s) => !s.warmup).length;
  const ds = dietStatus(day);
  const line = (id, label, value, done, sub = '') => `<button class="dl ${done ? 'done' : ''}" id="${id}"><i class="st"></i><span class="dl-l">${label}</span><span class="dl-v">${value}${sub ? `<small>${sub}</small>` : ''}</span><span class="go">${icon.chevron}</span></button>`;
  const checklist = `<div class="card" style="padding:6px 16px">
    ${line('dlMeals', 'Comidas', meals.length ? `${fmtK(kcalNow)} / ${fmtK(kcalTarget(v, day.trained))} kcal` : 'Nada apuntado', ds?.status === 'logged', meals.length ? `${meals.length}${slots ? ` de ${slots}` : ''} comidas${ds?.status === 'logged' ? ' · día cerrado' : ''}` : '')}
    ${line('dlTrain', 'Entreno', day.trained === false ? 'Descanso' : day.trained === true ? esc(day.session?.day || 'Hecho') : 'Sin marcar', day.trained != null, sets ? `${sets} series` : '')}
    ${line('dlSteps', 'Pasos', day.steps != null ? fmtK(day.steps) : 'Añadir', day.steps != null)}
    ${line('dlSleep', 'Sueño', day.sleep_h != null ? `${fmt(day.sleep_h)} h` : 'Añadir', day.sleep_h != null)}
    ${supp.length ? line('dlSupp', 'Suplementos', `${nTaken}/${supp.length}`, nTaken === supp.length) : ''}
    ${line('dlNote', 'Nota', day.note ? esc(day.note.slice(0, 22)) + (day.note.length > 22 ? '…' : '') : 'Añadir', !!day.note)}
  </div>
  <button class="btn ${ds ? 'secondary' : 'primary'}" id="closeDay" style="margin-bottom:12px">${ds ? `${icon.check} Día revisado · ${esc({ logged: 'lo apuntado es todo', plan: 'según plan', over: 'me pasé', under: 'me quedé corto', unknown: 'no lo sé' }[ds.status])}` : 'Revisar y cerrar el día'}</button>`;

  // guía de primer uso: lo que falta configurar para que los cálculos tengan sentido
  const cfg = ctx.store.get(FILES.config) || {};
  const setup = [
    [!cfg.profile?.height_cm || !cfg.profile?.birth_year, 'Tu perfil (altura, año de nacimiento)', 'setProfile'],
    [(v?.diet?.kcal?.train === 2800 && v?.diet?.kcal?.rest === 2500 && v?.diet?.protein_g === 200), 'Tu dieta (kcal y macros)', 'setDiet'],
    [!(v?.routine?.days || []).length, 'Tu rutina', 'setRoutine'],
    [!v?.targets?.weight_kg, 'Tus objetivos (peso, pasos, sesiones)', 'setTargets'],
  ].filter(([todo]) => todo);
  const setupCard = setup.length && date === ctx.today() ? `<div class="card" style="border-color:var(--accent)">
    <div class="ch"><h2>Termina de configurar</h2><span class="aux">${4 - setup.length}/4</span></div>
    ${setup.map(([, label, id]) => `<button class="dl" id="${id}"><i class="st"></i><span class="dl-l" style="grid-column:span 2">${label}</span><span class="go">${icon.chevron}</span></button>`).join('')}
  </div>` : '';

  return `
  ${setupCard}
  ${due ? `<button class="sunday" id="goControl"><span class="ic">${icon.sunday}</span><div><b>Toca el control semanal</b><span>Revisa la semana, mídete y decide</span></div><span class="go">${icon.chevron}</span></button>` : ''}
  <div class="card hero">
    <div class="lbl"><label for="wIn">Peso en ayunas</label><span class="muted">${prev.weight != null ? `Día anterior ${fmt(prev.weight)}` : ''}</span></div>
    <div class="weight"><input id="wIn" inputmode="decimal" enterkeyhint="done" placeholder="—" value="${day.weight != null ? fmt(day.weight) : ''}" aria-label="Peso en kilos"><span class="u">kg</span></div>
    <div class="stats3">
      <div><div class="k">Tendencia</div><div class="v num">${L.trend ? fmt(L.trend.level) + ' kg' : '—'}</div></div>
      <div><div class="k">Ritmo</div><div class="v num ${L.rate && L.rate.kgWeek < 0 ? 'up' : ''}">${rate}</div></div>
      <div><div class="k">Gasto est.</div><div class="v num">${L.tdeeReliable ? fmtK(L.tdee.E) : '—'}</div></div>
    </div>
    ${rateHint}
    <button class="btn primary" style="margin-top:16px" id="saveW">${icon.check}Guardar peso</button>
  </div>

  ${checklist}

  ${supp.length ? `<div class="card" id="suppCard"><div class="ch"><h2>Suplementos y medicación</h2><span class="aux">${nTaken}/${supp.length}</span></div>
    ${supp.map((s) => `<label class="chk"><input type="checkbox" data-supp="${esc(s.name)}" ${taken.has(s.name) ? 'checked' : ''}><div><b>${esc(s.name)}</b><small>${esc([s.dose, s.timing].filter(Boolean).join(' · '))}</small></div>${s.kind === 'medication' ? '<span class="badge b t">Medicación</span>' : ''}</label>`).join('')}
  </div>` : ''}`;
}

function bindDay(root, ctx) {
  const date = ctx.state.date;
  $('#goControl', root)?.addEventListener('click', () => ctx.go('domingo'));
  $('#setProfile', root)?.addEventListener('click', () => document.getElementById('settingsBtn').click());
  $('#setDiet', root)?.addEventListener('click', () => ctx.nav({ tab: 'plan', planTab: 'dieta' }));
  $('#setRoutine', root)?.addEventListener('click', () => ctx.nav({ tab: 'plan', planTab: 'rutina' }));
  $('#setTargets', root)?.addEventListener('click', () => ctx.nav({ tab: 'plan', planTab: 'obj' }));
  $('#dlMeals', root)?.addEventListener('click', () => ctx.nav({ hoySub: 'comidas' }));
  $('#dlTrain', root)?.addEventListener('click', () => ctx.nav({ hoySub: 'entreno' }));
  ['#dlSteps', '#dlSleep', '#dlNote'].forEach((s) => $(s, root)?.addEventListener('click', () => dailySheet(ctx, date)));
  $('#dlSupp', root)?.addEventListener('click', () => $('#suppCard', root)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  $('#closeDay', root)?.addEventListener('click', () => dayReviewSheet(ctx, date, () => { ctx._analysis = null; ctx.render(); }));
  const save = () => {
    const raw = $('#wIn', root).value;
    const w = num(raw);
    if (raw.trim() && (w == null || w < 25 || w > 350)) return toast('Peso no válido');
    ctx.store.updateDay(date, (d) => { if (w == null) delete d.weight; else d.weight = w; }, w == null ? `Borra peso ${fmtShort(date)}` : `Peso ${fmtShort(date)}: ${fmt(w)} kg`);
    toast(w == null ? 'Peso borrado' : `${fmt(w)} kg guardado`);
    $('#wIn', root).blur();
    ctx.render();
  };
  $('#saveW', root).addEventListener('click', save);
  $('#wIn', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  $$('[data-supp]', root).forEach((c) =>
    c.addEventListener('change', () => {
      const name = c.dataset.supp;
      ctx.store.updateDay(date, (d) => {
        const s = new Set(d.supplements_taken || []);
        c.checked ? s.add(name) : s.delete(name);
        d.supplements_taken = s.size ? [...s] : undefined;
      }, `Suplementos ${fmtShort(date)}`);
      const box = c.closest('.card'), all = $$('[data-supp]', box);
      $('.aux', box).textContent = `${all.filter((x) => x.checked).length}/${all.length}`;
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
      <div class="sheet-actions"><button class="btn primary" id="dSave">Guardar</button></div>
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

