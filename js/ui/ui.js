// Utilidades de interfaz: formato, escape, toast, hoja inferior e iconos.

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escapa texto del usuario antes de meterlo en HTML. Usar SIEMPRE con datos. */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function fmt(n, d = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  const s = Math.abs(n).toFixed(d).replace('.', ',');
  const [int, dec] = s.split(',');
  const withDots = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (n < 0 && Number(s.replace(',', '.')) !== 0 ? '−' : '') + withDots + (dec ? ',' + dec : '');
}
export const fmtK = (n) => fmt(n, 0);
export const signed = (n, d = 1) => (n > 0 ? '+' : '') + fmt(n, d);

/** Lee un número escrito con coma o punto decimal. Vacío o inválido → null. */
export function num(v) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
/** Entero; admite separador de miles con punto ("9.820"). */
export function int(v) {
  const s = String(v ?? '').trim().replace(/[.\s]/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// ---------- toast ----------
let toastTimer;
/** Aviso breve. Con `action` ({label, fn}) muestra un botón (p. ej. «Deshacer») y dura más. */
export function toast(text, { action = null } = {}) {
  const el = $('#toast');
  el.querySelector('span').textContent = text;
  el.querySelector('button')?.remove();
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { el.classList.remove('on'); action.fn(); });
    el.appendChild(b);
  }
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), action ? 7000 : 2200);
}

// ---------- hoja inferior ----------
let onClose = null;
let ignorePop = false;
export const sheetOpen = () => $('#scrim').classList.contains('on');
export function openSheet(html, { bind, close } = {}) {
  const sheet = $('#sheet');
  sheet.innerHTML = '<div class="grab"></div>' + html;
  // una entrada en el historial por hoja abierta: el botón «atrás» del móvil la cierra
  if (!sheetOpen()) history.pushState({ ...(history.state || {}), sheet: true }, '');
  $('#scrim').classList.add('on');
  onClose = close || null;
  bind?.(sheet);
  const first = sheet.querySelector('[autofocus]');
  if (first) setTimeout(() => first.focus(), 250);
  return sheet;
}
export function closeSheet({ fromPop = false } = {}) {
  if (!sheetOpen()) return;
  $('#scrim').classList.remove('on');
  const cb = onClose; onClose = null;
  cb?.();
  // cerrada desde la app (no con «atrás»): quitar su entrada del historial
  if (!fromPop && history.state?.sheet) { ignorePop = true; history.back(); }
}
/** Para app.js: ¿este popstate lo provocó closeSheet? */
export function consumeIgnorePop() {
  const v = ignorePop; ignorePop = false; return v;
}
export function initSheet() {
  $('#scrim').addEventListener('click', (e) => { if (e.target.id === 'scrim') closeSheet(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (dialogOpen()) closeDialog(null); else closeSheet(); } });
}

// ---------- diálogo propio (sustituye a confirm/prompt del navegador) ----------
let dlgResolve = null;
export const dialogOpen = () => !!document.getElementById('dlg')?.classList.contains('on');

function dialogEl() {
  let el = document.getElementById('dlg');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'dlg';
  el.className = 'dlg-scrim';
  el.innerHTML = '<div class="dlg" role="alertdialog" aria-modal="true"></div>';
  el.addEventListener('click', (e) => { if (e.target === el) closeDialog(null); });
  document.body.appendChild(el);
  return el;
}

/** Cierra el diálogo con un resultado. fromPop: lo cerró el botón «atrás». */
export function closeDialog(value, { fromPop = false } = {}) {
  const el = document.getElementById('dlg');
  if (!el?.classList.contains('on')) return;
  el.classList.remove('on');
  const r = dlgResolve; dlgResolve = null;
  if (!fromPop && history.state?.dialog) { ignorePop = true; history.back(); }
  r?.(value);
}

function showDialog(html, bind) {
  const el = dialogEl();
  el.querySelector('.dlg').innerHTML = html;
  if (!el.classList.contains('on')) history.pushState({ ...(history.state || {}), dialog: true }, '');
  el.classList.add('on');
  return new Promise((resolve) => { dlgResolve = resolve; bind(el); });
}

/**
 * Pregunta de confirmación. Devuelve true/false.
 * ask({ title, text, ok = 'Aceptar', cancel = 'Cancelar', danger = false })
 */
export function ask({ title, text = '', ok = 'Aceptar', cancel = 'Cancelar', danger = false }) {
  return showDialog(`<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
    <div class="dlg-actions"><button type="button" class="btn secondary" data-r="0">${esc(cancel)}</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div>`,
  (el) => {
    el.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => closeDialog(b.dataset.r === '1')));
    setTimeout(() => el.querySelector('[data-r="1"]')?.focus(), 50);
  }).then((v) => v === true);
}

/** Pide un texto. Devuelve el texto o null si se cancela. */
export function askText({ title, text = '', placeholder = '', ok = 'Guardar', type = 'text' }) {
  return showDialog(`<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
    <input class="inp" id="dlgIn" type="${type}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false">
    <div class="dlg-actions"><button type="button" class="btn secondary" data-r="0">Cancelar</button><button type="button" class="btn primary" data-r="1">${esc(ok)}</button></div>`,
  (el) => {
    const inp = el.querySelector('#dlgIn');
    el.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => closeDialog(b.dataset.r === '1' ? inp.value.trim() || null : null)));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') closeDialog(inp.value.trim() || null); });
    setTimeout(() => inp.focus(), 50);
  });
}

/** Segmentado / chips: marca el pulsado y llama a fn(valor). */
export function bindSeg(root, sel, fn) {
  $$(sel + ' button', root).forEach((b) =>
    b.addEventListener('click', () => {
      $$(sel + ' button', root).forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      fn?.(b.dataset.v, b);
    }),
  );
}
export const segValue = (root, sel) => $(sel + ' button.on', root)?.dataset.v ?? null;

// ---------- iconos (trazo) ----------
const I = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const icon = {
  check: I('<path d="M5 12l5 5 9-10"/>', 'stroke-width="2.6"'),
  chevron: I('<path d="M9 6l6 6-6 6"/>', 'stroke-width="2.4"'),
  back: I('<path d="M15 6l-6 6 6 6"/>', 'stroke-width="2.4"'),
  down: I('<path d="M6 9l6 6 6-6"/>', 'stroke-width="2.2"'),
  up: I('<path d="M6 15l6-6 6 6"/>', 'stroke-width="2.2"'),
  plus: I('<path d="M12 5v14M5 12h14"/>'),
  edit: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  trash: I('<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>'),
  camera: I('<rect x="3" y="6" width="18" height="14" rx="3"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/>'),
  info: I('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8v.01"/>', 'stroke-width="2.2"'),
  warn: I('<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.01"/>', 'stroke-width="2.2"'),
  copy: I('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  flame: I('<path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 1 2 3 3 3 3s0-4 0-8z"/>'),
  target: I('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  list: I('<path d="M4 6h16M4 12h10M4 18h6"/>'),
  pill: I('<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M12 8v8"/>'),
  sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: I('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  auto: I('<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>'),
  dumbbell: I('<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>'),
  sunday: I('<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/>'),
};

export function alertBox(a) {
  const cls = a.tone === 'warn' ? 'a' : a.tone === 'good' ? 'g' : 'b';
  const ic = a.tone === 'warn' ? icon.warn : a.tone === 'good' ? icon.check : icon.info;
  return `<div class="alert ${cls}">${ic}<div><b>${esc(a.title)}</b>${esc(a.text)}</div></div>`;
}

/** Descarga un fichero generado en el navegador. */
export function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
