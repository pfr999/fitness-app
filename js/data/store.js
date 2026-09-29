// Store: documentos JSON del repo de datos con caché local y guardado agrupado.
//
// - Lectura: arranca desde la caché (instantáneo) y refresca en segundo plano comparando sha.
// - Escritura optimista: update() cambia el dato al momento y programa el guardado.
// - Los cambios seguidos sobre un mismo fichero se agrupan en un solo commit.
// - Conflicto (otro dispositivo escribió antes): se recarga el remoto y se reaplican los cambios.

import { idb } from './idb.js';
import { ConflictError, NetworkError } from './github.js';
import { FILES, emptyDocs, monthKey } from '../model.js';

const CACHE = 'doc:';
const PENDING = 'pending:';
const PHOTOQ = 'photoq:'; // fotos hechas sin conexión, por subir
const DEBOUNCE_MS = 4000;

export class Store extends EventTarget {
  constructor(backend, { ns = 'main' } = {}) {
    super();
    this.backend = backend;
    this.ns = ns;
    this.docs = new Map(); // path → {data, sha}
    this.pending = new Map(); // path → {mutators:[fn], messages:[str]}
    this.photoQ = new Map(); // path → message (fotos por subir)
    this.timer = null;
    this.status = 'idle'; // idle | pending | saving | error | offline
    this.lastError = null;
  }

