// Backend local para el modo demo y el desarrollo: simula el repo de datos en IndexedDB.
// Mismo interfaz que GitHubBackend. No toca la red.

import { idb } from './idb.js';
import { ConflictError } from './github.js';

const PREFIX = 'demo-remote:';

export class LocalBackend {
  constructor() {
    this.kind = 'local';
    this.commits = 0;
  }
  async check() {
    return { private: true, empty: (await idb.keys(PREFIX)).length === 0 };
  }
  async getText(path) {
    const r = await idb.get(PREFIX + path);
    return r ? { text: r.text, sha: r.sha } : null;
  }
  async putText(path, text, sha, message) {
    return this.write(path, { text }, sha, message);
  }
  async getBinary(path) {
    const r = await idb.get(PREFIX + path);
    return r ? { bytes: r.bytes, sha: r.sha } : null;
  }
  async putBinary(path, bytes, sha, message) {
    return this.write(path, { bytes }, sha, message);
  }
  async write(path, payload, sha, message) {
    const cur = await idb.get(PREFIX + path);
    if (cur && cur.sha !== sha) throw new ConflictError('sha');
    if (!cur && sha) throw new ConflictError('no existe');
    const next = `demo-${Date.now().toString(36)}-${++this.commits}`;
    await idb.set(PREFIX + path, { ...payload, sha: next, message });
    return { sha: next };
  }
  async list(dir) {
    const base = dir ? dir + '/' : '';
    const keys = await idb.keys(PREFIX + base);
    const out = [];
    for (const k of keys) {
      const path = k.slice(PREFIX.length);
      const rest = path.slice(base.length);
      if (rest.includes('/')) continue;
      out.push({ name: rest, path, sha: (await idb.get(k)).sha, type: 'file' });
    }
    return out;
  }
  static async wipe() {
    for (const k of await idb.keys(PREFIX)) await idb.del(k);
  }
}
