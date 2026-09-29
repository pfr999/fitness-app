// Hoy → Entreno: la sesión del día con registro de series (kg, reps, RPE), la última marca de cada
// ejercicio como referencia y la sugerencia de subir carga (doble progresión).

import { $, $$, esc, fmt, num, int, toast, openSheet, closeSheet, bindSeg, icon, ask } from '../ui/ui.js';
import { addDays, fmtShort, range } from '../dates.js';
import { FILES, planFor, newPlanVersion } from '../model.js';
import { startRest, stopRest } from '../ui/rest.js';
import { resolveExercise, progressionHint } from '../engine/training.js';
import { exercisesOf, datalist, assignSheet } from './exercises.js';

const keyOf = (ref, exs) => resolveExercise(ref, exs)?.id || `n:${String(ref.name).toLowerCase().trim()}`;

/** Series de un ejercicio en la última sesión anterior a `date` (hasta 90 días atrás). */
function lastSets(ctx, date, key, exs) {
  const days = ctx.store.allDays();
  for (const d of range(addDays(date, -90), addDays(date, -1)).reverse()) {
    const sets = (days[d]?.session?.sets || []).filter((s) => !s.warmup && keyOf(s, exs) === key);
    if (sets.length) return { date: d, sets: sets.sort((a, b) => (a.i ?? 0) - (b.i ?? 0)) };
  }
  return null;
}

function suggestedDay(ctx, date, days) {
  const all = ctx.store.allDays();
  const last = range(addDays(date, -10), addDays(date, -1)).reverse().map((d) => all[d]?.session?.day).find(Boolean);
  if (!last) return days[0]?.name;
  const i = days.findIndex((d) => d.name === last);
  return days[(i + 1) % days.length]?.name;
}

const fmtSet = (s) => `${fmt(s.kg, s.kg % 1 ? 1 : 0)} × ${s.reps}${s.rpe != null ? ` @${fmt(s.rpe, s.rpe % 1 ? 1 : 0)}` : ''}`;

/** Mejor peso para cada número de repeticiones (series efectivas) antes de `date`. */
function recordsByReps(ctx, date, key, exs) {
  const days = ctx.store.allDays(), out = {};
  for (const d of Object.keys(days)) {
    if (d >= date) continue;
    for (const s of days[d]?.session?.sets || []) {
      if (s.warmup || !(s.reps > 0) || s.kg == null || keyOf(s, exs) !== key) continue;
      if (out[s.reps] == null || s.kg > out[s.reps].kg) out[s.reps] = { kg: s.kg, date: d };
    }
  }
  return out;
}

