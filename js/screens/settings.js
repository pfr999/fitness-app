// Ajustes: perfil, tema, día de control, conexión y exportación.

import { $, esc, fmt, num, int, toast, openSheet, closeSheet, bindSeg, segValue, download } from '../ui/ui.js';
import { FILES } from '../model.js';
import { LocalBackend } from '../data/local.js';
import { idb } from '../data/idb.js';
import { today } from '../dates.js';

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function openSettings(ctx, { saveSettings, setTheme, getTheme }) {
  const cfg = ctx.store.get(FILES.config) || {};
  const p = cfg.profile || {};
  const s = ctx.settings;
  const theme = getTheme();
  openSheet(`<h3>Ajustes</h3>
    <div class="stack" style="margin-top:12px">
      <div class="field"><label>Tema</label><div class="seg" id="sTheme">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, l]) => `<button data-v="${v}" class="${theme === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="grp">Perfil</div>
      <div class="field"><label>Sexo (para las fórmulas)</label><div class="seg" id="sSex"><button data-v="M" class="${p.sex !== 'F' ? 'on' : ''}">Hombre</button><button data-v="F" class="${p.sex === 'F' ? 'on' : ''}">Mujer</button></div></div>
      <div class="g2"><div class="field"><label for="sH">Altura (cm)</label><input class="inp" id="sH" inputmode="decimal" value="${p.height_cm ?? ''}"></div><div class="field"><label for="sY">Año de nacimiento</label><input class="inp" id="sY" inputmode="numeric" value="${p.birth_year ?? ''}"></div></div>
      <div class="field"><label for="sDay">Día del control semanal</label><select class="inp" id="sDay">${WEEKDAYS.map((d, i) => `<option value="${i}" ${(cfg.checkin_weekday ?? 0) === i ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
      <button class="btn primary" id="sSave">Guardar perfil</button>

      <div class="grp">Datos</div>
      <div class="meal"><span>Conexión</span><span class="muted" style="font-weight:700">${s.mode === 'demo' ? 'Modo demo (solo este navegador)' : `${esc(s.owner)}/${esc(s.repo)}`}</span></div>
      <button class="btn secondary" id="sExport">Exportar todos mis datos (JSON)</button>
      ${s.mode === 'demo' ? `<button class="btn secondary" id="sResetDemo">Reiniciar datos de demo</button>` : `<button class="btn secondary" id="sToken">Cambiar token</button>`}
      <button class="btn secondary" id="sLogout" style="color:var(--amber)">Desconectar este dispositivo</button>
      <div class="hint">Desconectar borra el token y la caché de este dispositivo. Tus datos siguen en GitHub.</div>
      <div class="meal"><span>Versión de la app</span><span class="muted" style="font-weight:700" id="appVer">…</span></div>
      <button class="btn secondary sm" id="checkUpd" style="width:100%">Buscar actualización</button>
    </div>`, {
    bind: (sh) => {
      bindSeg(sh, '#sTheme', (v) => setTheme(v));
      // versión: la del service worker activo (la que se está usando)
      caches.keys().then((ks) => { const k = ks.find((x) => /^recomp-v/.test(x)); $('#appVer', sh).textContent = k ? k.replace('recomp-', '') : 'sin caché'; }).catch(() => {});
      $('#checkUpd', sh).addEventListener('click', async () => {
        const reg = await navigator.serviceWorker?.getRegistration();
        if (!reg) return toast('No disponible en este navegador');
        await reg.update();
        toast(reg.installing || reg.waiting ? 'Hay versión nueva: pulsa «Actualizar» arriba' : 'Ya tienes la última versión');
      });
      bindSeg(sh, '#sSex');
      $('#sSave', sh).addEventListener('click', () => {
        ctx.store.update(FILES.config, (c) => {
          c.profile = { ...(c.profile || {}), sex: segValue(sh, '#sSex'), height_cm: num($('#sH', sh).value), birth_year: int($('#sY', sh).value) };
          c.checkin_weekday = +$('#sDay', sh).value;
          return c;
        }, 'Perfil actualizado');
        toast('Perfil guardado');
        closeSheet();
        ctx.render();
      });
      $('#sExport', sh).addEventListener('click', async () => {
        await ctx.store.flush();
        const out = {};
        for (const [path, doc] of ctx.store.docs) out[path] = doc.data;
        download(`recomp-datos-${today()}.json`, JSON.stringify(out, null, 2));
      });
      $('#sToken', sh)?.addEventListener('click', () => {
        const t = prompt('Pega el nuevo token (fine-grained, Contents: read/write)');
        if (!t) return;
        saveSettings({ ...s, token: t.trim() });
        location.reload();
      });
      $('#sResetDemo', sh)?.addEventListener('click', async () => {
        if (!confirm('¿Borrar los datos de demo y generar unos nuevos?')) return;
        await LocalBackend.wipe();
        for (const k of await idb.keys('doc:demo:')) await idb.del(k);
        for (const k of await idb.keys('pending:demo:')) await idb.del(k);
        location.reload();
      });
      $('#sLogout', sh).addEventListener('click', async () => {
        if (ctx.store.pending.size && !confirm('Hay cambios sin subir. Si desconectas se perderán. ¿Seguir?')) return;
        await ctx.store.flush();
        const ns = s.mode === 'demo' ? 'demo' : `${s.owner}/${s.repo}`;
        for (const pre of ['doc:', 'pending:', 'photo:']) for (const k of await idb.keys(`${pre}${ns}:`)) await idb.del(k);
        saveSettings(null);
        location.reload();
      });
    },
  });
}

export { fmt };
