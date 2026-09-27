// Gráficas SVG propias (sin librerías). Eje X por fechas 'AAAA-MM-DD'.

import { daysBetween, fmtShort, parseISO } from '../dates.js';
import { fmt } from './ui.js';

function niceStep(r) {
  if (r > 1500) return 500;
  if (r > 800) return 200;
  if (r > 300) return 100;
  if (r > 60) return 20;
  if (r > 25) return 10;
  if (r > 12) return 4;
  if (r > 6) return 2;
  if (r > 3) return 1;
  return 0.5;
}

/**
 * @param {object} o
 * @param {string} o.from, o.to        dominio X
 * @param {Array} o.layers             [{kind:'dots'|'line'|'band'|'dash', points:[{d, y}|{d, lo, hi}], color, width, marks}]
 * @param {Array} [o.events]           [{d, color}]
 * @param {Array} [o.bands]            [{from, to, label}]  (fases sombreadas)
 * @param {{d:string, y:number, text:string}} [o.label]  etiqueta del último valor
 */
export function timeChart({ width = 360, height = 200, from, to, layers, events = [], bands = [], label, yPad = 0.08, dec = 0, today = null }) {
  const pl = 36, pr = 8, pt = 16, pb = 24;
  const ys = layers.flatMap((l) => l.points.filter((p) => p.d >= from && p.d <= to).flatMap((p) => (l.kind === 'band' ? [p.lo, p.hi] : [p.y]))).filter((v) => v != null && Number.isFinite(v));
  if (!ys.length) return '';
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 1e-6) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * yPad; lo -= pad; hi += pad;
  const span = Math.max(1, daysBetween(from, to));
  const X = (d) => pl + (daysBetween(from, d) / span) * (width - pl - pr);
  const Y = (v) => pt + ((hi - v) / (hi - lo)) * (height - pt - pb);
  const P = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  let o = '';
  // rejilla
  const step = niceStep(hi - lo);
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    o += `<line x1="${pl}" x2="${width - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/>`;
    o += `<text x="${pl - 6}" y="${Y(v) + 3.5}" font-size="10" text-anchor="end" fill="var(--ink-3)" font-weight="600">${fmt(v, step < 1 ? 1 : dec)}</text>`;
  }
  // fases
  for (const b of bands) {
    const a = Math.max(X(b.from < from ? from : b.from), pl), z = Math.min(X(b.to > to ? to : b.to), width - pr);
    if (z <= a) continue;
    o += `<rect x="${a}" y="${pt}" width="${z - a}" height="${height - pt - pb}" fill="var(--phase)"/>`;
    if (b.label) o += `<text x="${a + 5}" y="${pt + 11}" font-size="9.5" font-weight="800" fill="var(--accent)" letter-spacing=".06em">${b.label}</text>`;
  }
  if (today && today >= from && today <= to) o += `<line x1="${X(today)}" x2="${X(today)}" y1="${pt}" y2="${height - pb}" stroke="var(--line-2)" stroke-dasharray="2 3"/>`;
  // capas
  for (const l of layers) {
    const pts = l.points.filter((p) => p.d >= from && p.d <= to && (l.kind === 'band' ? p.lo != null : p.y != null));
    if (!pts.length) continue;
    if (l.kind === 'band') {
      o += `<path d="M${pts.map((p) => P(X(p.d), Y(p.hi))).join('L')}L${pts.slice().reverse().map((p) => P(X(p.d), Y(p.lo))).join('L')}Z" fill="${l.color || 'var(--accent-band)'}"/>`;
    } else if (l.kind === 'dots') {
      for (const p of pts) o += `<circle cx="${X(p.d).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${l.r || 2.3}" fill="${l.color || 'var(--dot)'}"/>`;
    } else {
      const dash = l.kind === 'dash' ? 'stroke-dasharray="4 4"' : '';
      o += `<path d="M${pts.map((p) => P(X(p.d), Y(p.y))).join('L')}" fill="none" stroke="${l.color}" stroke-width="${l.width || 2.6}" stroke-linecap="round" stroke-linejoin="round" ${dash}/>`;
      if (l.marks) for (const p of pts) o += `<circle cx="${X(p.d)}" cy="${Y(p.y)}" r="3.2" fill="var(--surface)" stroke="${l.color}" stroke-width="2"/>`;
    }
  }
  // eventos
  for (const e of events) {
    if (e.d < from || e.d > to) continue;
    const x = X(e.d);
    o += `<line x1="${x}" x2="${x}" y1="${pt + 14}" y2="${height - pb}" stroke="${e.color || 'var(--amber)'}" stroke-width="1.2" stroke-dasharray="3 3"/><circle cx="${x}" cy="${height - pb}" r="4" fill="${e.color || 'var(--amber)'}" stroke="var(--surface)" stroke-width="2"/>`;
  }
  // etiqueta del último valor
  if (label) {
    const x = X(label.d), y = Y(label.y), w = Math.max(40, label.text.length * 7 + 12);
    o += `<circle cx="${x}" cy="${y}" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2.5"/>`;
    o += `<rect x="${x - w - 6}" y="${y - 30}" width="${w}" height="20" rx="7" fill="var(--ink)"/><text x="${x - w / 2 - 6}" y="${y - 16}" font-size="11" font-weight="800" text-anchor="middle" fill="var(--bg)">${label.text}</text>`;
  }
  // eje X: día 1 y 15 de cada mes (o semanas si el rango es corto)
  const ticks = [];
  const d0 = parseISO(from);
  for (let i = 0; i <= span; i++) {
    const d = new Date(d0); d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const day = d.getDate();
    if (span > 45 ? day === 1 || day === 15 : span > 14 ? day % 7 === 1 : true) ticks.push(iso);
  }
  const every = Math.ceil(ticks.length / 6);
  ticks.filter((_, i) => i % every === 0).forEach((d) => (o += `<text x="${X(d)}" y="${height - 6}" font-size="10" text-anchor="middle" fill="var(--ink-3)" font-weight="600">${fmtShort(d)}</text>`));
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">${o}</svg>`;
}

export function sparkline(values, { color = 'var(--accent)', w = 90, h = 30 } = {}) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 4 - ((x - lo) / r) * (h - 10)).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function ring({ value, max, label, sub }) {
  const C = 276.5, pct = Math.max(0, Math.min(1, max ? value / max : 0));
  return `<svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label="${label}">
    <circle cx="52" cy="52" r="44" fill="none" stroke="var(--sunken)" stroke-width="10"/>
    <circle cx="52" cy="52" r="44" fill="none" stroke="var(--accent)" stroke-width="10" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}" transform="rotate(-90 52 52)"/>
    <text x="52" y="50" text-anchor="middle" font-size="20" font-weight="800" fill="var(--ink)">${label}</text>
    <text x="52" y="67" text-anchor="middle" font-size="10.5" font-weight="700" fill="var(--ink-3)">${sub}</text></svg>`;
}
