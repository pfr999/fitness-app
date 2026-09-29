// Pantalla Hoy: tira de la semana (y calendario) + subpestañas Día · Comidas · Entreno.

import { $, $$, esc, fmt, fmtK, num, int, signed, toast, openSheet, closeSheet, bindSeg, icon } from '../ui/ui.js';
import { donut, sparkline } from '../ui/charts.js';
import { addDays, fmtShort, fmtLong, range, weekStart, weekday, parseISO, daysBetween } from '../dates.js';
import { FILES, planFor, sumItems, dietStatus } from '../model.js';
import { goalOf, favours } from '../engine/targets.js';
import { weeklyRate } from '../engine/trend.js';
import { dayReviewSheet } from './semana.js';
import { isDue } from './control.js';
import * as meals from './meals.js';
import { mealPlan, dayTargets } from './meals.js';
import * as workout from './workout.js';

const SUBS = [['dia', 'Día'], ['comidas', 'Comidas'], ['entreno', 'Entreno']];
const WD = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/**
 * Estado de un día para los puntos de la tira y del calendario:
 * ok (validado: lo apuntado es todo) · plan (según plan) · amb (me pasé / me quedé corto) ·
 * none (sin validar o «no lo sé») · now (hoy, en curso) · fut (futuro).
 */
export function dayState(ctx, date) {
  if (date > ctx.today()) return 'fut';
  const ds = dietStatus(ctx.store.day(date));
  if (ds) return { logged: 'ok', plan: 'plan', over: 'amb', under: 'amb' }[ds.status] || 'none';
  return date === ctx.today() ? 'now' : 'none';
}
const STATE_LABEL = { ok: 'Validado', plan: 'Según plan', amb: 'Fuera del plan', none: 'Sin validar', now: 'En curso' };

/** Título de la cabecera para la fecha que se está viendo. */
export function dayTitle(ctx) {
  const d = ctx.state.date, t = ctx.today(), n = daysBetween(d, t);
  const title = n === 0 ? 'Hoy' : n === 1 ? 'Ayer' : fmtLong(d).split(',')[0] + ' ' + parseISO(d).getDate();
  const eyebrow = n === 0 ? `${fmtLong(d).split(',')[0]} ${fmtShort(d)}` : `${fmtShort(d)} · hace ${n} ${n === 1 ? 'día' : 'días'}`;
  return { title, eyebrow };
}

export function render(ctx) {
  const sub = ctx.state.hoySub;
  const seg = `<div class="seg" id="hoySeg" style="margin-bottom:12px">${SUBS.map(([k, l]) => `<button data-v="${k}" class="${k === sub ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const body = sub === 'comidas' ? meals.render(ctx) : sub === 'entreno' ? workout.render(ctx) : renderDay(ctx);
  return strip(ctx) + seg + `<div class="hoybody" id="hoyBody" style="view-transition-name:hoyday">${body}</div>`;
}

export function bind(root, ctx) {
  bindSeg(root, '#hoySeg', (v) => ctx.nav({ hoySub: v }));
  $$('#wstrip [data-day]', root).forEach((b) => b.addEventListener('click', () => goDay(ctx, b.dataset.day)));
  bindSwipe(root, ctx);
  if (ctx.state.hoySub === 'dia') bindDay(root, ctx);
  if (ctx.state.hoySub === 'entreno') workout.bind(root, ctx);
  if (ctx.state.hoySub === 'comidas') meals.bind(root, ctx);
}

// ---------------------------------------------------------------- días: tira, gestos y calendario
function strip(ctx) {
  const d = ctx.state.date, mon = weekStart(d);
  return `<div class="wstrip" id="wstrip">${range(mon, addDays(mon, 6)).map((x) => {
    const st = dayState(ctx, x);
    return `<button class="wd ${x === d ? 'on' : ''} ${st === 'fut' ? 'fut' : ''}" data-day="${x}" ${st === 'fut' ? 'disabled' : ''} aria-label="${esc(fmtLong(x))}"><span class="l">${WD[weekday(x)]}</span><span class="n">${parseISO(x).getDate()}</span><span class="sdot ${st}"></span></button>`;
  }).join('')}</div>`;
}

