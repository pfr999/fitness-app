import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Store } from '../js/data/store.js';
import { ConflictError } from '../js/data/github.js';
import { utf8ToB64, b64ToUtf8 } from '../js/data/github.js';

// Backend en memoria que cuenta commits
class MemBackend {
  constructor() { this.files = new Map(); this.commits = []; this.n = 0; }
  async check() { return { empty: this.files.size === 0 }; }
  async getText(path) { const f = this.files.get(path); return f ? { text: f.text, sha: f.sha } : null; }
  async putText(path, text, sha, message) {
    const cur = this.files.get(path);
    if ((cur && cur.sha !== sha) || (!cur && sha)) throw new ConflictError('sha');
    const next = `s${++this.n}`;
    this.files.set(path, { text, sha: next });
    this.commits.push({ path, message });
    return { sha: next };
  }
  async list(dir) {
    const base = dir ? dir + '/' : '';
    return [...this.files.entries()].filter(([p]) => p.startsWith(base) && !p.slice(base.length).includes('/')).map(([path, f]) => ({ name: path.split('/').pop(), path, sha: f.sha }));
  }
}

test('base64 UTF-8 ida y vuelta', () => {
  const s = 'Cintura −0,6 cm · Pájaros ✓';
  assert.equal(b64ToUtf8(utf8ToB64(s)), s);
});

test('estructura inicial crea los ficheros raíz', async () => {
  const be = new MemBackend();
  const st = new Store(be, { ns: 't1' });
  await st.ensureStructure();
  assert.ok(be.files.has('config.json') && be.files.has('plan.json'));
  assert.ok(st.get('plan.json').versions.length === 1);
});

test('cambios seguidos en un fichero = un solo commit con mensaje combinado', async () => {
  const be = new MemBackend();
  const st = new Store(be, { ns: 't2' });
  st.updateDay('2026-09-28', (d) => { d.weight = 99.4; }, 'Peso 28 sep: 99,4 kg');
  st.updateDay('2026-09-28', (d) => { d.steps = 9820; }, 'Pasos 28 sep');
  st.updateDay('2026-09-29', (d) => { d.weight = 99.2; }, 'Peso 29 sep: 99,2 kg');
  assert.equal(st.status, 'pending');
  await st.flush();
  assert.equal(be.commits.length, 1);
  assert.equal(be.commits[0].message, 'Peso 28 sep: 99,4 kg · Pasos 28 sep · Peso 29 sep: 99,2 kg');
  const saved = JSON.parse(be.files.get('days/2026-09.json').text);
  assert.deepEqual(saved['2026-09-28'], { weight: 99.4, steps: 9820 });
  assert.equal(st.status, 'idle');
  // una línea por día en el fichero
  assert.equal(be.files.get('days/2026-09.json').text.split('\n').length, 5);
});

test('conflicto: otro dispositivo escribió antes → se reaplican los cambios sobre el remoto', async () => {
  const be = new MemBackend();
  const a = new Store(be, { ns: 't3a' });
  a.updateDay('2026-09-28', (d) => { d.weight = 99.4; }, 'Peso');
  await a.flush();

  const b = new Store(be, { ns: 't3b' });
  await b.sync();
  b.updateDay('2026-09-28', (d) => { d.steps = 5000; }, 'Pasos desde B');
  await b.flush();

  // A no sabe que B escribió; su sha está desfasado
  a.updateDay('2026-09-28', (d) => { d.sleep_h = 7.5; }, 'Sueño desde A');
  await a.flush();

  const saved = JSON.parse(be.files.get('days/2026-09.json').text);
  assert.deepEqual(saved['2026-09-28'], { weight: 99.4, steps: 5000, sleep_h: 7.5 });
});

test('borrar todos los campos de un día elimina el día', async () => {
  const be = new MemBackend();
  const st = new Store(be, { ns: 't4' });
  st.updateDay('2026-09-28', (d) => { d.weight = 99; }, 'Peso');
  st.updateDay('2026-09-28', (d) => { delete d.weight; }, 'Borra peso');
  await st.flush();
  assert.deepEqual(JSON.parse(be.files.get('days/2026-09.json').text), {});
});

test('sync solo descarga meses cuyo sha cambió', async () => {
  const be = new MemBackend();
  const w = new Store(be, { ns: 't5w' });
  await w.ensureStructure();
  w.updateDay('2026-08-01', (d) => { d.weight = 100; }, 'a');
  w.updateDay('2026-09-01', (d) => { d.weight = 99; }, 'b');
  await w.flush();

  const r = new Store(be, { ns: 't5r' });
  let gets = 0;
  const orig = be.getText.bind(be);
  be.getText = async (p) => { gets++; return orig(p); };
  await r.sync();
  const first = gets;
  gets = 0;
  await r.sync();
  assert.ok(first >= 8);
  assert.equal(gets, 0, 'segunda vez: nada ha cambiado, no se descarga nada');
  assert.equal(r.allDays()['2026-08-01'].weight, 100);
});

test('sin conexión: los cambios y las fotos esperan en el móvil y se suben al volver la red', async () => {
  const { NetworkError } = await import('../js/data/github.js');
  class Flaky extends MemBackend {
    constructor() { super(); this.offline = false; this.bin = new Map(); }
    async putText(...a) { if (this.offline) throw new NetworkError('sin red'); return super.putText(...a); }
    async putBinary(path, bytes) { if (this.offline) throw new NetworkError('sin red'); this.bin.set(path, bytes); return { sha: 'b1' }; }
    async getBinary(path) { return this.bin.has(path) ? { bytes: this.bin.get(path), sha: 'b1' } : null; }
  }
  const be = new Flaky();
  const st = new Store(be, { ns: 't-off' });
  await st.ensureStructure();
  be.offline = true;
  st.updateDay('2026-09-29', (d) => { d.weight = 84.1; }, 'Peso');
  const up = await st.putPhoto('fotos/2026-09-29/front.jpg', new Uint8Array([1, 2, 3]), 'Foto');
  assert.equal(up, false, 'la foto queda pendiente');
  await st.flush();
  assert.equal(st.status, 'offline');
  assert.equal(st.day('2026-09-29').weight, 84.1, 'el dato se ve igual sin conexión');
  assert.deepEqual([...await st.getPhoto('fotos/2026-09-29/front.jpg')], [1, 2, 3], 'la foto se ve desde el móvil');
  be.offline = false;
  await st.flush();
  assert.equal(st.status, 'idle');
  assert.ok(be.files.has('days/2026-09.json'));
  assert.ok(be.bin.has('fotos/2026-09-29/front.jpg'));
  clearTimeout(st.timer);
});
