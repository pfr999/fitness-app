// Fotos: redimensiona en el móvil y re-codifica a JPEG. Re-codificar con canvas elimina los
// metadatos EXIF (incluida la ubicación GPS).

const MAX = 1600, QUALITY = 0.85;

/** @param {File} file  @returns {Promise<Uint8Array>} */
export async function processPhoto(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
  return new Uint8Array(await blob.arrayBuffer());
}

const urls = new Map();
/** URL de objeto para una foto del repo (con caché en memoria). */
export async function photoURL(store, path) {
  if (urls.has(path)) return urls.get(path);
  const bytes = await store.getPhoto(path);
  if (!bytes) return null;
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
  urls.set(path, url);
  return url;
}
export function forgetPhoto(path) {
  const u = urls.get(path);
  if (u) URL.revokeObjectURL(u);
  urls.delete(path);
}

/** Rellena <img data-photo="ruta"> de forma diferida. */
export function hydratePhotos(root, store) {
  root.querySelectorAll('img[data-photo]').forEach(async (img) => {
    const url = await photoURL(store, img.dataset.photo).catch(() => null);
    if (url) { img.src = url; img.hidden = false; }
  });
}
