// Configuración inicial: conectar el repo de datos (token) o probar en modo demo.

import { $, esc } from '../ui/ui.js';
import { GitHubBackend, AuthError } from '../data/github.js';
import { LocalBackend } from '../data/local.js';
import { Store } from '../data/store.js';
import { FILES, monthKey } from '../model.js';
import { simulate } from '../demo.js';
import { today } from '../dates.js';

export function render() {
  return `<div class="setup">
    <div class="eyebrow">Configuración inicial</div>
    <h1>Conecta tu repo de datos</h1>
    <p class="muted" style="font-size:14px">Tus datos se guardan en un repo privado de tu GitHub. El token se queda solo en este dispositivo.</p>
    <div class="card">
      <div class="stack">
        <div class="g2">
          <div class="field"><label for="owner">Usuario de GitHub</label><input class="inp" id="owner" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="usuario"></div>
          <div class="field"><label for="repo">Repo de datos</label><input class="inp" id="repo" autocapitalize="off" spellcheck="false" value="fitness-data"></div>
        </div>
        <div class="field"><label for="token">Token (fine-grained)</label><input class="inp" id="token" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></div>
        <button class="btn primary" id="connect">Conectar</button>
        <div class="err" id="err" hidden></div>
      </div>
    </div>
    <details class="card flat">
      <summary class="link" style="list-style:none;cursor:pointer">Cómo crear el token</summary>
      <ol>
        <li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token.</li>
        <li>Repository access: <b>Only select repositories</b> → tu repo de datos.</li>
        <li>Permissions → Repository permissions → <b>Contents: Read and write</b>.</li>
        <li>Caducidad: la más larga posible. La app te avisará cuando falle.</li>
      </ol>
    </details>
    <button class="btn secondary" id="demo">Probar en modo demo</button>
    <div class="hint" style="text-align:center">El modo demo usa datos inventados y guarda solo en este navegador.</div>
  </div>`;
}

export function bind(root, { onReady }) {
  const err = $('#err', root);
  const show = (m) => { err.hidden = false; err.textContent = m; };
  $('#connect', root).addEventListener('click', async (e) => {
    const owner = $('#owner', root).value.trim(), repo = $('#repo', root).value.trim(), token = $('#token', root).value.trim();
    if (!owner || !repo || !token) return show('Rellena usuario, repo y token.');
    e.target.disabled = true; e.target.textContent = 'Comprobando…'; err.hidden = true;
    try {
      const be = new GitHubBackend({ owner, repo, token });
      const info = await be.check();
      if (!info.private) {
        show('Ese repo es público. Tus datos deben ir en un repo privado.');
        return;
      }
      const store = new Store(be, { ns: `${owner}/${repo}` });
      e.target.textContent = 'Preparando el repo…';
      await store.ensureStructure();
      onReady({ mode: 'github', owner, repo, token });
    } catch (x) {
      show(x instanceof AuthError ? `No se pudo acceder: ${esc(x.message)}. Revisa usuario, repo y permisos del token.` : `Error de conexión: ${esc(x.message)}`);
    } finally {
      e.target.disabled = false; e.target.textContent = 'Conectar';
    }
  });
  $('#demo', root).addEventListener('click', () => onReady({ mode: 'demo' }));
}

/** Rellena el backend local con datos simulados si está vacío. */
export async function seedDemo(store) {
  const be = store.backend;
  if (!(be instanceof LocalBackend)) return;
  if (await be.getText(FILES.config)) return;
  const sim = simulate({ today: today(), weeks: 12, W0: 88, trueE: 2950, planKcal: [2700, 2400] });
  sim.plan.versions[0].diet = {
    kcal: { train: 2700, rest: 2400 }, protein_g: 190, carbs_g: 290, fat_g: 75,
    meals: [
      { slot: 'Desayuno', portions: { P: 2, C: 3, G: 1 } },
      { slot: 'Comida', portions: { P: 3, C: 3, G: 2 } },
      { slot: 'Merienda', portions: { P: 2, C: 2, G: 1 } },
      { slot: 'Cena', portions: { P: 3, C: 2, G: 2 } },
    ],
    rules: ['Comida libre opcional el sábado en la cena (máx. 1.000 kcal).'],
  };
  sim.plan.versions[0].routine = {
    days: [
      { name: 'Día 1 · Pierna', items: [
        { name: 'Sentadilla', sets: 4, reps: [6, 8], rpe: 8, note: '' },
        { name: 'Peso muerto rumano', sets: 3, reps: [8, 10], rpe: 8, note: '' },
        { name: 'Prensa', sets: 3, reps: [10, 12], rpe: 9, note: '' },
      ] },
      { name: 'Día 2 · Torso', items: [
        { name: 'Press banca', sets: 4, reps: [6, 8], rpe: 8, note: '' },
        { name: 'Remo con barra', sets: 4, reps: [8, 10], rpe: 8, note: '' },
        { name: 'Elevaciones laterales', sets: 3, reps: [12, 15], rpe: 9, note: 'Plano escapular' },
      ] },
    ],
  };
  sim.plan.versions[0].supplements = [
    { name: 'Creatina', dose: '5 g', timing: 'Con una comida', kind: 'supplement' },
    { name: 'Vitamina D3', dose: '1 cápsula', timing: 'Desayuno', kind: 'supplement' },
  ];
  sim.plan.versions[0].targets.sessions = 4;
  await be.putText(FILES.config, JSON.stringify(sim.config, null, 2), null, 'demo');
  await be.putText(FILES.plan, JSON.stringify(sim.plan, null, 2), null, 'demo');
  for (const f of [FILES.exercises, FILES.foods, FILES.events, FILES.labs]) await be.putText(f, '{}', null, 'demo');
  const months = {};
  for (const [d, v] of Object.entries(sim.days)) (months[monthKey(d)] ||= {})[d] = v;
  for (const [ym, m] of Object.entries(months)) await be.putText(FILES.month(ym), JSON.stringify(m), null, 'demo');
}
