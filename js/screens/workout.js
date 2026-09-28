// Hoy → Entreno: la sesión del día con registro de series (kg, reps, RPE), la última marca de cada
// ejercicio como referencia y la sugerencia de subir carga (doble progresión).

import { $, $$, esc, fmt, num, int, toast, openSheet, closeSheet, bindSeg, icon } from '../ui/ui.js';
import { addDays, fmtShort, range } from '../dates.js';
import { FILES, planFor } from '../model.js';
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

  // ejercicios de la rutina + extras registrados o añadidos hoy
  const groups = rd.items.map((it) => ({ it, key: keyOf(it, exs), extra: false }));
  const extras = new Map();
  for (const s of logged) { const k = keyOf(s, exs); if (!groups.some((g) => g.key === k) && !extras.has(k)) extras.set(k, { it: { name: s.name, ex: s.ex, sets: 1 }, key: k, extra: true }); }
  for (const name of ctx.state.extraEx?.[date] || []) { const k = keyOf({ name }, exs); if (!groups.some((g) => g.key === k) && !extras.has(k)) extras.set(k, { it: { name, sets: 3 }, key: k, extra: true }); }
  const all = [...groups, ...extras.values()];
  const firstPending = all.find((g) => logged.filter((s) => keyOf(s, exs) === g.key).length < (g.it.sets || 1));

  const block = (g, idx) => {
    const mine = logged.filter((s) => keyOf(s, exs) === g.key).sort((a, b) => (a.i ?? 0) - (b.i ?? 0));
    const prev = lastSets(ctx, date, g.key, exs);
    const planned = g.it.sets || 1;
    const n = Math.max(planned, mine.length ? Math.max(...mine.map((s) => (s.i ?? 0) + 1)) : 0, ctx.state.extraSets?.[`${date}|${g.key}`] || 0);
    const done = mine.length >= planned;
    const isOpen = open[`${date}|${g.key}`] ?? g === firstPending;
    const hint = prev && progressionHint(prev.sets, g.it);
    const known = !!resolveExercise(g.it, exs);
    const rows = Array.from({ length: n }, (_, k) => {
      const s = mine.find((x) => (x.i ?? 0) === k);
      const p = prev?.sets.find((x) => (x.i ?? 0) === k) || prev?.sets[prev.sets.length - 1];
      return `<div class="set-row" data-set="${esc(g.key)}|${k}"><span class="i">${k + 1}</span>
        <input inputmode="decimal" data-f="kg" aria-label="kg serie ${k + 1}" value="${s?.kg != null ? fmt(s.kg, s.kg % 1 ? 1 : 0) : ''}" placeholder="${p ? fmt(p.kg, p.kg % 1 ? 1 : 0) : 'kg'}">
        <input inputmode="numeric" data-f="reps" aria-label="reps serie ${k + 1}" value="${s?.reps ?? ''}" placeholder="${p ? p.reps : 'reps'}">
        <input inputmode="decimal" data-f="rpe" aria-label="RPE serie ${k + 1}" value="${s?.rpe != null ? fmt(s.rpe, s.rpe % 1 ? 1 : 0) : ''}" placeholder="${p?.rpe != null ? fmt(p.rpe, p.rpe % 1 ? 1 : 0) : g.it.rpe ?? 'RPE'}">
        <button type="button" class="mini ${s ? 'ok' : ''}" data-same aria-label="Serie ${k + 1} hecha">${icon.check}</button></div>`;
    }).join('');
    return `<div class="ex ${isOpen ? 'open' : ''}" data-ex="${esc(g.key)}">
      <button class="ex-h" data-toggle="${esc(date)}|${esc(g.key)}"><span class="ex-n ${done ? 'done' : ''}">${done ? '✓' : idx + 1}</span>
        <span class="ex-t"><b>${esc(g.it.name)}</b><span>${g.extra ? 'Extra' : `${esc(planned)} × ${esc((g.it.reps || []).join('–'))}${g.it.rpe ? ` · RPE ${esc(g.it.rpe)}` : ''}`}${prev ? ` · última ${esc(fmtSet(prev.sets.reduce((a, b) => (b.kg > a.kg ? b : a))))}` : ''}</span></span>
        <span class="cnt" style="color:var(--ink-3)">${mine.length}/${planned}</span></button>
      <div class="sets">
        ${g.it.note ? `<div class="tip a" style="margin:0 0 8px"><span>${esc(g.it.note)}</span></div>` : ''}
        ${hint ? `<div class="tip" style="margin:0 0 8px"><span>La última vez (${esc(fmtShort(prev.date))}) llegaste al tope del rango: prueba <b>${fmt(hint.kg, hint.kg % 1 ? 1 : 0)} kg</b>.</span></div>` : ''}
        ${!known ? `<div class="tip a" style="margin:0 0 8px"><span>Este ejercicio no tiene músculos asignados: sus series no cuentan en el volumen. <button class="link" data-assign="${esc(g.it.name)}" style="padding:0">Asignar</button></span></div>` : ''}
        <div class="set-hdr"><span></span><span>kg</span><span>reps</span><span>RPE</span><span></span></div>
        ${rows}
        <button class="link" data-addset="${esc(date)}|${esc(g.key)}" style="padding:6px 0">+ Serie</button>
      </div>
    </div>`;
  };

  const trained = day.trained === true && day.session?.day === rd.name;
  return `${days.length ? `<div class="daytabs" id="trainDays">${days.map((d) => `<button data-v="${esc(d.name)}" class="${d.name === rd.name ? 'on' : ''}">${esc(d.name)}</button>`).join('')}</div>` : ''}
    <div class="card">
      <div class="ch"><h2>${esc(rd.name)}</h2><span class="aux">${(() => { const n = logged.filter((s) => !s.warmup).length; return `${n} ${n === 1 ? 'serie apuntada' : 'series apuntadas'}`; })()}</span></div>
      <div class="muted small" style="margin:-6px 0 10px">En gris, tu última sesión. <b>✓</b> la repite; si no, escribe lo que hiciste.</div>
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

  // guardar una serie cuando tiene kg y reps (o borrarla si se vacía)
  $$('.set-row', root).forEach((row) => {
    const btn = $('[data-same]', row);
    const save = () => {
      const [key, kStr] = row.dataset.set.split(/\|(?=\d+$)/);
      const k = +kStr;
      const kg = num($('[data-f="kg"]', row).value), reps = int($('[data-f="reps"]', row).value), rpe = num($('[data-f="rpe"]', row).value);
      const group = row.closest('.ex');
      const name = group.querySelector('.ex-t b').textContent;
      const ex = resolveExercise({ name }, exs) || (key.startsWith('n:') ? null : exs.find((e) => e.id === key));
      if (kg != null && (kg < 0 || kg > 1000)) { toast('Peso no válido'); return false; }
      if (reps != null && (reps < 0 || reps > 100)) { toast('Repeticiones no válidas'); return false; }
      if (rpe != null && (rpe < 1 || rpe > 10)) { toast('RPE entre 1 y 10'); return false; }
      const complete = kg != null && reps != null;
      ctx.store.updateDay(date, (d) => {
        d.session ||= { day: rdName(), sets: [] };
        d.session.day ||= rdName();
        d.session.sets = (d.session.sets || []).filter((s) => !(keyOf(s, exs) === key && (s.i ?? 0) === k));
        if (complete) {
          d.session.sets.push({ ...(ex ? { ex: ex.id } : {}), name, i: k, kg, reps, ...(rpe != null ? { rpe } : {}) });
          d.trained = true;
        }
        if (!d.session.sets.length) delete d.session;
      }, `Entreno ${fmtShort(date)}: ${name}${complete ? ` ${fmt(kg, kg % 1 ? 1 : 0)}×${reps}` : ''}`);
      // actualizar en el sitio (sin repintar mientras se escribe): botón de la serie, contador y ✓ del ejercicio
      btn.classList.toggle('ok', complete);
      const saved = $$('.set-row', group).filter((r) => $('[data-same]', r).classList.contains('ok')).length;
      const cnt = group.querySelector('.cnt');
      const planned = +cnt.textContent.split('/')[1];
      cnt.textContent = `${saved}/${planned}`;
      const n = group.querySelector('.ex-n');
      n.classList.toggle('done', saved >= planned);
      if (saved >= planned) n.textContent = '✓';
      const aux = root.querySelector('.card .aux');
      if (aux) { const all = $$('[data-same].ok', root).length; aux.textContent = `${all} ${all === 1 ? 'serie apuntada' : 'series apuntadas'}`; }
      return complete;
    };
    $$('input', row).forEach((inp) => inp.addEventListener('change', save));
    btn.addEventListener('click', () => {
      // «serie hecha»: lo que esté vacío se rellena con lo de la última vez (en gris) y se guarda
      $$('input', row).forEach((inp) => { if (!inp.value && /\d/.test(inp.placeholder)) inp.value = inp.placeholder; });
      if (!save()) {
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
    toast(`${name}: hecha`); ctx.render();
  });
  $('#sessRest', root)?.addEventListener('click', () => {
    if ((ctx.store.day(date).session?.sets || []).length && !confirm('Hay series apuntadas hoy. ¿Borrarlas y marcar descanso?')) return;
    ctx.store.updateDay(date, (d) => { d.trained = false; delete d.session; }, `Descanso ${fmtShort(date)}`);
    toast('Día de descanso'); ctx.render();
  });
}