/** Cambia el día que se ve (nunca al futuro), con una transición lateral si el navegador la tiene. */
export function goDay(ctx, date) {
  if (date > ctx.today()) date = ctx.today();
  if (date === ctx.state.date) return;
  const dir = date > ctx.state.date ? 1 : -1;
  document.documentElement.style.setProperty('--vt-dx', dir > 0 ? '-24px' : '24px');
  const apply = () => { ctx.state.date = date; ctx.render(); };
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(apply);
  else apply();
}

/** Deslizar a los lados: en el contenido cambia de día; en la tira, de semana. */
function bindSwipe(root, ctx) {
  let s = null;
  const down = (e) => {
    if (e.target.closest('input, textarea, select, .seg, .daytabs, .chips-row')) return;
    s = { x: e.clientX, y: e.clientY, strip: !!e.target.closest('#wstrip') };
  };
  const up = (e) => {
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y, strip = s.strip; s = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < 2 * Math.abs(dy)) return;
    goDay(ctx, addDays(ctx.state.date, (dx < 0 ? 1 : -1) * (strip ? 7 : 1)));
  };
  for (const el of [$('#wstrip', root), $('#hoyBody', root)]) {
    if (!el) continue;
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', () => { s = null; });
  }
}

/** Hoja «Ir a un día»: mes con el estado de cada día, entrenos y controles; atajos Hoy / Ayer / −7. */
export function calendarSheet(ctx) {
  const today = ctx.today();
  let month = ctx.state.date.slice(0, 7);
  const paint = (sh) => {
    const [y, m] = month.split('-').map(Number);
    const first = `${month}-01`;
    const days = new Date(y, m, 0).getDate();
    const off = (weekday(first) + 6) % 7;
    let g = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((x) => `<div class="h">${x}</div>`).join('') + '<div class="cd blank"></div>'.repeat(off);
    for (let i = 1; i <= days; i++) {
      const d = `${month}-${String(i).padStart(2, '0')}`;
      const st = dayState(ctx, d), day = ctx.store.day(d);
      g += `<button class="cd ${st === 'fut' ? 'fut' : ''} ${d === ctx.state.date ? 'on' : ''}" data-cday="${d}" ${st === 'fut' ? 'disabled' : ''}>${day.checkin ? '<span class="cmk">◆</span>' : ''}${day.trained === true ? '<span class="tr"></span>' : ''}${i}<span class="sdot ${st}"></span></button>`;
    }
    $('#calBody', sh).innerHTML = `<div class="cal-m"><button class="mini" id="calPrev" aria-label="Mes anterior">${icon.back}</button><b>${MONTHS[m - 1]} ${y}</b><button class="mini" id="calNext" aria-label="Mes siguiente" ${month >= today.slice(0, 7) ? 'disabled style="opacity:.35"' : ''}>${icon.chevron}</button></div><div class="cal-g">${g}</div>`;
    $('#calPrev', sh).addEventListener('click', () => { month = shiftMonth(month, -1); paint(sh); });
    $('#calNext', sh).addEventListener('click', () => { if (month < today.slice(0, 7)) { month = shiftMonth(month, 1); paint(sh); } });
    $$('[data-cday]', sh).forEach((b) => b.addEventListener('click', () => pick(b.dataset.cday)));
  };
  const pick = (d) => {
    closeSheet();
    if (ctx.state.tab !== 'hoy') { ctx.state.date = d; ctx.nav({ tab: 'hoy' }); } else goDay(ctx, d);
  };
  openSheet(`<h3>Ir a un día</h3>
    <div class="cal-quick"><button data-jump="0">Hoy</button><button data-jump="1">Ayer</button><button data-jump="7">−7 días</button></div>
    <div id="calBody"></div>
    <div class="cal-legend"><span><i class="sdot ok"></i>Validado</span><span><i class="sdot plan"></i>Según plan</span><span><i class="sdot amb"></i>Fuera del plan</span><span><i class="sdot none"></i>Sin validar</span><span><span style="color:var(--blue);font-size:10px">◆</span>Control</span><span><i class="sdot" style="border-radius:2px;background:var(--ink-3);opacity:.7"></i>Entreno</span></div>`, {
    bind: (sh) => {
      paint(sh);
      $$('[data-jump]', sh).forEach((b) => b.addEventListener('click', () => pick(addDays(today, -b.dataset.jump))));
    },
  });
}
const shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