  key(prefix, path) {
    return `${prefix}${this.ns}:${path}`;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  setStatus(s, err = null) {
    this.status = s;
    this.lastError = err;
    this.emit('status', { status: s, error: err });
  }

  get(path) {
    return this.docs.get(path)?.data;
  }

  // ---------- carga ----------

  /** Carga desde caché. Devuelve true si había datos. */
  async loadCache() {
    const keys = await idb.keys(this.key(CACHE, ''));
    for (const k of keys) {
      const path = k.slice(this.key(CACHE, '').length);
      this.docs.set(path, await idb.get(k));
    }
    // cambios que no se llegaron a subir (app cerrada a medias)
    for (const k of await idb.keys(this.key(PENDING, ''))) {
      const path = k.slice(this.key(PENDING, '').length);
      const p = await idb.get(k);
      this.pending.set(path, { mutators: [], messages: p.messages, orphan: true });
    }
    for (const k of await idb.keys(this.key(PHOTOQ, ''))) this.photoQ.set(k.slice(this.key(PHOTOQ, '').length), (await idb.get(k))?.message || '');
    if (this.pending.size || this.photoQ.size) this.schedule(500);
    return this.docs.size > 0;
  }

  /** Refresca desde el backend: ficheros raíz + todos los meses. Solo baja lo que cambió. */
  async sync() {
    const roots = [FILES.config, FILES.plan, FILES.exercises, FILES.foods, FILES.events, FILES.labs];
    const [rootList, months] = await Promise.all([this.backend.list(''), this.backend.list('days')]);
    const rootSha = Object.fromEntries(rootList.map((f) => [f.path, f.sha]));
    const wanted = [...roots.filter((p) => rootSha[p]).map((p) => ({ path: p, sha: rootSha[p] })), ...months.filter((m) => m.name.endsWith('.json')).map((m) => ({ path: m.path, sha: m.sha }))];
    await Promise.all(
      wanted.map(async ({ path, sha }) => {
        if (this.pending.has(path)) return; // no pisar cambios locales sin subir
        const cached = this.docs.get(path);
        if (sha && cached?.sha === sha) return;
        const r = await this.backend.getText(path);
        if (!r) return;
        await this.cacheDoc(path, { data: JSON.parse(r.text), sha: r.sha });
      }),
    );
    this.emit('change', { paths: wanted.map((w) => w.path) });
  }

  async cacheDoc(path, doc) {
    this.docs.set(path, doc);
    await idb.set(this.key(CACHE, path), doc);
  }

  /** Crea la estructura inicial si el repo está vacío. */
  async ensureStructure() {
    const docs = emptyDocs();
    for (const [path, data] of Object.entries(docs)) {
      const r = await this.backend.getText(path);
      if (r) {
        await this.cacheDoc(path, { data: JSON.parse(r.text), sha: r.sha });
      } else {
        const { sha } = await this.backend.putText(path, JSON.stringify(data, null, 2) + '\n', null, `Estructura inicial: ${path}`);
        await this.cacheDoc(path, { data, sha });
      }
    }
  }

  // ---------- días ----------

  /** Mapa fecha → día con todos los meses cargados. */
  allDays() {
    const out = {};
    for (const [path, doc] of this.docs) if (path.startsWith('days/')) Object.assign(out, doc.data);
    return out;
  }

  day(date) {
    return this.get(FILES.month(monthKey(date)))?.[date] || {};
  }

  /** Modifica un día. `fn(day)` muta el objeto. */
  updateDay(date, fn, message) {
    return this.update(
      FILES.month(monthKey(date)),
      (month) => {
        const m = month || {};
        const d = m[date] || {};
        fn(d);
        prune(d);
        if (Object.keys(d).length) m[date] = d;
        else delete m[date];
        return sortKeys(m);
      },
      message,
    );
  }

  // ---------- escritura ----------

  /** Cambio optimista de un documento. `fn(data)` devuelve el nuevo dato (puede mutar el recibido). */
  update(path, fn, message) {
    const cur = this.docs.get(path);
    const base = cur ? structuredClone(cur.data) : undefined;
    const next = fn(base) ?? base;
    this.docs.set(path, { data: next, sha: cur?.sha ?? null });
    idb.set(this.key(CACHE, path), this.docs.get(path));
    const p = this.pending.get(path) || { mutators: [], messages: [] };
    p.mutators.push(fn);
    if (message && !p.messages.includes(message)) p.messages.push(message);
    this.pending.set(path, p);
    idb.set(this.key(PENDING, path), { messages: p.messages });
    this.emit('change', { paths: [path], local: true }); // la pantalla que guarda decide si repinta
    this.setStatus('pending');
    this.schedule();
  }

  schedule(ms = DEBOUNCE_MS) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), ms);
  }

  /** Sube todo lo pendiente ya (al cambiar de pantalla o cerrar). */
  async flush() {
    clearTimeout(this.timer);
    if ((!this.pending.size && !this.photoQ.size) || this.flushing) return this.flushing;
    this.setStatus('saving');
    this.flushing = (async () => {
      try {
        for (const [path, message] of [...this.photoQ]) {
          const local = await idb.get(this.key('photo:', path));
          if (local?.bytes) await this.uploadPhoto(path, local.bytes, message);
          this.photoQ.delete(path);
          await idb.del(this.key(PHOTOQ, path));
        }
        for (const [path, p] of [...this.pending]) {
          await this.pushOne(path, p);
          // si durante la subida entraron más cambios, se quedan para la siguiente
          const after = this.pending.get(path);
          if (after === p) {
            this.pending.delete(path);
            await idb.del(this.key(PENDING, path));
          }
        }
        this.setStatus(this.pending.size ? 'pending' : 'idle');
        if (this.pending.size) this.schedule(1000);
      } catch (e) {
        this.setStatus(e instanceof NetworkError ? 'offline' : 'error', e);
        this.schedule(e instanceof NetworkError ? 15000 : 30000);
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  async pushOne(path, p) {
    const message = commitMessage(path, p.messages);
    const doc = this.docs.get(path);
    const text = serialize(path, doc.data);
    try {
      const { sha } = await this.backend.putText(path, text, doc.sha, message);
      await this.cacheDoc(path, { data: doc.data, sha });
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      // Otro dispositivo escribió antes: partir del remoto y reaplicar nuestros cambios.
      const remote = await this.backend.getText(path);
      let data = remote ? JSON.parse(remote.text) : undefined;
      if (p.orphan || !p.mutators.length) data = mergeOrphan(path, data, doc.data);
      else for (const fn of p.mutators) data = fn(structuredClone(data)) ?? data;
      const { sha } = await this.backend.putText(path, serialize(path, data), remote?.sha ?? null, message);
      await this.cacheDoc(path, { data, sha });
      this.emit('change', { paths: [path] });
    }
  }

  // ---------- binarios (fotos) ----------

  /**
   * Guarda una foto. Sin conexión se queda en el móvil (se ve igual) y se sube sola al volver la red.
   * @returns {Promise<boolean>} true si ya está subida; false si quedó pendiente.
   */
  async putPhoto(path, bytes, message) {
    await idb.set(this.key('photo:', path), { bytes, sha: null });
    try {
      await this.uploadPhoto(path, bytes, message);
      return true;
    } catch (e) {
      if (!(e instanceof NetworkError)) throw e;
      this.photoQ.set(path, message);
      await idb.set(this.key(PHOTOQ, path), { message });
      this.setStatus('offline', e);
      this.schedule(15000);
      return false;
    }
  }

  async uploadPhoto(path, bytes, message) {
    try {
      const { sha } = await this.backend.putBinary(path, bytes, null, message);
      await idb.set(this.key('photo:', path), { bytes, sha });
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      const existing = await this.backend.getBinary(path);
      const { sha } = await this.backend.putBinary(path, bytes, existing?.sha, message);
      await idb.set(this.key('photo:', path), { bytes, sha });
    }
  }

  async getPhoto(path) {
    const cached = await idb.get(this.key('photo:', path));
    if (cached) return cached.bytes;
    const r = await this.backend.getBinary(path);
    if (!r) return null;
    await idb.set(this.key('photo:', path), r);
    return r.bytes;
  }

  async putText(path, text, message) {
    const cur = await this.backend.getText(path);
    if (cur?.text === text) return;
    await this.backend.putText(path, text, cur?.sha ?? null, message);
  }
}

// ---------- utilidades ----------

function serialize(path, data) {
  // días: una línea por día para que los diffs en GitHub sean legibles
  if (path.startsWith('days/')) {
    const entries = Object.entries(data || {}).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    return `{\n${entries.join(',\n')}\n}\n`;
  }
  return JSON.stringify(data, null, 2) + '\n';
}

function mergeOrphan(path, remote, local) {
  // Sin las funciones de cambio (la app se cerró): para meses se funde día a día (gana lo local);
  // para el resto gana lo local entero.
  if (path.startsWith('days/')) return sortKeys({ ...(remote || {}), ...(local || {}) });
  return local;
}

function commitMessage(path, messages) {
  const msgs = messages.filter(Boolean);
  if (!msgs.length) return `Actualiza ${path}`;
  if (msgs.length <= 3) return msgs.join(' · ');
  return `${msgs.slice(0, 2).join(' · ')} · y ${msgs.length - 2} cambios más`;
}

function prune(o) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v === undefined || v === null || v === '') delete o[k];
    else if (typeof v === 'object' && !Array.isArray(v)) {
      prune(v);
      if (!Object.keys(v).length) delete o[k];
    }
  }
}

function sortKeys(m) {
  return Object.fromEntries(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)));
}
