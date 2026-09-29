// Arranque, navegación y contexto compartido por las pantallas.

import { today as todayISO, fmtLong, isoWeek } from './dates.js';
import { FILES, currentPlan } from './model.js';
import { analyze } from './engine/analysis.js';
import { Store } from './data/store.js';
import { GitHubBackend, AuthError } from './data/github.js';
import { LocalBackend } from './data/local.js';
import { $, $$, esc, toast, initSheet, icon, sheetOpen, closeSheet, consumeIgnorePop, dialogOpen, closeDialog } from './ui/ui.js';
import * as setup from './screens/setup.js';
import * as hoy from './screens/hoy.js';
import * as control from './screens/control.js';
import * as progreso from './screens/progreso.js';
import * as plan from './screens/plan.js';
import { openSettings } from './screens/settings.js';
import { seedDemo } from './screens/setup.js';
import { CLAUDE_MD, DATA_DOC_VERSION } from './claude-md.js';

/** Mantiene CLAUDE.md (instrucciones para Claude) en el repo de datos; solo escribe si cambió la versión. */
async function ensureClaudeMd(store, s) {
  const key = `claudeMd:${s.owner}/${s.repo}`;
  try {
    if (localStorage.getItem(key) === String(DATA_DOC_VERSION)) return;
    await store.putText('CLAUDE.md', CLAUDE_MD, `Instrucciones para Claude (v${DATA_DOC_VERSION})`);
    localStorage.setItem(key, String(DATA_DOC_VERSION));
  } catch { /* se reintenta en la próxima apertura */ }
}

const SCREENS = { hoy, domingo: control, progreso, plan };
const TITLES = { hoy: 'Hoy', domingo: 'Semana', progreso: 'Progreso', plan: 'Plan' };

// ---------- ajustes locales (por dispositivo) ----------
export function loadSettings() {
  try { return JSON.parse(localStorage.getItem('settings') || 'null'); } catch { return null; }
}
export function saveSettings(s) {
  try { s ? localStorage.setItem('settings', JSON.stringify(s)) : localStorage.removeItem('settings'); } catch { /* sin almacenamiento */ }
}

// ---------- contexto ----------
const ctx = {
  store: null,
  settings: null,
  state: { tab: 'hoy', hoySub: 'dia', date: todayISO() },
  _analysis: null,
  today: todayISO,
  data() {
    return { config: this.store.get(FILES.config) || {}, plan: this.store.get(FILES.plan) || { versions: [] }, days: this.store.allDays() };
  },
  analysis() {
    if (!this._analysis) this._analysis = analyze(this.data(), { today: todayISO() });
    return this._analysis;
  },
  go(tab) { go(tab); },
  render() { render(); },
  /** Navegación interna con historial: el botón «atrás» del móvil vuelve al estado anterior. */
  nav(patch) { nav(patch); },
};

// ---------- historial (botón atrás del móvil) ----------
function snapshot() {
  const s = ctx.state;
  return { tab: s.tab, hoySub: s.hoySub, planTab: s.planTab || 'rutina', date: s.date, ctlStep: s.ctl?.step ?? null };
}
function nav(patch) {
  Object.assign(ctx.state, patch);
  if ('ctlStep' in patch && ctx.state.ctl) ctx.state.ctl.step = patch.ctlStep;
  history.pushState(snapshot(), '');
  ctx.store?.flush();
  render();
  window.scrollTo({ top: 0 });
}
window.addEventListener('popstate', (e) => {
  if (consumeIgnorePop()) return;               // lo provocó cerrar una hoja desde la app
  if (dialogOpen()) { closeDialog(null, { fromPop: true }); return; }
  if (sheetOpen()) { closeSheet({ fromPop: true }); return; }
  const st = e.state;
  if (!st || !ctx.store) return;
  Object.assign(ctx.state, { tab: st.tab, hoySub: st.hoySub, planTab: st.planTab, date: st.date || ctx.state.date });
  if (ctx.state.ctl && st.ctlStep != null) ctx.state.ctl.step = st.ctlStep;
  // atrás desde el primer paso del control → vuelve a la pantalla Semana (lo revisado ya está guardado)
  if (ctx.state.ctl?.active && (st.tab !== 'domingo' || st.ctlStep == null)) ctx.state.ctl = null;
  render();
});

function backendFor(s) {
  return s.mode === 'demo' ? new LocalBackend() : new GitHubBackend({ owner: s.owner, repo: s.repo, token: s.token });
}

// ---------- ciclo de vida ----------
export async function start(settings) {
  ctx.settings = settings;
  ctx.store = new Store(backendFor(settings), { ns: settings.mode === 'demo' ? 'demo' : `${settings.owner}/${settings.repo}` });
  const store = ctx.store;
  store.addEventListener('change', (e) => {
    ctx._analysis = null;
    // Un guardado propio no repinta: lo hace la pantalla si lo necesita. Repintar a mitad de
    // escribir destruía el campo con el foco (el fallo de «duplica filas / no guarda»).
    if (!e.detail?.local) scheduleRender();
  });
  store.addEventListener('status', (e) => paintSync(e.detail.status, e.detail.error));

  const hadCache = await store.loadCache();
  if (settings.mode === 'demo') await seedDemo(store);
  if (hadCache) render();
  try {
    await store.sync();
    if (!store.get(FILES.config)) await store.ensureStructure();
    if (settings.mode !== 'demo') ensureClaudeMd(store, settings); // en segundo plano
  } catch (e) {
    if (e instanceof AuthError) {
      toast('El token no es válido o ha caducado');
      paintSync('error', e);
    } else paintSync('offline', e);
  }
  ctx._analysis = null;
  history.replaceState(snapshot(), '');
  render();
}

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    // nunca repintar mientras hay un campo con el foco: se reintenta al salir de él
    if (document.activeElement?.matches('input, textarea, select') && document.activeElement.closest('#main, #sheet')) {
      document.activeElement.addEventListener('blur', () => setTimeout(scheduleRender, 50), { once: true });
      return;
    }
    render();
  });
}