// ---------------------------------------------------------------- Día
const LI = {
  meals: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v6M9 3v6M17 21V3c-2 0-4 3-4 7s2 4 4 4"/></svg>',
  train: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 7v10M3 9.5v5M18 7v10M21 9.5v5M6 12h12"/></svg>',
  steps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 3c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5zM6 16h4v2a2 2 0 0 1-4 0zM16 7c2 0 3 2 3 5s-1 5-3 5-3-2-3-5 1-5 3-5zM14 20h4"/></svg>',
  sleep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>',
  supp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="m8.5 8.5 7 7"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 4h14v16H5zM9 9h6M9 13h6M9 17h3"/></svg>',
  bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z"/></svg>',
};

/** Una frase con lo más útil del día (sin juzgar). [tono, html] */
function insightFor(ctx, date, day, t, all) {
  const st = dayState(ctx, date);
  if (date !== ctx.today()) {
    const ds = dietStatus(day);
    if (st === 'ok') return ['ok', `Día validado: lo apuntado es todo (${fmtK(all.kcal)} kcal · ${fmtK(all.p)} g de proteína).`];
    if (st === 'plan') return ['ok', 'Día validado: comiste según el plan.'];
    if (st === 'amb') return ['a', `Día validado: ${ds.status === 'over' ? 'por encima' : 'por debajo'} del plan${typeof ds.kcal_delta === 'number' ? ` (${signed(ds.kcal_delta, 0)} kcal)` : ''}.`];
    return ['b', 'Este día está sin validar. Ciérralo con «Revisar este día» para que cuente bien en el gasto.'];
  }
  if (day.weight == null) return ['b', 'Pésate en ayunas y apúntalo: es lo que mueve tu tendencia.'];
  // kcal y proteína del plan son opcionales; el aviso por pasarse de kcal, solo si el objetivo es perder
  const goal = goalOf(planFor(ctx.store.get(FILES.plan), date));
  const hasK = t.kcal != null, hasP = t.p != null;
  if (!all.kcal) {
    const want = [hasK && `<b>${fmtK(t.kcal)} kcal</b>`, hasP && `<b>${fmtK(t.p)} g de proteína</b>`].filter(Boolean).join(' y ');
    return ['b', `${want ? `Objetivo de hoy: ${want}. ` : ''}Apunta la primera comida en «Comidas».`];
  }
  const lk = hasK ? t.kcal - all.kcal : null, lp = hasP ? t.p - all.p : null;
  if (goal === 'loss' && hasK && lk < -t.kcal * 0.1) return ['a', `Vas ${fmtK(-lk)} kcal por encima del objetivo de hoy.`];
  if (hasP && lp > 10) return ['b', `Te faltan <b>${fmtK(lp)} g de proteína</b>${hasK && lk > 0 ? ` y quedan ${fmtK(lk)} kcal` : ''}.`];
  const pOk = hasP ? 'Proteína cumplida. ' : '';
  if (!hasK) return ['ok', `${pOk}Llevas ${fmtK(all.kcal)} kcal${hasP ? '' : ` y ${fmtK(all.p)} g de proteína`}.`];
  if (Math.abs(lk) <= t.kcal * 0.1) return ['ok', `Día en rango: kcal dentro de ±10 %${hasP ? ' y proteína cumplida' : ''}.`];
  if (lk > 0) return [goal === 'gain' ? 'b' : 'ok', `${pOk}Quedan ${fmtK(lk)} kcal.`];
  return ['ok', `${pOk}Llevas ${fmtK(all.kcal)} kcal.`];
}

