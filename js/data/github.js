// Backend: API de contenidos de GitHub. Cada escritura crea un commit en el repo de datos.
// Mismo interfaz que LocalBackend (demo): getText, putText, getBinary, putBinary, list, check.

const API = 'https://api.github.com';

export class ConflictError extends Error {}
export class AuthError extends Error {}
export class NetworkError extends Error {}

// ---------- base64 UTF-8 ----------
export function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  return bytesToB64(bytes);
}
export function b64ToUtf8(b64) {
  return new TextDecoder().decode(b64ToBytes(b64));
}
export function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64ToBytes(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class GitHubBackend {
  constructor({ owner, repo, token }) {
    Object.assign(this, { owner, repo, token });
    this.kind = 'github';
  }

  async req(method, path, body) {
    let res;
    try {
      res = await fetch(`${API}/repos/${this.owner}/${this.repo}${path}`, {
        method,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'X-GitHub-Api-Version': '2022-11-28',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new NetworkError(e.message);
    }
    if (res.status === 401) throw new AuthError('Token no válido o caducado');
    if (res.status === 403) throw new AuthError(method === 'GET' ? 'Sin acceso al repo (o límite de peticiones)' : 'El token no tiene permiso de escritura (Contents: Read and write)');
    if (res.status === 404) return null;
    if (res.status === 409 || res.status === 422) throw new ConflictError(`GitHub ${res.status}`);
    if (!res.ok) throw new NetworkError(`GitHub ${res.status}`);
    return res.status === 204 ? {} : res.json();
  }

  contentsPath(path) {
    return `/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  /** Comprueba el token y el repo. */
  async check() {
    const r = await this.req('GET', '');
    if (!r) throw new AuthError('Repo no encontrado o sin acceso');
    if (!r.permissions?.push) throw new AuthError('El token no tiene permiso de escritura');
    return { private: r.private, empty: r.size === 0, defaultBranch: r.default_branch };
  }

  /** @returns {{text:string, sha:string}|null} */
  async getText(path) {
    const r = await this.req('GET', this.contentsPath(path));
    if (!r) return null;
    if (r.content === '' && r.size > 0) {
      // > 1 MB: pedir el blob por sha
      const blob = await this.req('GET', `/git/blobs/${r.sha}`);
      return { text: b64ToUtf8(blob.content), sha: r.sha };
    }
    return { text: b64ToUtf8(r.content || ''), sha: r.sha };
  }

  async putText(path, text, sha, message) {
    return this.put(path, utf8ToB64(text), sha, message);
  }

  /** @returns {{bytes:Uint8Array, sha:string}|null} */
  async getBinary(path) {
    const r = await this.req('GET', this.contentsPath(path));
    if (!r) return null;
    const content = r.content || (await this.req('GET', `/git/blobs/${r.sha}`)).content;
    return { bytes: b64ToBytes(content), sha: r.sha };
  }

  async putBinary(path, bytes, sha, message) {
    return this.put(path, bytesToB64(bytes), sha, message);
  }

  async put(path, b64, sha, message) {
    const body = { message, content: b64, ...(sha ? { sha } : {}) };
    const r = await this.req('PUT', this.contentsPath(path), body);
    return { sha: r.content.sha };
  }

  /** Lista un directorio: [{name, path, sha}] */
  async list(dir) {
    const r = await this.req('GET', this.contentsPath(dir));
    if (!r || !Array.isArray(r)) return [];
    return r.map(({ name, path, sha, type }) => ({ name, path, sha, type }));
  }
}