function go(tab) {
  if (tab === ctx.state.tab) { render(); return; }
  nav({ tab });
}

function render() {
  if (!ctx.store) return;
  const { tab } = ctx.state;
  $('#tabs').hidden = false;
  $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.go === tab));
  $('#title').textContent = TITLES[tab];
  $('#eyebrow').textContent = fmtLong(todayISO());
  const v = currentPlan(ctx.store.get(FILES.plan));
  const phase = [v?.phase && `Fase ${v.phase}`, v?.micro && `Micro ${v.micro}`, `Semana ${isoWeek(todayISO())}`].filter(Boolean).join(' · ');
  $('#phase').hidden = false;
  $('#phaseTxt').textContent = phase;
  $('#pip').hidden = !control.isDue(ctx);
  const main = $('#main');
  const screen = SCREENS[tab];
  main.innerHTML = screen.render(ctx);
  screen.bind?.(main, ctx);
}

function paintSync(status, err) {
  const el = $('#sync');
  const label = { idle: 'Guardado', pending: 'Pendiente', saving: 'Guardando…', error: 'Error', offline: 'Sin conexión' }[status] || '';
  el.hidden = false;
  el.className = `sync ${status}`;
  el.querySelector('span').textContent = label;
  el.title = err ? String(err.message || err) : '';
}

// ---------- tema ----------
const THEMES = ['auto', 'light', 'dark'];
export function getTheme() {
  try { return localStorage.getItem('theme') || 'auto'; } catch { return 'auto'; }
}
export function setTheme(t) {
  try { localStorage.setItem('theme', t); } catch { /* */ }
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  paintTheme();
  if (ctx.store) render();
}
function effectiveDark() {
  const t = getTheme();
  return t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
}
function paintTheme() {
  const dark = effectiveDark();
  const b = $('#themeBtn');
  b.innerHTML = dark ? icon.sun : icon.moon;
  b.setAttribute('aria-label', dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro');
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#0E1011' : '#F4F2EC');
}

// ---------- actualizaciones (service worker) ----------
/**
 * Busca versión nueva. Devuelve 'new' (hay una lista para activar), 'none' o 'error'.
 * Espera a que la nueva termine de descargarse para poder ofrecerla.
 */
export async function checkForUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return 'error';
  if (reg.waiting) return 'new';
  try { await reg.update(); } catch { return 'error'; }
  const w = reg.installing || reg.waiting;
  if (!w) return 'none';
  if (w.state === 'installed') return 'new';
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(reg.waiting ? 'new' : 'none'), 20000);
    w.addEventListener('statechange', () => {
      if (w.state === 'installed') { clearTimeout(t); resolve('new'); }
      if (w.state === 'redundant') { clearTimeout(t); resolve('error'); }
    });
  });
}

function initServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    const offer = (w) => {
      if (document.querySelector('.banner-update')) return;
      const el = document.createElement('div');
      el.className = 'banner-update';
      el.innerHTML = `<span>Nueva versión disponible</span><button type="button">Actualizar</button>`;
      el.querySelector('button').addEventListener('click', async () => {
        await ctx.store?.flush();
        w.postMessage('skipWaiting');
      });
      document.body.appendChild(el);
    };
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
    // al volver a la app (estaba en segundo plano) también se comprueba
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

// ---------- init ----------
function init() {
  // Errores visibles: sin consola en el móvil, mejor verlos en pantalla.
  const showErr = (m) => { console.error(m); toast(`Error: ${String(m).slice(0, 140)}`); document.body.dataset.error = String(m); };
  window.addEventListener('error', (e) => showErr(e.message));
  window.addEventListener('unhandledrejection', (e) => showErr(e.reason?.stack || e.reason?.message || e.reason));
  initSheet();
  paintTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paintTheme);
  $('#themeBtn').addEventListener('click', () => setTheme(effectiveDark() ? 'light' : 'dark'));
  $('#settingsBtn').addEventListener('click', () => ctx.store && openSettings(ctx, { saveSettings, setTheme, getTheme, THEMES }));
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') ctx.store?.flush(); });
  window.addEventListener('online', () => ctx.store?.flush());
  initServiceWorker();

  // Atajos de URL: #demo abre el modo demo; #hoy, #domingo, #progreso, #plan abren esa pestaña.
  const hash = location.hash.slice(1).split('/');
  if (hash[0] === 'demo' && !loadSettings()) saveSettings({ mode: 'demo' });
  const tabFromHash = hash.find((h) => SCREENS[h]);
  if (tabFromHash) ctx.state.tab = tabFromHash;

  const s = loadSettings();
  if (s) start(s);
  else {
    $('#title').textContent = 'Recomp';
    $('#eyebrow').textContent = fmtLong(todayISO());
    const main = $('#main');
    main.innerHTML = setup.render();
    setup.bind(main, { onReady: (settings) => { saveSettings(settings); start(settings); } });
  }
}

init();

export { ctx, esc };