function renderDay(ctx) {
  const date = ctx.state.date, isToday = date === ctx.today();
  const day = ctx.store.day(date);
  const prev = ctx.store.day(addDays(date, -1));
  const a = ctx.analysis();
  const v = planFor(ctx.store.get(FILES.plan), date);
  const due = isToday && isDue(ctx);
  const supp = v?.supplements || [];
  const taken = new Set(day.supplements_taken || []);
  const nTaken = [...taken].filter((n) => supp.some((s) => s.name === n)).length;
  const mealsLogged = (day.meals || []).filter((m) => m.items?.length);
  const mp = mealPlan(v);
  const slots = mp.mode === 'fixed' ? mp.list.length : 0;
  const all = sumItems(mealsLogged.flatMap((m) => m.items));
  const t = v ? dayTargets(v, day.trained) : { kcal: null, p: null };
  const goal = goalOf(v);
  const sets = (day.session?.sets || []).filter((s) => !s.warmup).length;
  const ds = dietStatus(day);

  // resumen: anillos de kcal y proteína + peso de tendencia (el de ese día)
  const i = a.empty ? -1 : a.span.indexOf(date);
  const tr = i >= 0 ? a.trend[i] : null;
  const rate = tr ? weeklyRate(tr) : null;
  const spark = i >= 0 ? a.trend.slice(Math.max(0, i - 27), i + 1).map((x) => x?.level ?? null) : [];
  // hoy: lo que queda; pasarse solo se cuenta («kcal de más») si el objetivo es perder
  const left = isToday && t.kcal != null && (all.kcal <= t.kcal || goal === 'loss');
  const kRing = donut({ pct: t.kcal ? all.kcal / t.kcal : 0, size: 108, stroke: 11, color: meals.kcalColor(v, all.kcal, t.kcal),
    big: left ? fmtK(Math.abs(t.kcal - all.kcal)) : fmtK(all.kcal), sm: left ? (all.kcal > t.kcal ? 'kcal de más' : 'kcal quedan') : t.kcal != null ? `de ${fmtK(t.kcal)}` : 'kcal' });
  const pRing = donut({ pct: t.p ? all.p / t.p : 0, size: 84, stroke: 9, color: 'var(--blue)', big: fmtK(all.p), sm: t.p != null ? `de ${fmtK(t.p)} g` : 'g', sm2: 'proteína' });
  const fav = rate ? favours(goal, rate.kgWeek) : null;
  const hero = v ? `<div class="card hero2">${kRing}${pRing}<div class="wtr"><span class="k">Tendencia</span><span class="big num">${tr ? fmt(tr.level) : '—'}<small> kg</small></span>${rate && a.latest.rateReliable ? `<span class="rt num" style="color:${fav === true ? 'var(--accent)' : fav === false ? 'var(--slate)' : 'var(--ink-2)'}">${rate.kgWeek <= 0 ? '↓' : '↑'} ${fmt(Math.abs(rate.kgWeek), 2)} kg/sem</span>` : `<span class="rt muted">${a.latest.dataDays ? `ritmo fiable en ${Math.max(0, 14 - a.latest.dataDays)} días` : ''}</span>`}${sparkline(spark, { w: 96, h: 28 })}</div></div>` : '';
  const [tone, text] = insightFor(ctx, date, day, t, all);

  const line = (id, ic, label, subl, value, done, bar = null) => `<button class="dl v1 ${done ? 'done' : ''}" id="${id}"><span class="ic">${ic}</span><span class="dl-l">${label}${subl ? `<small>${subl}</small>` : ''}${bar != null ? `<span class="mbar"><i style="width:${Math.min(100, bar * 100)}%"></i></span>` : ''}</span><span class="dl-v">${value}</span><span class="go">${icon.chevron}</span></button>`;
  const steps = v?.targets?.steps;
  const checklist = `<div class="card" style="padding:4px 16px">
    ${line('dlMeals', LI.meals, 'Comidas', mealsLogged.length ? `${mealsLogged.length}${slots ? ` de ${slots}` : ''} apuntadas${ds?.status === 'logged' ? ' · día cerrado' : ''}` : 'Nada apuntado', mealsLogged.length ? `${fmtK(all.kcal)}<small>kcal</small>` : '', ds?.status === 'logged', t.kcal ? all.kcal / t.kcal : null)}
    ${line('dlTrain', LI.train, 'Entreno', day.trained === false ? 'Descanso' : day.trained === true ? esc(day.session?.day || 'Hecho') : 'Sin marcar', sets ? `${sets}<small>series</small>` : '', day.trained != null)}
    ${line('dlSteps', LI.steps, 'Pasos', steps ? `Objetivo ${fmtK(steps)}` : '', day.steps != null ? fmtK(day.steps) : 'Añadir', day.steps != null, steps && day.steps != null ? day.steps / steps : null)}
    ${line('dlSleep', LI.sleep, 'Sueño', v?.targets?.sleep_h ? `Objetivo ${fmt(v.targets.sleep_h)} h` : '', day.sleep_h != null ? `${fmt(day.sleep_h)} h` : 'Añadir', day.sleep_h != null)}
    ${supp.length ? line('dlSupp', LI.supp, 'Suplementos', esc(supp.map((x) => x.name).join(' · ')), `${nTaken}/${supp.length}`, nTaken === supp.length) : ''}
    ${line('dlNote', LI.note, 'Nota', day.note ? esc(day.note.slice(0, 40)) + (day.note.length > 40 ? '…' : '') : '', day.note ? '' : 'Añadir', !!day.note)}
  </div>
  <button class="btn ${ds ? 'secondary' : 'primary'}" id="closeDay" style="margin-bottom:12px">${ds ? `${icon.check} Día revisado · ${esc({ logged: 'lo apuntado es todo', plan: 'según plan', over: 'me pasé', under: 'me quedé corto', unknown: 'no lo sé' }[ds.status])}` : isToday ? 'Revisar y cerrar el día' : 'Revisar este día'}</button>`;

  // guía de primer uso: lo que falta configurar para que los cálculos tengan sentido
  const cfg = ctx.store.get(FILES.config) || {};
  const setup = [
    [!cfg.profile?.height_cm || !cfg.profile?.birth_year, 'Tu perfil (altura, año de nacimiento)', 'setProfile'],
    // con «Sin objetivo» no se pide dieta; el peso objetivo solo tiene sentido al perder o ganar
    [goal !== 'none' && v?.diet?.kcal?.train === 2800 && v?.diet?.kcal?.rest === 2500 && v?.diet?.protein_g === 200, 'Tu dieta (kcal y macros)', 'setDiet'],
    [!(v?.routine?.days || []).length, 'Tu rutina', 'setRoutine'],
    [(goal === 'loss' || goal === 'gain') && !v?.targets?.weight_kg, 'Tus objetivos (peso, pasos, sesiones)', 'setTargets'],
  ].filter(([todo]) => todo);
  const setupCard = setup.length && isToday ? `<div class="card" style="border-color:var(--accent)">
    <div class="ch"><h2>Termina de configurar</h2><span class="aux">${setup.length} por hacer</span></div>
    ${setup.map(([, label, id]) => `<button class="dl" id="${id}"><i class="st"></i><span class="dl-l" style="grid-column:span 2">${label}</span><span class="go">${icon.chevron}</span></button>`).join('')}
  </div>` : '';

  const weightCard = `<div class="card wcard">
    <div><label for="wIn">Peso en ayunas</label><div class="weight"><input id="wIn" inputmode="decimal" enterkeyhint="done" placeholder="—" value="${day.weight != null ? fmt(day.weight) : ''}" aria-label="Peso en kilos"><span class="u">kg</span></div>
      <div class="muted">${prev.weight != null ? `Día anterior ${fmt(prev.weight)} kg` : ''}</div></div>
    <button class="btn ${day.weight != null ? 'secondary' : 'primary'}" id="saveW">${icon.check}${day.weight != null ? 'Cambiar' : 'Guardar'}</button>
  </div>`;

  return `
  ${setupCard}
  ${due ? `<button class="sunday" id="goControl"><span class="ic">${icon.sunday}</span><div><b>Toca el control semanal</b><span>Revisa la semana, mídete y decide</span></div><span class="go">${icon.chevron}</span></button>` : ''}
  ${hero}
  <div class="insight ${tone === 'ok' ? 'ok' : tone === 'a' ? 'a' : ''}">${tone === 'ok' ? icon.check : LI.bulb}<span>${text}</span></div>
  ${weightCard}
  ${checklist}
  ${supp.length ? `<div class="card" id="suppCard"><div class="ch"><h2>Suplementos y medicación</h2><span class="aux">${nTaken}/${supp.length}</span></div>
    ${supp.map((x) => `<label class="chk"><input type="checkbox" data-supp="${esc(x.name)}" ${taken.has(x.name) ? 'checked' : ''}><div><b>${esc(x.name)}</b><small>${esc([x.dose, x.timing].filter(Boolean).join(' · '))}</small></div>${x.kind === 'medication' ? '<span class="badge b t">Medicación</span>' : ''}</label>`).join('')}
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

