// Progreso: indicadores, gráficas, composición y fotos.

import { $, $$, esc, fmt, fmtK, signed, openSheet, bindSeg, icon, alertBox } from '../ui/ui.js';
import { timeChart } from '../ui/charts.js';
import { addDays, fmtShort } from '../dates.js';
import { FILES, POSES, planFor } from '../model.js';
import { hallProjection } from '../engine/energy.js';
import { rollingMean, whtrCategory, MDC } from '../engine/body.js';
import { hydratePhotos } from '../photos.js';

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
  const loss = L.rate ? -L.rate.pctWeek : null;
  const tgt = L.rateTarget;
  const inT = loss != null && loss >= tgt[0] && loss <= tgt[1];
  const eta = L.projection?.days && L.goal ? fmtShort(addDays(today, Math.round(L.projection.days))) : null;

  const kpis = `<div class="kpis">
    <button class="kpi" data-fx><div class="k">Tendencia</div><div class="v num">${fmt(L.trend.level)} <small>kg</small></div><div class="d num ${L.trend.level - back.level < 0 ? 'up' : ''}">${signed(L.trend.level - back.level)} kg en el periodo</div><div class="m">Kalman</div></button>
    <button class="kpi" data-fx><div class="k">Ritmo</div><div class="v num">${fmt(L.rate.pctWeek, 2)} <small>%/sem</small></div><div class="d num ${L.rateReliable ? (inT ? 'up' : 'warn') : 'muted'}">${L.rateReliable ? `objetivo ${fmt(tgt[0])}–${fmt(tgt[1])}` : `fiable en ${14 - L.dataDays} días`}</div><div class="m">${fmt(L.rate.kgWeek, 2)} kg/sem</div></button>
    <button class="kpi" data-fx><div class="k">Gasto energético</div><div class="v num">${L.tdeeReliable ? `${fmtK(L.tdee.E)} <small>kcal</small>` : '—'}</div><div class="d num muted">${L.tdeeReliable ? `± ${fmtK(L.tdee.sd)} kcal` : `listo en ${Math.max(0, 21 - L.dataDays)} días`}</div><div class="m">${L.tdeeAssumedShare > 0.5 ? 'Con kcal del plan' : 'TDEE adaptativo'}</div></button>
    <button class="kpi" data-fx><div class="k">Previsión</div><div class="v num">${eta || '—'}</div><div class="d num muted">${L.goal ? `${fmt(L.goal)} kg con el plan actual` : 'Pon un peso objetivo en Plan'}</div><div class="m">Modelo de Hall</div></button>
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
      return `<div><div class="shot done">${has ? `<img class="photo-img" data-photo="${FILES.photo(d, st.pose)}" alt="" hidden>` : '<span class="lbl2" style="position:relative">Sin foto</span>'}</div>
        <div class="cap">${fmtShort(d)}<span>${c.weight != null ? fmt(c.weight) + ' kg' : ''}${c.checkin.measures?.waist != null ? ` · ${fmt(c.checkin.measures.waist)} cm` : ''}</span></div></div>`;
    };
    const sel = (id, v) => `<select class="inp sm" id="${id}">${dates.map((d) => `<option value="${d}" ${d === v ? 'selected' : ''}>${fmtShort(d)}</option>`).join('')}</select>`;
    photos = `<div class="card"><div class="ch"><h2>Fotos</h2></div>
      <div class="g2" style="margin-bottom:10px">${sel('phA', A)}${sel('phB', B)}</div>
      <div class="seg" id="poseSeg" style="margin-bottom:12px">${POSES.map((p) => `<button data-v="${p.id}" class="${p.id === st.pose ? 'on' : ''}">${p.label.replace('Perfil ', 'P. ')}</button>`).join('')}</div>
      <div class="cmp">${cell(A)}${cell(B)}</div></div>`;
  }

  return `<div class="seg" id="rangeSeg" style="margin-bottom:12px">${RANGES.map(([v, l]) => `<button data-v="${v}" class="${v === st.range ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${kpis}
    ${a.alerts.length ? `<div class="card">${a.alerts.map(alertBox).join('')}</div>` : ''}
    <div class="card"><div class="ch"><h2>Peso</h2><button class="method" data-fx style="cursor:pointer">${icon.info}Cómo se calcula</button></div>
      ${weightChart}
      <div class="legend"><span><i class="dot" style="background:var(--dot)"></i>Diario</span><span><i style="background:var(--accent)"></i>Tendencia</span><span><i style="background:var(--accent-band);height:8px"></i>±1σ</span>${proj.length ? '<span><i style="background:repeating-linear-gradient(90deg,var(--accent) 0 3px,transparent 3px 6px)"></i>Previsión</span>' : ''}${events.length ? '<span><i class="dot" style="background:var(--amber)"></i>Cambio de plan</span>' : ''}</div></div>
    ${energyChart ? `<div class="card"><div class="ch"><h2>Gasto vs ingesta</h2></div>${energyChart}
      <div class="legend"><span><i style="background:var(--blue)"></i>Gasto estimado</span><span><i style="background:var(--amber)"></i>Ingesta media 7 días${L.tdeeAssumedShare > 0.5 ? ' (según plan)' : ''}</span></div></div>` : ''}
    <div class="card"><div class="ch"><h2>Medidas</h2><div class="seg" id="compSeg" style="width:180px"><button data-v="waist" class="${st.comp === 'waist' ? 'on' : ''}">Cintura</button><button data-v="sum" class="${st.comp === 'sum' ? 'on' : ''}">Σ pliegues</button></div></div>
      ${compChart}
      ${rows.length >= 2 ? `<div class="legend"><span><i style="background:var(--accent)"></i>Media de 3 controles</span><span><i class="dot" style="background:var(--dot)"></i>Medida</span><span><i style="background:var(--accent-band);height:8px"></i>Margen de error</span></div>` : ''}</div>
    ${comp}
    ${photos}`;
}

export function bind(root, ctx) {
  const st = ctx.state.prog;
  if (!st) return;
  bindSeg(root, '#rangeSeg', (v) => { st.range = +v; ctx.render(); });
  bindSeg(root, '#compSeg', (v) => { st.comp = v; ctx.render(); });
  bindSeg(root, '#poseSeg', (v) => { st.pose = v; ctx.render(); });
  $('#phA', root)?.addEventListener('change', (e) => { st.a = e.target.value; ctx.render(); });
  $('#phB', root)?.addEventListener('change', (e) => { st.b = e.target.value; ctx.render(); });
  $$('[data-fx]', root).forEach((b) => b.addEventListener('click', () => formulasSheet(ctx)));
  hydratePhotos(root, ctx.store);
}

function formulasSheet(ctx) {
  const a = ctx.analysis();
  openSheet(`<h3>Cómo se calcula</h3><div class="muted" style="margin-bottom:6px">Métodos revisados en septiembre de 2026. Detalle y fuentes en docs/04-motor-calculo.md.</div>
    <div class="fx"><b>Tendencia de peso · filtro de Kalman</b><code>estado = [nivel, pendiente]
ruido diario σ ≈ 0,6 kg · días sin pesar = solo predicción</code><div class="muted small">Sin el retraso de la media de 7 días. Da el ritmo con su incertidumbre.</div></div>
    <div class="fx"><b>Gasto energético · TDEE adaptativo</b><code>TDEE = ingesta media 21 d − ρ · pendiente
ρ ≈ ${fmtK(a.rho)} kcal/kg · suavizado bayesiano</code><div class="muted small">Los días sin registrar comidas cuentan como el plan; los que marques "me salí" en el control se excluyen.</div></div>
    <div class="fx"><b>Previsión · modelo de Hall</b><code>W(t) = W₀ + (ΔI/ε)·(1 − e^(−t·ε/ρ))
ε ≈ 24 kcal/kg/día</code><div class="muted small">Tiene en cuenta que el gasto baja al perder peso.</div></div>
    <div class="fx"><b>Composición · Faulkner y Navy</b><code>%G Faulkner = 0,153 · (tríceps + subesc. + supraesp. + abdominal) + 5,783
%G Navy = 495 / (1,0324 − 0,19077·log(cint − cuello) + 0,15456·log(alt)) − 450</code><div class="muted small">Rango, no número exacto. Un cambio es real si supera el mínimo detectable (cintura ${fmt(MDC.waist)} cm, pliegues ${fmt(MDC.sumSkinfolds, 0)} mm).</div></div>
    <div class="fx"><b>Objetivo de ritmo</b><code>% graso &gt; 20 → 0,7–1,0 %/sem
13–20 → 0,4–0,7 · &lt; 13 → 0,25–0,5</code><div class="muted small">Cuanto más delgado, más lento para conservar músculo. Editable en Plan → Objetivos.</div></div>`);
}