const prefsOf = (ctx) => ctx.store.get(FILES.exercises)?.prefs || {};
function setPref(ctx, key, patch, msg) {
  ctx.store.update(FILES.exercises, (doc) => {
    doc = doc && typeof doc === 'object' ? doc : {};
    doc.items ||= []; doc.prefs ||= {};
    const cur = { ...(doc.prefs[key] || {}), ...patch };
    for (const k of Object.keys(cur)) if (cur[k] == null || cur[k] === '') delete cur[k];
    if (Object.keys(cur).length) doc.prefs[key] = cur; else delete doc.prefs[key];
    return doc;
  }, msg);
}
const DEFAULT_REST = 120, WARMUP_REST = 60;
const RPES = [6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
const rpeColor = (v) => ['#5B9C7E', '#6FA56F', '#8EAA5C', '#B7A54B', '#D29A3E', '#DB8433', '#D96A2E', '#CF4F2C', '#B93A2B'][Math.round((v - 6) * 2)] || 'var(--ink-3)';
const kgTxt = (kg) => fmt(kg, kg % 1 ? 1 : 0);

export function render(ctx) {
  const date = ctx.state.date;
  const v = planFor(ctx.store.get(FILES.plan), date);
  const days = v?.routine?.days || [];
  const day = ctx.store.day(date);
  const exs = exercisesOf(ctx);
  if (!days.length && !day.session?.sets?.length) return `<div class="card empty"><b>Sin rutina</b>Añádela en Plan → Rutina.</div>`;
  const sel = ctx.state.trainDay && days.some((d) => d.name === ctx.state.trainDay) ? ctx.state.trainDay : day.session?.day || suggestedDay(ctx, date, days);
  const rd = days.find((d) => d.name === sel) || days[0] || { name: 'Sesión', items: [] };
  const logged = day.session?.sets || [];
  const open = (ctx.state.openEx ||= {});
  const prefs = prefsOf(ctx);
  const swap = day.session?.swap || {};
  const isToday = date === ctx.today();

  // ejercicios de la rutina (con los cambios de hoy) + extras registrados o añadidos hoy
  const groups = rd.items.map((it) => {
    const to = swap[it.name];
    const it2 = to ? { ...it, name: to, ex: undefined, swappedFrom: it.name } : it;
    return { it: it2, key: keyOf(it2, exs), extra: false };
  });
  const extras = new Map();
  for (const s of logged) { const k = keyOf(s, exs); if (!groups.some((g) => g.key === k) && !extras.has(k)) extras.set(k, { it: { name: s.name, ex: s.ex, sets: 1 }, key: k, extra: true }); }
  for (const name of ctx.state.extraEx?.[date] || []) { const k = keyOf({ name }, exs); if (!groups.some((g) => g.key === k) && !extras.has(k)) extras.set(k, { it: { name, sets: 3 }, key: k, extra: true }); }
  const all = [...groups, ...extras.values()];
  const workOf = (g) => logged.filter((s) => keyOf(s, exs) === g.key && !s.warmup).length;
  const firstPending = all.find((g) => workOf(g) < (g.it.sets || 1));

  const block = (g, idx) => {
    const mine = logged.filter((s) => keyOf(s, exs) === g.key).sort((a, b) => (a.i ?? 0) - (b.i ?? 0));
    const prev = lastSets(ctx, date, g.key, exs);
    const planned = g.it.sets || 1;
    const n = Math.max(planned, mine.length ? Math.max(...mine.map((s) => (s.i ?? 0) + 1)) : 0, ctx.state.extraSets?.[`${date}|${g.key}`] || 0);
    const doneN = workOf(g);
    const done = doneN >= planned;
    const isOpen = open[`${date}|${g.key}`] ?? g === firstPending;
    const hint = prev && progressionHint(prev.sets, g.it);
    const known = !!resolveExercise(g.it, exs);
    const pref = prefs[g.key] || {};
    let wn = 0;
    const nowK = isOpen && isToday ? Array.from({ length: n }, (_, k) => k).find((k) => !mine.some((x) => (x.i ?? 0) === k)) : -1;
    const rows = Array.from({ length: n }, (_, k) => {
      const s = mine.find((x) => (x.i ?? 0) === k);
      const w = !!s?.warmup;
      const label = w ? 'W' : ++wn;
      const p = prev?.sets.find((x) => (x.i ?? 0) === k) || prev?.sets[prev.sets.length - 1];
      const sug = hint ? { kg: hint.kg, reps: g.it.reps?.[0] ?? p?.reps } : null;
      const ph = sug || p;
      return `<div class="set-row v2 ${s ? 'done' : ''} ${k === nowK ? 'now' : ''} ${w ? 'w' : ''}" data-set="${esc(g.key)}|${k}" data-w="${w ? 1 : 0}" data-rpe="${s?.rpe ?? ''}">
        <button type="button" class="sn" data-wt aria-label="Serie ${k + 1}: tocar para marcarla de calentamiento">${label}</button>
        <button type="button" class="pv" data-prev ${p ? '' : 'disabled'}>${p ? `${kgTxt(p.kg)} × ${p.reps}` : '—'}</button>
        <input inputmode="decimal" data-f="kg" aria-label="kg serie ${k + 1}" value="${s?.kg != null ? kgTxt(s.kg) : ''}" placeholder="${ph?.kg != null ? kgTxt(ph.kg) : 'kg'}" class="${sug && !s ? 'sug' : ''}" enterkeyhint="next">
        <input inputmode="numeric" data-f="reps" aria-label="reps serie ${k + 1}" value="${s?.reps ?? ''}" placeholder="${ph?.reps ?? 'reps'}" class="${sug && !s ? 'sug' : ''}" enterkeyhint="done">
        <button type="button" class="rpeb ${s?.rpe != null ? 'v' : ''}" data-rpeb style="${s?.rpe != null ? `background:${rpeColor(s.rpe)};` : ''}${w ? 'visibility:hidden' : ''}">${s?.rpe != null ? fmt(s.rpe, s.rpe % 1 ? 1 : 0) : 'RPE'}</button>
        <button type="button" class="mini ${s ? 'ok' : ''}" data-same aria-label="Serie ${k + 1} hecha">${icon.check}</button></div>
        <div class="rpes" hidden><span>RPE</span>${RPES.map((r) => `<button type="button" data-rv="${r}" style="background:${rpeColor(r)}">${fmt(r, r % 1 ? 1 : 0)}</button>`).join('')}</div>`;
    }).join('');
    const best = prev ? prev.sets.reduce((a, b) => (b.kg > a.kg ? b : a)) : null;
    return `<div class="ex v2 ${isOpen ? 'open' : ''} ${done ? 'finished' : ''}" data-ex="${esc(g.key)}" data-name="${esc(g.it.name)}" data-rest="${pref.rest || ''}">
      <div class="ex-hd"><button class="ex-h" data-toggle="${esc(date)}|${esc(g.key)}"><span class="ex-n ${done ? 'done' : ''}">${done ? '✓' : idx + 1}</span>
        <span class="ex-t"><b>${esc(g.it.name)}</b><span>${g.extra ? 'Extra' : `${esc(planned)} × ${esc((g.it.reps || []).join('–'))}${g.it.rpe ? ` · RPE ${esc(g.it.rpe)}` : ''}`}${g.it.swappedFrom ? ` · en vez de ${esc(g.it.swappedFrom)}` : ''}${best && !isOpen ? ` · última ${esc(fmtSet(best))}` : ''}</span></span>
        <span class="cnt">${doneN}/${planned}</span></button>
        <button class="mini exm" data-exmenu="${idx}" aria-label="Opciones de ${esc(g.it.name)}">⋯</button></div>
      <div class="sets">
        ${pref.note ? `<div class="tip pin"><span>📌 ${esc(pref.note)}</span></div>` : ''}
        ${g.it.note ? `<div class="tip a" style="margin:0 0 8px"><span>${esc(g.it.note)}</span></div>` : ''}
        ${hint ? `<div class="tip" style="margin:0 0 8px"><span>↑ La última vez (${esc(fmtShort(prev.date))}) llegaste al tope del rango: toca <b>${kgTxt(hint.kg)} kg</b>. En verde, lo sugerido.</span></div>` : ''}
        ${!known ? `<div class="tip a" style="margin:0 0 8px"><span>Este ejercicio no tiene músculos asignados: sus series no cuentan en el volumen. <button class="link" data-assign="${esc(g.it.name)}" style="padding:0">Asignar</button></span></div>` : ''}
        <div class="set-hdr v2"><span>Serie</span><span>Antes</span><span>kg</span><span>reps</span><span>RPE</span><span></span></div>
        ${rows}
        <button class="link" data-addset="${esc(date)}|${esc(g.key)}" style="padding:6px 0">+ Serie</button>
      </div>
    </div>`;
  };

  const trained = day.trained === true && day.session?.day === rd.name;
  const nWork = logged.filter((s) => !s.warmup).length;
  const nPlan = all.reduce((a, g) => a + (g.it.sets || 1), 0);
  ctx.state._workGroups = all;
  return `${days.length ? `<div class="daytabs" id="trainDays">${days.map((d) => `<button data-v="${esc(d.name)}" class="${d.name === rd.name ? 'on' : ''}">${esc(d.name)}</button>`).join('')}</div>` : ''}
    <div class="card">
      <div class="ch"><h2>${esc(rd.name)}</h2><span class="aux" id="sessCount">${nWork} de ${nPlan} series</span></div>
      <div class="muted small" style="margin:-4px 0 10px">«Antes» es tu última sesión (tócalo para copiarlo). <b>✓</b> apunta lo que ves; si hiciste otra cosa, escríbelo. Toca el número para marcar una serie de calentamiento (W).</div>
      ${all.map(block).join('')}
      <button class="btn secondary sm" id="addExtra" style="width:100%;margin-top:10px">${icon.plus} Ejercicio extra</button>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px">
        <button class="btn ${trained ? 'secondary' : 'primary'}" id="sessDone">${trained ? 'Sesión hecha ✓' : 'Sesión hecha'}</button>
        <button class="btn secondary" id="sessRest">Hoy descanso</button>
      </div>
    </div>`;
}

export function bind(root, ctx) {
  const date = ctx.state.date;
  const exs = exercisesOf(ctx);
  const rdName = () => $('#trainDays button.on', root)?.dataset.v || ctx.store.day(date).session?.day || 'Sesión';
  bindSeg(root, '#trainDays', (v) => { ctx.state.trainDay = v; ctx.render(); });
  $$('[data-toggle]', root).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.toggle;
    const el = b.closest('.ex');
    el.classList.toggle('open');
    ctx.state.openEx[k] = el.classList.contains('open');
  }));
  $$('[data-addset]', root).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.addset;
    (ctx.state.extraSets ||= {})[k] = $$('.set-row', b.closest('.ex')).length + 1; // una fila más de las que hay
    ctx.state.openEx[k] = true;
    ctx.render();
  }));
  $$('[data-assign]', root).forEach((b) => b.addEventListener('click', () => assignSheet(ctx, b.dataset.assign, () => ctx.render())));
  $$('[data-exmenu]', root).forEach((b) => b.addEventListener('click', () => exerciseMenu(ctx, date, ctx.state._workGroups[+b.dataset.exmenu], rdName())));
  const recs = new Map();
  const recsFor = (key) => { if (!recs.has(key)) recs.set(key, recordsByReps(ctx, date, key, exs)); return recs.get(key); };

  const paintCounts = (group) => {
    const rows = $$('.set-row', group);
    const saved = rows.filter((r) => $('[data-same]', r).classList.contains('ok') && r.dataset.w !== '1').length;
    const cnt = group.querySelector('.cnt');
    const planned = +cnt.textContent.split('/')[1];
    cnt.textContent = `${saved}/${planned}`;
    const n = group.querySelector('.ex-n');
    n.classList.toggle('done', saved >= planned);
    if (saved >= planned) n.textContent = '✓';
    const total = $$('.set-row', root).filter((r) => $('[data-same]', r).classList.contains('ok') && r.dataset.w !== '1').length;
    const sc = $('#sessCount', root);
    if (sc) sc.textContent = sc.textContent.replace(/^\d+/, String(total));
    // la serie «actual»: la primera sin hacer de este ejercicio
    rows.forEach((r) => r.classList.remove('now'));
    rows.find((r) => !$('[data-same]', r).classList.contains('ok'))?.classList.add('now');
  };

  // guardar una serie cuando tiene kg y reps (o borrarla si se vacía)
  $$('.set-row', root).forEach((row) => {
    const btn = $('[data-same]', row);
    const chips = row.nextElementSibling;
    const group = row.closest('.ex');
    const save = ({ fromCheck = false } = {}) => {
      const [key, kStr] = row.dataset.set.split(/\|(?=\d+$)/);
      const k = +kStr;
      const kg = num($('[data-f="kg"]', row).value), reps = int($('[data-f="reps"]', row).value);
      const rpe = row.dataset.rpe === '' ? null : +row.dataset.rpe;
      const warm = row.dataset.w === '1';
      const name = group.dataset.name;
      const ex = resolveExercise({ name }, exs) || (key.startsWith('n:') ? null : exs.find((e) => e.id === key));
      if (kg != null && (kg < 0 || kg > 1000)) { toast('Peso no válido'); return false; }
      if (reps != null && (reps < 0 || reps > 100)) { toast('Repeticiones no válidas'); return false; }
      const complete = kg != null && reps != null;
      const wasOk = btn.classList.contains('ok');
      ctx.store.updateDay(date, (d) => {
        d.session ||= { day: rdName(), sets: [] };
        d.session.day ||= rdName();
        d.session.sets = (d.session.sets || []).filter((s) => !(keyOf(s, exs) === key && (s.i ?? 0) === k));
        if (complete) {
          d.session.sets.push({ ...(ex ? { ex: ex.id } : {}), name, i: k, kg, reps, ...(rpe != null ? { rpe } : {}), ...(warm ? { warmup: true } : {}) });
          d.trained = true;
        }
        if (!d.session.sets.length && !d.session.swap) delete d.session;
      }, `Entreno ${fmtShort(date)}: ${name}${complete ? ` ${kgTxt(kg)}×${reps}${warm ? ' (calentamiento)' : ''}` : ''}`);
      btn.classList.toggle('ok', complete);
      row.classList.toggle('done', complete);
      paintCounts(group);
      if (complete && fromCheck && !wasOk) {
        try { navigator.vibrate?.(15); } catch { /* */ }
        startRest(warm ? WARMUP_REST : +group.dataset.rest || DEFAULT_REST, group.dataset.name);
        // récord para ese número de repeticiones
        const r = recsFor(key);
        if (!warm && r[reps] && kg > r[reps].kg) {
          toast(`🏆 Récord a ${reps} reps: ${kgTxt(kg)} kg (antes ${kgTxt(r[reps].kg)})`);
          try { navigator.vibrate?.([30, 60, 30]); } catch { /* */ }
          r[reps] = { kg, date };
        }
        if (!warm && rpe == null) { $$('.rpes', root).forEach((c) => { c.hidden = true; }); chips.hidden = false; }
      }
      return complete;
    };
    $$('input', row).forEach((inp) => {
      inp.addEventListener('change', () => save());
      inp.addEventListener('focus', () => { inp.select(); setTimeout(() => row.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250); });
    });
    $('[data-prev]', row).addEventListener('click', (e) => {
      const m = e.currentTarget.textContent.match(/([\d,.]+) × (\d+)/);
      if (!m) return;
      $('[data-f="kg"]', row).value = m[1]; $('[data-f="reps"]', row).value = m[2];
      save();
    });
    $('[data-wt]', row).addEventListener('click', (e) => {
      const w = row.dataset.w !== '1';
      row.dataset.w = w ? '1' : '0';
      row.classList.toggle('w', w);
      e.currentTarget.textContent = w ? 'W' : String(+row.dataset.set.split('|').pop() + 1);
      $('[data-rpeb]', row).style.visibility = w ? 'hidden' : '';
      if (btn.classList.contains('ok')) save();
      toast(w ? 'Serie de calentamiento: no cuenta en volumen ni récords' : 'Serie efectiva');
    });
    $('[data-rpeb]', row).addEventListener('click', () => { const was = chips.hidden; $$('.rpes', root).forEach((c) => { c.hidden = true; }); chips.hidden = !was; });
    $$('[data-rv]', chips).forEach((b) => b.addEventListener('click', () => {
      const r = +b.dataset.rv;
      row.dataset.rpe = String(r);
      const rb = $('[data-rpeb]', row);
      rb.textContent = fmt(r, r % 1 ? 1 : 0); rb.classList.add('v'); rb.style.background = rpeColor(r);
      chips.hidden = true;
      if (btn.classList.contains('ok')) save();
    }));
    btn.addEventListener('click', () => {
      if (btn.classList.contains('ok')) return save({ fromCheck: true });
      // «serie hecha»: lo que esté vacío se rellena con lo que se ve (sugerido o última vez) y se guarda
      $$('input', row).forEach((inp) => { if (!inp.value && /\d/.test(inp.placeholder)) inp.value = inp.placeholder; });
      if (!save({ fromCheck: true })) {
        const kg = $('[data-f="kg"]', row), reps = $('[data-f="reps"]', row);
        toast('Pon los kg y las repeticiones');
        (kg.value ? reps : kg).focus();
      }
    });
  });

  $('#addExtra', root)?.addEventListener('click', () => {
    openSheet(`<h3>Ejercicio extra</h3><div class="muted">Uno que no está en la rutina de hoy.</div>
      ${datalist(ctx)}
      <div class="field" style="margin-top:12px"><label for="xName">Ejercicio</label><input class="inp" id="xName" list="exList" autocomplete="off" autofocus placeholder="Empieza a escribir"></div>
      <button class="btn primary" id="xAdd" style="margin-top:12px">Añadir</button>`, {
      bind: (sh) => $('#xAdd', sh).addEventListener('click', () => {
        const name = $('#xName', sh).value.trim();
        if (!name) return toast('Escribe un ejercicio');
        ((ctx.state.extraEx ||= {})[date] ||= []).push(name);
        ctx.state.openEx[`${date}|${keyOf({ name }, exs)}`] = true;
        closeSheet(); ctx.render();
      }),
    });
  });
  $('#sessDone', root)?.addEventListener('click', () => {
    const name = rdName();
    ctx.store.updateDay(date, (d) => { d.trained = true; d.session = { ...(d.session || { sets: [] }), day: name }; }, `Entreno ${fmtShort(date)}: ${name}`);
    stopRest();
    toast(`${name}: hecha`); ctx.render();
  });
  $('#sessRest', root)?.addEventListener('click', async () => {
    if ((ctx.store.day(date).session?.sets || []).length && !(await ask({ title: '¿Marcar descanso?', text: 'Hay series apuntadas hoy. Se borrarán.', ok: 'Borrar y marcar', danger: true }))) return;
    ctx.store.updateDay(date, (d) => { d.trained = false; delete d.session; }, `Descanso ${fmtShort(date)}`);
    toast('Día de descanso'); ctx.render();
  });
}

