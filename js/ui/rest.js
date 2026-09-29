// Temporizador de descanso entre series (barra fija abajo) y pantalla encendida durante el entreno.
// Se calcula con la hora de fin, no contando ticks: sigue bien aunque el móvil congele la pestaña.

let st = null;      // { end, total, label, buzzed }
let tick = null;

const save = () => { try { st ? sessionStorage.setItem('rest', JSON.stringify(st)) : sessionStorage.removeItem('rest'); } catch { /* sin almacenamiento */ } };
const fmtT = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function el() {
  let e = document.getElementById('rest');
  if (e) return e;
  e = document.createElement('div');
  e.id = 'rest';
  e.className = 'rest';
  e.setAttribute('role', 'timer');
  e.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-r]');
    if (!b || !st) return;
    if (b.dataset.r === 'skip') stopRest();
    else { st.end += +b.dataset.r * 1000; st.total = Math.max(st.total, Math.round((st.end - Date.now()) / 1000)); st.buzzed = false; save(); paint(); }
  });
  document.body.appendChild(e);
  return e;
}

function paint() {
  const e = el();
  if (!st) { e.classList.remove('on'); clearInterval(tick); tick = null; return; }
  const left = Math.round((st.end - Date.now()) / 1000);
  if (left < -300) { stopRest(); return; } // 5 min pasado: se da por terminado
  if (left <= 0 && !st.buzzed) { st.buzzed = true; save(); try { navigator.vibrate?.([180, 90, 180]); } catch { /* */ } }
  const over = left < 0;
  e.innerHTML = `<div class="rest-t"><div class="rest-l">${over ? 'Descanso · te estás pasando' : `Descanso${st.label ? ` · ${st.label}` : ''}`}</div>
    <div class="rest-v num ${over ? 'over' : ''}">${over ? '+' : ''}${fmtT(Math.abs(left))}</div>
    <div class="rest-b"><i style="width:${over ? 100 : Math.max(0, Math.min(100, (1 - left / st.total) * 100))}%"></i></div></div>
    <button type="button" data-r="-15">−15</button><button type="button" data-r="15">+15</button><button type="button" data-r="skip">Saltar</button>`;
  e.classList.add('on');
}

/** Arranca (o reinicia) el descanso. */
export function startRest(sec, label = '') {
  st = { end: Date.now() + sec * 1000, total: sec, label, buzzed: false };
  save(); paint();
  if (!tick) tick = setInterval(paint, 500);
}
export function stopRest() { st = null; save(); paint(); }

/** Al arrancar la app: recupera un descanso en curso (p. ej. tras recargar). */
export function initRest() {
  try { st = JSON.parse(sessionStorage.getItem('rest') || 'null'); } catch { st = null; }
  if (st) { paint(); tick = setInterval(paint, 500); }
}

// ---------- pantalla encendida (Screen Wake Lock) ----------
let lock = null, want = false;
async function acquire() {
  if (!want || lock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try { lock = await navigator.wakeLock.request('screen'); lock.addEventListener('release', () => { lock = null; }); } catch { lock = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') acquire(); });
export const wakeSupported = () => 'wakeLock' in navigator;
/** Mantener la pantalla encendida mientras `on` (se pide al entrar en el entreno de hoy). */
export function keepAwake(on) {
  want = on;
  if (on) acquire();
  else if (lock) { lock.release().catch(() => {}); lock = null; }
}
