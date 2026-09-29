// Progreso: indicadores, gráficas, composición y fotos.

import { $, $$, esc, fmt, fmtK, signed, openSheet, bindSeg, icon, alertBox } from '../ui/ui.js';
import { timeChart } from '../ui/charts.js';
import { addDays, fmtShort, weekStart, range } from '../dates.js';
import { FILES, POSES, planFor, checkinPhotoPath, kcalTarget, dietStatus, sumItems, DEFAULT_METRICS } from '../model.js';
import { hallProjection } from '../engine/energy.js';
import { rollingMean, whtrCategory, MDC } from '../engine/body.js';
import { hydratePhotos } from '../photos.js';
import { sparkline } from '../ui/charts.js';
import { loggedVolume, plannedVolume, exerciseHistory, strengthTrend, resolveExercise } from '../engine/training.js';
import { exercisesOf, volumeBars } from './exercises.js';
import { goalOf, favours, rateVerdict, bandText, GOAL_LABEL, MAINTAIN_BAND, GAIN_RATE } from '../engine/targets.js';

const RANGES = [[28, '4 sem'], [56, '8 sem'], [84, '12 sem'], [0, 'Todo']];

export function render(ctx) {
  const a = ctx.analysis();
  if (a.empty) return `<div class="card empty"><b>Todavía no hay datos</b>Registra tu peso en Hoy. La tendencia aparece desde el primer día y el ritmo es fiable a partir de dos semanas.</div>`;
  const st = (ctx.state.prog ||= { range: 56, comp: 'waist', pose: 'front', a: null, b: null });
  const today = ctx.today();
  const from = st.range ? addDays(today, -st.range + 1) : a.span[0];
  const L = a.latest;
  const plan = ctx.store.get(FILES.plan);

  // KPIs
  const back = a.trend[Math.max(0, a.trend.length - 1 - Math.min(st.range || a.trend.length, a.trend.length - 1))];
  const goal = goalOf(planFor(plan, today));
  const band = L.rateTarget; // null = sin objetivo
  const verdict = rateVerdict(band, L.rate?.pctWeek);
  const eta = L.projection?.days && L.goal ? fmtShort(addDays(today, Math.round(L.projection.days))) : null;
  const dTrend = L.trend.level - back.level;
  // previsión: fecha para el peso objetivo; sin él (o en mantenimiento), el peso previsto en 4 semanas
  const in4 = L.projection && L.tdeeReliable ? L.projection.W(28) : null;
  const fcBig = eta || (in4 != null && !L.goal ? `${fmt(in4)} <small>kg</small>` : '—');
  const fcSub = eta ? `${fmt(L.goal)} kg con el plan actual` : in4 != null && !L.goal ? 'en 4 semanas con el plan actual' : !band ? 'Sin objetivo' : L.projection ? 'no alcanzable con las kcal actuales' : (goal === 'loss' || goal === 'gain') && !L.goal ? 'Pon un peso objetivo en Plan' : 'Pon kcal en Plan → Dieta';

  const kpis = `<div class="kpis">
    <button class="kpi" data-fx><div class="k">Tendencia</div><div class="v num">${fmt(L.trend.level)} <small>kg</small></div><div class="d num ${favours(goal, dTrend) ? 'up' : ''}">${signed(dTrend)} kg en el periodo</div><div class="m">Kalman</div></button>
    <button class="kpi" data-fx><div class="k">Ritmo</div><div class="v num">${fmt(L.rate.pctWeek, 2)} <small>%/sem</small></div><div class="d num ${L.rateReliable && verdict ? (verdict.status === 'in' ? 'up' : 'warn') : 'muted'}">${!L.rateReliable ? `fiable en ${14 - L.dataDays} días` : band ? `objetivo: ${esc(bandText(band))}` : GOAL_LABEL.none}</div><div class="m">${fmt(L.rate.kgWeek, 2)} kg/sem</div></button>
    <button class="kpi" data-fx><div class="k">Gasto energético</div><div class="v num">${L.tdeeReliable ? `${fmtK(L.tdee.E)} <small>kcal</small>` : '—'}</div><div class="d num muted">${L.tdeeReliable ? `± ${fmtK(L.tdee.sd)} kcal` : `listo en ${Math.max(0, 21 - L.dataDays)} días`}</div><div class="m">${L.tdeeAssumedShare > 0.5 ? 'Con kcal del plan' : 'TDEE adaptativo'}</div></button>
    <button class="kpi" data-fx><div class="k">Previsión</div><div class="v num">${fcBig}</div><div class="d num muted">${fcSub}</div><div class="m">Modelo de Hall</div></button>
  </div>`;

  // Peso
  const horizon = 28;
  const pts = a.span.map((d, i) => ({ d, w: a.series[i].w, t: a.trend[i] }));
  const proj = L.projection && L.tdeeReliable ? Array.from({ length: horizon + 1 }, (_, t) => ({ d: addDays(today, t), y: L.projection.W(t) })) : [];
  const versions = [...(plan?.versions || [])].sort((x, y) => (x.from < y.from ? -1 : 1));
  const events = versions.slice(1).map((v) => ({ d: v.from }));
  const bands = versions.filter((v) => v.phase).map((v, i, arr) => ({ from: v.from, to: arr[i + 1]?.from || addDays(today, horizon), label: `FASE ${String(v.phase).toUpperCase()}` }))
    .reduce((acc, b) => { const last = acc[acc.length - 1]; if (last && last.label === b.label) last.to = b.to; else acc.push(b); return acc; }, []);
  const weightChart = timeChart({
    from, to: proj.length ? addDays(today, horizon) : today, today,
    layers: [
      { kind: 'band', points: pts.filter((p) => p.t).map((p) => ({ d: p.d, lo: p.t.level - p.t.sd, hi: p.t.level + p.t.sd })) },
      { kind: 'dots', points: pts.filter((p) => p.w != null).map((p) => ({ d: p.d, y: p.w })) },
      { kind: 'line', color: 'var(--accent)', points: pts.filter((p) => p.t).map((p) => ({ d: p.d, y: p.t.level })) },
      { kind: 'dash', color: 'var(--accent)', width: 2.2, points: proj },
      ...(L.goal && Math.abs(L.goal - L.trend.level) <= 6 ? [{ kind: 'dash', color: 'var(--ink-3)', width: 1.2, points: [{ d: from, y: L.goal }, { d: proj.length ? addDays(today, horizon) : today, y: L.goal }] }] : []),
    ],
    events, bands, label: { d: today, y: L.trend.level, text: fmt(L.trend.level) },
  });

  // Gasto vs ingesta
  const tdeePts = a.tdee.map((t) => ({ d: t.date, y: t.ready ? t.E : null }));
  const intake7 = a.intakes.map((x, i) => {
    const w = a.intakes.slice(Math.max(0, i - 6), i + 1).filter((y) => y.kcal != null);
    return { d: x.date, y: w.length ? w.reduce((s, y) => s + y.kcal, 0) / w.length : null };
  });
  const energyChart = L.tdeeReliable ? timeChart({ from, to: today, height: 160, layers: [
    { kind: 'line', color: 'var(--amber)', width: 2, points: intake7 },
    { kind: 'line', color: 'var(--blue)', points: tdeePts },
  ] }) : '';

  // Gasto: número, confianza y por qué ha cambiado esta semana
  let energyCard = '';
  if (L.tdeeReliable) {
    const T = a.tdee, n = T.length;
    const now = T[n - 1], wk = T[Math.max(0, n - 8)];
    const dE = now.E - wk.E;
    const mean = (arr) => { const v = arr.map((x) => x.kcal).filter((x) => x != null); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
    const i7 = mean(a.intakes.slice(-7)), iPrev = mean(a.intakes.slice(-14, -7));
    const rNow = a.trend[n - 1]?.slope * 7, rPrev = a.trend[Math.max(0, n - 8)]?.slope * 7;
    const conf = now.sd < 100 ? 5 : now.sd < 150 ? 4 : now.sd < 200 ? 3 : now.sd < 300 ? 2 : 1;
    const why = Math.abs(dE) < 30
      ? `<b>Estable esta semana</b> (${signed(dE, 0)} kcal).`
      : `<b>${dE > 0 ? 'Sube' : 'Baja'} ${fmtK(Math.abs(dE))} kcal esta semana.</b> ${i7 != null && iPrev != null ? `Comiste ${signed(i7 - iPrev, 0)} kcal/día respecto a la anterior (media ${fmtK(i7)})` : `Comiste de media ${fmtK(i7)} kcal/día`}${rNow != null && rPrev != null ? ` y la tendencia de peso pasó de ${signed(rPrev, 2)} a ${signed(rNow, 2)} kg/sem` : ''}.`;
    energyCard = `<div class="card"><div class="ch"><h2>Gasto estimado</h2><span class="method">± ${fmtK(now.sd)} kcal</span></div>
      <div class="big-num num">${fmtK(now.E)} <small>kcal/día</small></div>
      <div class="conf" aria-label="Confianza ${conf} de 5">${[1, 2, 3, 4, 5].map((k) => `<i class="${k <= conf ? 'f' : ''}"></i>`).join('')}</div>
      <div class="muted small" style="margin-top:4px">Confianza ${['', 'baja', 'baja', 'media', 'alta', 'alta'][conf]}${L.tdeeAssumedShare > 0.5 ? ' · muchos días sin validar: cuentan como el plan' : ''}</div>
      <div class="why">${why} Que oscile ±50–150 kcal es normal.</div></div>`;
  }

  // Balance de 30 días: ¿cumplo el plan? y ¿el plan funciona?
  let balance30 = '';
  if (L.tdeeReliable) {
    const from30 = addDays(today, -29);
    const rows = a.intakes.map((x, i) => ({ ...x, E: a.tdee[i]?.ready ? a.tdee[i].E : null })).filter((x) => x.date >= from30 && x.kcal != null);
    if (rows.length >= 10) {
      const days = ctx.store.allDays();
      const avg = (f) => rows.reduce((acc, x) => acc + f(x), 0) / rows.length;
      const I = avg((x) => x.kcal);
      const tgt = avg((x) => kcalTarget(planFor(plan, x.date), days[x.date]?.trained) || 0); // 0 = sin kcal en el plan
      const E = avg((x) => x.E ?? L.tdee.E);
      const vsPlan = I - tgt, bal = I - E;
      const pred = (bal * 7) / (a.rho || 7700), real = L.rate.kgWeek;
      balance30 = `<div class="card"><div class="ch"><h2>Balance de 30 días</h2><span class="aux">${rows.length} días</span></div>
        <div class="b30">${tgt ? `<div><span>¿Cumples el plan?</span><b class="num">${Math.abs(vsPlan) <= tgt * 0.05 ? 'Sí' : signed(vsPlan, 0) + ' kcal/día'}</b><small>comes ${fmtK(I)} · objetivo ${fmtK(tgt)}</small></div>` : `<div><span>Comes de media</span><b class="num">${fmtK(I)} kcal/día</b><small>sin objetivo de kcal en el plan</small></div>`}
        <div><span>¿Funciona el plan?</span><b class="num">${signed(bal, 0)} kcal/día</b><small>frente al gasto (${fmtK(E)}): predice ${signed(pred, 2)} kg/sem · tu tendencia ${signed(real, 2)}</small></div></div>
        <div class="muted small" style="margin-top:8px">Lo primero mide la adherencia; lo segundo, si ese objetivo te lleva al ritmo que buscas.</div></div>`;
    }
  }

  // Cintura / pliegues
  const rows = a.body.rows.filter((r) => (st.comp === 'waist' ? r.waist != null : r.sum != null));
  const key = st.comp === 'waist' ? 'waist' : 'sum';
  const ma = rollingMean(rows.map((r) => r[key]), 3);
  const mdc = st.comp === 'waist' ? MDC.waist : MDC.sumSkinfolds;
  const compChart = rows.length >= 2 ? timeChart({ from: rows[0].date < from ? from : rows[0].date, to: today, height: 160, layers: [
    { kind: 'band', points: rows.map((r, i) => ({ d: r.date, lo: ma[i] - mdc / 2, hi: ma[i] + mdc / 2 })) },
    { kind: 'dots', r: 3, points: rows.map((r) => ({ d: r.date, y: r[key] })) },
    { kind: 'line', color: 'var(--accent)', marks: true, points: rows.map((r, i) => ({ d: r.date, y: ma[i] })) },
  ] }) : `<div class="muted small">Hacen falta al menos dos controles con ${st.comp === 'waist' ? 'cintura' : 'pliegues'}.</div>`;

  // Composición
  const b = a.body;
  const whtr = b.whtr;
  const comp = `<div class="card">
    <div class="ch"><h2>Composición</h2><span class="method">${[b.bfFaulkner != null && 'Faulkner', b.bfNavy != null && 'Navy', b.bfBia != null && 'Reloj'].filter(Boolean).join(' · ') || 'Sin datos'}</span></div>
    <div class="row">
      <div><div class="muted small" style="font-weight:700">% graso estimado</div><div style="font-size:28px;font-weight:800;letter-spacing:-.03em" class="num">${b.bfLow != null ? (Math.abs(b.bfHigh - b.bfLow) < 0.5 ? `${fmt(b.bfLow)} %` : `${fmt(b.bfLow, 0)}–${fmt(b.bfHigh, 0)} %`) : b.bfBia != null ? `${fmt(b.bfBia)} %` : '—'}</div></div>
      <div style="text-align:right"><div class="muted small" style="font-weight:700">Masa magra</div><div style="font-size:20px;font-weight:800" class="num">${b.ffm ? `≈ ${fmt(b.ffm, 0)} kg` : '—'}</div></div>
    </div>
    ${whtr != null ? `<div class="range"><div class="zone" style="left:0;width:50%"></div><div class="pin" style="left:${Math.max(0, Math.min(100, ((whtr - 0.4) / 0.2) * 100))}%"></div><div class="pl" style="left:${Math.max(0, Math.min(100, ((whtr - 0.4) / 0.2) * 100))}%">${fmt(whtr, 2)}</div></div>
      <div class="scale-l"><span>0,40</span><span>Cintura / altura · ${whtrCategory(whtr)}</span><span>0,60</span></div>` : ''}
    <div class="muted small" style="margin-top:12px">${b.bfFaulkner != null ? `Pliegues (Faulkner): ${fmt(b.bfFaulkner)} %. ` : ''}${b.bfNavy != null ? `Perímetros (Navy): ${fmt(b.bfNavy)} %. ` : ''}Se muestra como rango: cada fórmula tiene un error de ±3–4 puntos. Fíjate en la tendencia.</div>
  </div>`;

  // Fotos
  const withPhotos = a.checkins.filter((c) => c.checkin.photos?.length);
  let photos = '';
  if (withPhotos.length) {
    const dates = withPhotos.map((c) => c.date);
    const A = st.a && dates.includes(st.a) ? st.a : dates[0];
    const B = st.b && dates.includes(st.b) ? st.b : dates[dates.length - 1];
    const cell = (d) => {
      const c = withPhotos.find((x) => x.date === d);
      const has = c.checkin.photos.includes(st.pose);
      return `<div><div class="shot done">${has ? `<img class="photo-img" data-photo="${checkinPhotoPath(d, c.checkin, st.pose)}" alt="" hidden>` : '<span class="lbl2" style="position:relative">Sin foto</span>'}</div>
        <div class="cap">${fmtShort(d)}<span>${c.weight != null ? fmt(c.weight) + ' kg' : ''}${c.checkin.measures?.waist != null ? ` · ${fmt(c.checkin.measures.waist)} cm` : ''}</span></div></div>`;
    };
    const sel = (id, v) => `<select class="inp sm" id="${id}">${dates.map((d) => `<option value="${d}" ${d === v ? 'selected' : ''}>${fmtShort(d)}</option>`).join('')}</select>`;
    const img = (d) => { const c = withPhotos.find((x) => x.date === d); return c.checkin.photos.includes(st.pose) ? `<img class="photo-img" data-photo="${checkinPhotoPath(d, c.checkin, st.pose)}" alt="" hidden>` : ''; };
    const mode = st.phMode || 'side';
    const view = mode === 'side' ? `<div class="cmp">${cell(A)}${cell(B)}</div>`
      : `<div class="cmp2 ${mode}" id="cmp2" style="--x:${st.px ?? 50}%;--o:${(st.po ?? 50) / 100}"><div class="ph">${img(A)}</div><div class="ph b">${img(B)}</div>${mode === 'slide' ? '<div class="ln"></div>' : ''}<span class="tag l">${fmtShort(A)}</span><span class="tag r">${fmtShort(B)}</span></div>
        ${mode === 'over' ? `<input type="range" id="phO" min="0" max="100" value="${st.po ?? 50}" style="width:100%;margin-top:10px;accent-color:var(--accent)" aria-label="Transparencia">` : '<div class="muted small" style="margin-top:6px;text-align:center">Arrastra la línea para comparar.</div>'}`;
    photos = `<div class="card"><div class="ch"><h2>Fotos</h2><div class="seg sm" id="phMode" style="width:auto">${[['side', 'Lado a lado'], ['slide', 'Deslizar'], ['over', 'Superponer']].map(([k, l]) => `<button data-v="${k}" class="${mode === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="g2" style="margin-bottom:10px">${sel('phA', A)}${sel('phB', B)}</div>
      <div class="seg" id="poseSeg" style="margin-bottom:12px">${POSES.map((p) => `<button data-v="${p.id}" class="${p.id === st.pose ? 'on' : ''}">${p.label.replace('Perfil ', 'P. ')}</button>`).join('')}</div>
      ${view}</div>`;
  }

  const allMeasures = allMeasuresCard(ctx, a);
  const compare = compareCard(ctx, a, st);
  const monthly = monthCard(ctx, a, st);

  // Constancia: 26 semanas, un cuadro por día (peso · día validado · entreno marcado)
  const days0 = ctx.store.allDays();
  const hStart = weekStart(addDays(today, -7 * 25));
  let heat = '', validWeek = 0;
  for (let d = hStart, k = 0; k < 26 * 7; d = addDays(d, 1), k++) {
    const x = days0[d] || {};
    const ds = dietStatus(x);
    const lv = d > today ? -1 : (x.weight != null ? 1 : 0) + (ds && ds.status !== 'unknown' ? 1 : 0) + (x.trained != null ? 1 : 0);
    if (d >= weekStart(today) && d <= today && ds && ds.status !== 'unknown') validWeek++;
    heat += `<i class="${lv < 0 ? 'f' : lv ? `l${lv}` : ''}" title="${d}"></i>`;
  }
  const consistency = `<div class="card"><div class="ch"><h2>Constancia</h2><span class="aux">26 semanas</span></div>
    <div class="heat">${heat}</div>
    <div class="legend"><span><i class="dot" style="background:var(--sunken)"></i>Nada</span><span><i class="dot" style="background:var(--accent);opacity:.35"></i>Peso</span><span><i class="dot" style="background:var(--accent);opacity:.65"></i>+ día validado</span><span><i class="dot" style="background:var(--accent)"></i>+ entreno marcado</span></div>
    <div class="muted small" style="margin-top:6px">Esta semana: ${validWeek} ${validWeek === 1 ? 'día validado' : 'días validados'}. Sin rachas que castiguen: cuenta la constancia, no la perfección.</div></div>`;

  // Entreno: volumen de los últimos 7 días y fuerza por ejercicio
  const exs = exercisesOf(ctx);
  const days = ctx.store.allDays();
  const lv = loggedVolume(days, addDays(today, -6), today, exs);
  const planV = plannedVolume(planFor(plan, today)?.routine, exs, planFor(plan, today)?.targets?.sessions);
  const useLogged = Object.keys(lv.byMuscle).length > 0;
  const volume = `<div class="card"><div class="ch"><h2>Volumen semanal</h2><span class="aux">${useLogged ? `últimos 7 días · ${lv.sessions} sesiones` : 'planificado'}</span></div>
    ${volumeBars(useLogged ? lv.byMuscle : planV.byMuscle)}
    <div class="muted small" style="margin-top:8px">Series por músculo; el trabajo indirecto cuenta ½. Franja verde: 10–20 (Pelland 2025).${useLogged ? '' : ' Cuando apuntes series en Entreno se mostrará lo real.'}${(useLogged ? lv.unknown : planV.unknown).length ? ` Sin contar: ${esc((useLogged ? lv.unknown : planV.unknown).join(', '))}.` : ''}</div></div>`;
  const exIds = new Map();
  for (const d of Object.keys(days)) for (const s of days[d]?.session?.sets || []) { const e = resolveExercise(s, exs); if (e) exIds.set(e.id, e); }
  const lifts = [...exIds.values()].map((e) => ({ e, h: exerciseHistory(days, e.id, exs).filter((x) => x.best) })).filter((x) => x.h.length >= 2).sort((a, b) => b.h.length - a.h.length).slice(0, 8);
  const TREND = { sube: ['Sube', 'g'], estable: ['Estable', 'n'], baja: ['Baja', 'a'], pocos: ['Pocos datos', 'n'] };
  const strength = lifts.length ? `<div class="card"><div class="ch"><h2>Fuerza (e1RM)</h2><span class="method">Epley + RIR</span></div>
    ${lifts.map(({ e, h }) => { const t = strengthTrend(h); const last = h[h.length - 1].best; const [lbl, tone] = TREND[t.status];
      return `<div class="lift"><div><b>${esc(e.name)}</b><span>${fmt(last.e1rm, 0)} kg estimado · mejor serie ${fmt(last.kg, last.kg % 1 ? 1 : 0)} × ${last.reps}${last.rpe ? ` @${last.rpe}` : ''}</span></div>${sparkline(h.map((x) => x.best.e1rm), { color: t.status === 'baja' ? 'var(--amber)' : 'var(--accent)' })}<span class="badge ${tone}">${lbl}</span></div>`; }).join('')}
    <div class="muted small" style="margin-top:8px">Fuerza máxima estimada con las series a RPE 7 o más. En déficit, mantenerla ya es buena señal.</div></div>` : '';

  return `<div class="seg" id="rangeSeg" style="margin-bottom:12px">${RANGES.map(([v, l]) => `<button data-v="${v}" class="${v === st.range ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${kpis}
    ${a.alerts.length ? `<div class="card">${a.alerts.map(alertBox).join('')}</div>` : ''}
    <div class="card"><div class="ch"><h2>Peso</h2><button class="method" data-fx style="cursor:pointer">${icon.info}Cómo se calcula</button></div>
      ${weightChart}
      <div class="legend"><span><i class="dot" style="background:var(--dot)"></i>Diario</span><span><i style="background:var(--accent)"></i>Tendencia</span><span><i style="background:var(--accent-band);height:8px"></i>±1σ</span>${proj.length ? '<span><i style="background:repeating-linear-gradient(90deg,var(--accent) 0 3px,transparent 3px 6px)"></i>Previsión</span>' : ''}${events.length ? '<span><i class="dot" style="background:var(--amber)"></i>Cambio de plan</span>' : ''}</div></div>
    ${energyCard}
    ${balance30}
    ${energyChart ? `<div class="card"><div class="ch"><h2>Gasto vs ingesta</h2></div>${energyChart}
      <div class="legend"><span><i style="background:var(--blue)"></i>Gasto estimado</span><span><i style="background:var(--amber)"></i>Ingesta media 7 días${L.tdeeAssumedShare > 0.5 ? ' (según plan)' : ''}</span></div></div>` : ''}
    <div class="card"><div class="ch"><h2>Medidas</h2><div class="seg" id="compSeg" style="width:180px"><button data-v="waist" class="${st.comp === 'waist' ? 'on' : ''}">Cintura</button><button data-v="sum" class="${st.comp === 'sum' ? 'on' : ''}">Σ pliegues</button></div></div>
      ${compChart}
      ${rows.length >= 2 ? `<div class="legend"><span><i style="background:var(--accent)"></i>Media de 3 controles</span><span><i class="dot" style="background:var(--dot)"></i>Medida</span><span><i style="background:var(--accent-band);height:8px"></i>Margen de error</span></div>` : ''}</div>
    ${allMeasures}
    ${comp}
    ${compare}
    ${monthly}
    ${volume}
    ${strength}
    ${photos}
    ${consistency}`;
}

export function bind(root, ctx) {
  const st = ctx.state.prog;
  if (!st) return;
  bindSeg(root, '#rangeSeg', (v) => { st.range = +v; ctx.render(); });
  bindSeg(root, '#compSeg', (v) => { st.comp = v; ctx.render(); });
  bindSeg(root, '#poseSeg', (v) => { st.pose = v; ctx.render(); });
  bindSeg(root, '#phMode', (v) => { st.phMode = v; ctx.render(); });
  $('#cmpA', root)?.addEventListener('change', (e) => { st.cmpA = e.target.value; ctx.render(); });
  $('#cmpB', root)?.addEventListener('change', (e) => { st.cmpB = e.target.value; ctx.render(); });
  $('#monthSel', root)?.addEventListener('change', (e) => { st.month = e.target.value; ctx.render(); });
  const c2 = $('#cmp2', root);
  if (c2?.classList.contains('slide')) {
    const move = (e) => { const r = c2.getBoundingClientRect(); st.px = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)); c2.style.setProperty('--x', `${st.px}%`); };
    c2.addEventListener('pointerdown', (e) => { c2.setPointerCapture(e.pointerId); move(e); c2.onpointermove = move; });
    c2.addEventListener('pointerup', () => { c2.onpointermove = null; });
  }
  $('#phO', root)?.addEventListener('input', (e) => { st.po = +e.target.value; c2?.style.setProperty('--o', st.po / 100); });
  $('#phA', root)?.addEventListener('change', (e) => { st.a = e.target.value; ctx.render(); });
  $('#phB', root)?.addEventListener('change', (e) => { st.b = e.target.value; ctx.render(); });
  $$('[data-fx]', root).forEach((b) => b.addEventListener('click', () => formulasSheet(ctx)));
  hydratePhotos(root, ctx.store);
}

// ---------------------------------------------------------------- todas las medidas
function allMeasuresCard(ctx, a) {
  const metrics = (ctx.store.get(FILES.config)?.metrics || DEFAULT_METRICS);
  const tiles = metrics.map((m) => {
    const grp = m.group === 'skinfold' ? 'skinfolds' : 'measures';
    const pts = a.checkins.map((c) => ({ d: c.date, v: c.checkin?.[grp]?.[m.id] })).filter((x) => x.v != null);
    if (!pts.length) return '';
    const last = pts[pts.length - 1].v, first = pts[0].v, dv = last - first;
    const good = m.id === 'arm' || m.id === 'thigh' ? dv >= 0 : dv <= 0; // brazo/muslo: subir suele ser bueno
    return `<div class="mt"><span class="l">${esc(m.label)}</span><b class="num">${fmt(last)} <small>${esc(m.unit)}</small></b>
      ${pts.length > 1 ? `<span class="d num" style="color:${Math.abs(dv) < 0.05 ? 'var(--ink-3)' : good ? 'var(--accent)' : 'var(--slate)'}">${signed(dv)} desde ${fmtShort(pts[0].d)}</span>${sparkline(pts.map((x) => x.v), { w: 120, h: 26, color: good ? 'var(--accent)' : 'var(--slate)' })}` : '<span class="d muted">una medida</span>'}</div>`;
  }).filter(Boolean);
  if (!tiles.length) return '';
  return `<div class="card"><div class="ch"><h2>Todas las medidas</h2><span class="aux">${a.checkins.length} controles</span></div><div class="mtiles">${tiles.join('')}</div></div>`;
}

// ---------------------------------------------------------------- comparar dos datos (medias semanales)
const SERIES = {
  peso: ['Peso (tendencia)', 'kg', 1],
  cintura: ['Cintura', 'cm', 1],
  kcal: ['Kcal (media)', 'kcal', 0],
  prot: ['Proteína (media)', 'g', 0],
  gasto: ['Gasto estimado', 'kcal', 0],
  pasos: ['Pasos (media)', '', 0],
  sueno: ['Sueño (media)', 'h', 1],
  series: ['Series de la semana', '', 0],
};
function weeklySeries(ctx, a, key, weeks) {
  const days = ctx.store.allDays();
  const idx = new Map(a.span.map((d, i) => [d, i]));
  return weeks.map((w) => {
    const ds = range(w, addDays(w, 6)).filter((d) => d <= ctx.today());
    const vals = ds.map((d) => {
      const x = days[d] || {}, i = idx.get(d);
      if (key === 'peso') return i != null ? a.trend[i]?.level ?? null : null;
      if (key === 'cintura') return x.checkin?.measures?.waist ?? null;
      if (key === 'kcal') return i != null && !a.intakes[i]?.assumed ? a.intakes[i]?.kcal ?? null : null; // solo días apuntados o validados
      if (key === 'prot') return x.meals?.length ? sumItems(x.meals.flatMap((m) => m.items)).p : null;
      if (key === 'gasto') return i != null && a.tdee[i]?.ready ? a.tdee[i].E : null;
      if (key === 'pasos') return x.steps ?? null;
      if (key === 'sueno') return x.sleep_h ?? null;
      if (key === 'series') return (x.session?.sets || []).filter((s) => !s.warmup).length;
      return null;
    }).filter((v) => v != null);
    if (!vals.length) return null;
    return key === 'series' ? vals.reduce((p, q) => p + q, 0) : vals.reduce((p, q) => p + q, 0) / vals.length;
  });
}
function pearson(xs, ys) {
  const pts = xs.map((x, i) => [x, ys[i]]).filter(([x, y]) => x != null && y != null);
  if (pts.length < 4) return null;
  const n = pts.length, mx = pts.reduce((p, [x]) => p + x, 0) / n, my = pts.reduce((p, [, y]) => p + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pts) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxx && syy ? { r: sxy / Math.sqrt(sxx * syy), n } : null;
}
function compareCard(ctx, a, st) {
  const A = st.cmpA || 'peso', B = st.cmpB || 'kcal';
  const nW = Math.max(8, Math.ceil((st.range || 182) / 7));
  const weeks = Array.from({ length: nW }, (_, i) => addDays(weekStart(ctx.today()), -7 * (nW - 1 - i)));
  const ya = weeklySeries(ctx, a, A, weeks), yb = weeklySeries(ctx, a, B, weeks);
  const sel = (id, v) => `<select class="inp sm" id="${id}">${Object.entries(SERIES).map(([k, [l]]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const W = 360, H = 176, pl = 40, pr = 40, pt = 20, pb = 24;
  const X = (i) => pl + (i / Math.max(1, nW - 1)) * (W - pl - pr);
  const line = (ys, color, side) => {
    const v = ys.filter((y) => y != null);
    if (v.length < 2) return '';
    let lo = Math.min(...v), hi = Math.max(...v); if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const Y = (y) => pt + ((hi - y) / (hi - lo)) * (H - pt - pb);
    const d = ys.map((y, i) => (y == null ? null : `${X(i).toFixed(1)} ${Y(y).toFixed(1)}`)).filter(Boolean).join(' L');
    const dec = SERIES[side === 'l' ? A : B][2];
    const lab = (y) => `<text x="${side === 'l' ? pl - 5 : W - pr + 5}" y="${Y(y) + 3.5}" font-size="10" font-weight="700" fill="${color}" text-anchor="${side === 'l' ? 'end' : 'start'}">${fmt(y, dec)}</text>`;
    return `<path d="M${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>${ys.map((y, i) => (y == null ? '' : `<circle cx="${X(i)}" cy="${Y(y)}" r="2.6" fill="${color}"/>`)).join('')}${lab(hi)}${lab(lo)}`;
  };
  const cor = pearson(ya, yb);
  const txt = cor ? (() => { const r = cor.r, abs = Math.abs(r); const f = abs < 0.3 ? 'apenas se relacionan' : abs < 0.6 ? `se relacionan de forma moderada (${r > 0 ? 'suben juntos' : 'cuando uno sube, el otro baja'})` : `se relacionan bastante (${r > 0 ? 'suben juntos' : 'cuando uno sube, el otro baja'})`; return `En estas ${cor.n} semanas ${f}: r = ${fmt(r, 2)}. Relación no es causa, y con pocas semanas puede ser casualidad.`; })() : 'Hacen falta al menos 4 semanas con los dos datos.';
  return `<div class="card"><div class="ch"><h2>Comparar dos datos</h2><span class="aux">medias por semana</span></div>
    <div class="g2" style="margin-bottom:10px"><div class="cmpsel" style="--c:var(--accent)">${sel('cmpA', A)}</div><div class="cmpsel" style="--c:var(--blue)">${sel('cmpB', B)}</div></div>
    <svg class="chart" viewBox="0 0 ${W} ${H}">${line(ya, 'var(--accent)', 'l')}${line(yb, 'var(--blue)', 'r')}
      <text x="${pl}" y="${H - 5}" font-size="10" fill="var(--ink-3)" font-weight="600">${fmtShort(weeks[0])}</text><text x="${W - pr}" y="${H - 5}" font-size="10" fill="var(--ink-3)" font-weight="600" text-anchor="end">esta semana</text></svg>
    <div class="muted small" style="margin-top:6px">${txt}</div></div>`;
}

// ---------------------------------------------------------------- resumen del mes
const MONTHS_L = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function monthCard(ctx, a, st) {
  const days = ctx.store.allDays();
  const today = ctx.today();
  const months = [...new Set(Object.keys(days).filter((d) => d <= today).map((d) => d.slice(0, 7)))].sort().reverse().slice(0, 12);
  if (!months.length) return '';
  const def = +today.slice(8) < 8 && months[1] ? months[1] : months[0];
  const M = st.month && months.includes(st.month) ? st.month : def;
  const ds = Object.keys(days).filter((d) => d.startsWith(M) && d <= today).sort();
  const idx = new Map(a.span.map((d, i) => [d, i]));
  const tr = ds.map((d) => a.trend[idx.get(d)]?.level).filter((x) => x != null);
  const waist = ds.map((d) => days[d]?.checkin?.measures?.waist).filter((x) => x != null);
  const valid = ds.filter((d) => { const x = dietStatus(days[d]); return x && x.status !== 'unknown'; }).length;
  const nDays = ds.length ? +ds[ds.length - 1].slice(8) : 0;
  const kc = ds.map((d) => a.intakes[idx.get(d)]).filter((x) => x && x.kcal != null && !x.assumed).map((x) => x.kcal);
  const pr = ds.filter((d) => days[d]?.meals?.length).map((d) => sumItems(days[d].meals.flatMap((m) => m.items)).p);
  const sess = ds.filter((d) => days[d]?.trained === true).length;
  const sets = ds.reduce((p, d) => p + (days[d]?.session?.sets || []).filter((x) => !x.warmup).length, 0);
  const steps = ds.map((d) => days[d]?.steps).filter((x) => x != null);
  const sleep = ds.map((d) => days[d]?.sleep_h).filter((x) => x != null);
  // récords: series que superan el mejor peso anterior a esas mismas repeticiones
  const best = new Map();
  let prs = 0;
  for (const d of Object.keys(days).sort()) {
    if (d > today) break;
    for (const x of days[d]?.session?.sets || []) {
      if (x.warmup || !(x.reps > 0) || x.kg == null) continue;
      const k = `${x.ex || String(x.name).toLowerCase()}|${x.reps}`;
      const b = best.get(k);
      if (b != null && x.kg > b && d.startsWith(M)) prs++;
      if (b == null || x.kg > b) best.set(k, x.kg);
    }
  }
  const avg = (v) => (v.length ? v.reduce((p, q) => p + q, 0) / v.length : null);
  const tile = (l, v, sub = '') => `<div class="ms"><span>${l}</span><b class="num">${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const [y, m] = M.split('-');
  return `<div class="card"><div class="ch"><h2>Resumen del mes</h2><select class="inp sm" id="monthSel" style="width:auto">${months.map((x) => `<option value="${x}" ${x === M ? 'selected' : ''}>${MONTHS_L[+x.slice(5) - 1]} ${x.slice(0, 4)}</option>`).join('')}</select></div>
    <div class="mstats">
      ${tile('Peso (tendencia)', tr.length > 1 ? `${signed(tr[tr.length - 1] - tr[0])} kg` : '—', tr.length ? `${fmt(tr[0])} → ${fmt(tr[tr.length - 1])}` : '')}
      ${tile('Cintura', waist.length > 1 ? `${signed(waist[waist.length - 1] - waist[0])} cm` : waist.length ? `${fmt(waist[0])} cm` : '—', waist.length > 1 ? `${fmt(waist[0])} → ${fmt(waist[waist.length - 1])}` : '')}
      ${tile('Días validados', `${valid} de ${nDays}`)}
      ${tile('Kcal media', kc.length ? fmtK(avg(kc)) : '—', kc.length ? `${kc.length} días registrados` : 'sin días registrados')}
      ${tile('Proteína media', pr.length ? `${fmtK(avg(pr))} g` : '—')}
      ${tile('Sesiones', String(sess), `${sets} series`)}
      ${tile('Récords', String(prs), 'por repeticiones')}
      ${tile('Pasos · sueño', `${steps.length ? fmtK(avg(steps)) : '—'} · ${sleep.length ? fmt(avg(sleep)) + ' h' : '—'}`)}
    </div>
    <div class="muted small" style="margin-top:8px">${MONTHS_L[+m - 1][0].toUpperCase() + MONTHS_L[+m - 1].slice(1)} de ${y}.</div></div>`;
}

function formulasSheet(ctx) {
  const a = ctx.analysis();
  openSheet(`<h3>Cómo se calcula</h3><div class="muted" style="margin-bottom:6px">Métodos revisados en septiembre de 2026. Detalle y fuentes en docs/04-motor-calculo.md.</div>
    <div class="fx"><b>Tendencia de peso · filtro de Kalman</b><code>estado = [nivel, pendiente]
ruido diario σ ≈ 0,6 kg · días sin pesar = solo predicción</code><div class="muted small">Sin el retraso de la media de 7 días. Da el ritmo con su incertidumbre.</div></div>
    <div class="fx"><b>Gasto energético · TDEE adaptativo</b><code>TDEE = ingesta media 21 d − ρ · pendiente
ρ ≈ ${fmtK(a.rho)} kcal/kg · suavizado bayesiano</code><div class="muted small">Los días sin registrar comidas cuentan como el plan (si tiene kcal y un objetivo; si no, no cuentan); los que marques "me salí" en el control se excluyen.</div></div>
    <div class="fx"><b>Previsión · modelo de Hall</b><code>W(t) = W₀ + (ΔI/ε)·(1 − e^(−t·ε/ρ))
ε ≈ 24 kcal/kg/día</code><div class="muted small">Tiene en cuenta que el gasto baja al perder peso (y sube al ganarlo).</div></div>
    <div class="fx"><b>Composición · Faulkner y Navy</b><code>%G Faulkner = 0,153 · (tríceps + subesc. + supraesp. + abdominal) + 5,783
%G Navy = 495 / (1,0324 − 0,19077·log(cint − cuello) + 0,15456·log(alt)) − 450</code><div class="muted small">Rango, no número exacto. Un cambio es real si supera el mínimo detectable (cintura ${fmt(MDC.waist)} cm, pliegues ${fmt(MDC.sumSkinfolds, 0)} mm).</div></div>
    <div class="fx"><b>Objetivo de ritmo (automático)</b><code>Pérdida, según % graso:
  &gt; 20 → 0,7–1,0 · 13–20 → 0,4–0,7 · &lt; 13 → 0,25–0,5 %/sem
  (mujeres: &gt; 29 · 22–29 · &lt; 22)
Mantenimiento: estable ±${fmt(MAINTAIN_BAND, 2)} %/sem
Volumen: ganar ${fmt(GAIN_RATE[0], 2)}–${fmt(GAIN_RATE[1], 2)} %/sem
Sin objetivo: sin franja ni avisos</code><div class="muted small">En pérdida, cuanto más delgado, más lento para conservar músculo; en volumen, despacio para no ganar grasa de más. Objetivo y franja se cambian en Plan → Objetivos.</div></div>`);
}