// ---------------------------------------------------------------- opciones de un ejercicio
function exerciseMenu(ctx, date, g, rdName) {
  if (!g) return;
  const exs = exercisesOf(ctx);
  const pref = prefsOf(ctx)[g.key] || {};
  const orig = g.it.swappedFrom || g.it.name;
  openSheet(`<h3>${esc(g.it.name)}</h3>${g.it.swappedFrom ? `<div class="muted">Hoy en vez de ${esc(g.it.swappedFrom)}</div>` : ''}
    ${datalist(ctx)}
    <div class="stack" style="margin-top:12px">
      <div class="field"><label>Descanso entre series</label><div class="chipset sm" id="rstSeg">${[60, 90, 120, 150, 180, 240].map((s) => `<button type="button" data-v="${s}" class="${(pref.rest || DEFAULT_REST) === s ? 'on' : ''}">${s < 120 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</button>`).join('')}</div></div>
      <div class="field"><label for="exNote">Nota fija (sale siempre en este ejercicio)</label><textarea class="inp" id="exNote" style="min-height:64px" placeholder="p. ej. Banco en la muesca 3 · agarre a palmo y medio">${esc(pref.note || '')}</textarea></div>
      <button class="btn secondary" id="exNoteSave">Guardar nota</button>
      ${g.extra ? '' : `<div class="grp">Cambiar por otro ejercicio</div>
      <div class="field"><input class="inp" id="swName" list="exList" autocomplete="off" placeholder="Empieza a escribir"></div>
      <div class="g2"><button class="btn secondary" id="swToday">Solo hoy</button><button class="btn secondary" id="swPlan">A partir de ahora</button></div>
      ${g.it.swappedFrom ? '<button class="link" id="swUndo">Volver al de la rutina</button>' : ''}
      <div class="hint">«A partir de ahora» cambia la rutina y crea una versión nueva del plan.</div>`}
      <button class="btn secondary" id="exHist">Historial y récords</button>
    </div>`, {
    bind: (sh) => {
      bindSeg(sh, '#rstSeg', (v) => { setPref(ctx, g.key, { rest: +v === DEFAULT_REST ? null : +v }, `Descanso ${g.it.name}: ${v} s`); toast(`Descanso: ${v} s`); ctx.render(); });
      $('#exNoteSave', sh).addEventListener('click', () => { setPref(ctx, g.key, { note: $('#exNote', sh).value.trim() || null }, `Nota de ${g.it.name}`); closeSheet(); toast('Nota guardada'); ctx.render(); });
      const newName = () => { const n = $('#swName', sh).value.trim(); if (!n) toast('Escribe el ejercicio nuevo'); return n; };
      $('#swToday', sh)?.addEventListener('click', () => {
        const to = newName(); if (!to) return;
        ctx.store.updateDay(date, (d) => { d.session ||= { day: rdName, sets: [] }; d.session.swap = { ...(d.session.swap || {}), [orig]: to }; }, `Entreno ${fmtShort(date)}: ${orig} → ${to} (solo hoy)`);
        closeSheet(); toast(`Hoy: ${to} en vez de ${orig}`); ctx.render();
      });
      $('#swPlan', sh)?.addEventListener('click', () => {
        const to = newName(); if (!to) return;
        ctx.store.update(FILES.plan, (doc) => newPlanVersion(doc, { reason: `Rutina: ${orig} → ${to}`, mutate: (v) => {
          for (const d of v.routine?.days || []) for (const it of d.items || []) if (it.name === orig) { it.name = to; delete it.ex; const e = resolveExercise({ name: to }, exs); if (e) it.ex = e.id; }
        } }), `Plan: ${orig} → ${to}`);
        ctx.store.updateDay(date, (d) => { if (d.session?.swap) { delete d.session.swap[orig]; if (!Object.keys(d.session.swap).length) delete d.session.swap; } }, `Entreno ${fmtShort(date)}: quita cambio temporal`);
        closeSheet(); toast(`Rutina cambiada: ${to}`); ctx.render();
      });
      $('#swUndo', sh)?.addEventListener('click', () => {
        ctx.store.updateDay(date, (d) => { if (d.session?.swap) { delete d.session.swap[orig]; if (!Object.keys(d.session.swap).length) delete d.session.swap; } if (d.session && !d.session.sets?.length && !d.session.swap) delete d.session; }, `Entreno ${fmtShort(date)}: vuelve a ${orig}`);
        closeSheet(); ctx.render();
      });
      $('#exHist', sh).addEventListener('click', () => historySheet(ctx, date, g));
    },
  });
}

function historySheet(ctx, date, g) {
  const exs = exercisesOf(ctx);
  const recs = recordsByReps(ctx, addDays(date, 1), g.key, exs);
  const days = ctx.store.allDays();
  const sessions = Object.keys(days).filter((d) => d <= date).sort().reverse()
    .map((d) => ({ d, sets: (days[d]?.session?.sets || []).filter((s) => !s.warmup && keyOf(s, exs) === g.key).sort((a, b) => (a.i ?? 0) - (b.i ?? 0)) }))
    .filter((x) => x.sets.length).slice(0, 8);
  const reps = Object.keys(recs).map(Number).sort((a, b) => a - b);
  openSheet(`<h3>${esc(g.it.name)}</h3><div class="muted">Récords por repeticiones y últimas sesiones.</div>
    ${reps.length ? `<div class="grp">Récords</div><table class="t"><thead><tr><th>Reps</th><th style="text-align:right">Mejor peso</th><th style="text-align:right">Fecha</th></tr></thead><tbody>${reps.map((r) => `<tr><td>${r}</td><td class="n">${kgTxt(recs[r].kg)} kg</td><td class="o">${esc(fmtShort(recs[r].date))}</td></tr>`).join('')}</tbody></table>` : '<div class="muted small" style="margin-top:12px">Todavía sin series apuntadas.</div>'}
    ${sessions.length ? `<div class="grp">Últimas sesiones</div>${sessions.map((x) => `<div class="row-edit"><div class="t"><b>${esc(fmtShort(x.d))}</b><span>${x.sets.map(fmtSet).map(esc).join(' · ')}</span></div></div>`).join('')}` : ''}`);
}
