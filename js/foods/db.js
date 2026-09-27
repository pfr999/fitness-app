// Base de alimentos: genéricos (CIQUAL) y productos (Open Food Facts) estáticos en foods/,
// más los alimentos propios del usuario (foods.json de su repo de datos). Consulta en línea
// a Open Food Facts solo cuando el usuario lo pide o al escanear un código que no está.

import { buildIndex, search } from './search.js';

let main = null; // {items, index, byId, byEan}
let loading = null;

/** Carga (una vez) la base estática. */
export function loadFoods() {
  if (main) return Promise.resolve(main);
  if (loading) return loading;
  loading = (async () => {
    const [g, p] = await Promise.all([
      fetch('foods/generic.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
      fetch('foods/products.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]);
    const items = [
      ...g.map(([id, name, aliases, kcal, pr, c, f]) => ({ id: `gen:${id}`, name, aliases: aliases ? aliases.split('|') : [], per100: { kcal, p: pr, c, f }, src: 'gen' })),
      ...p.map(([ean, name, brand, stores, qty, kcal, pr, c, f, scans]) => ({ id: `off:${ean}`, ean, name, brand, stores, qty, per100: { kcal, p: pr, c, f }, scans, src: 'off' })),
    ];
    main = { items, index: buildIndex(items), byId: new Map(items.map((x) => [x.id, x])), byEan: new Map(items.filter((x) => x.ean).map((x) => [x.ean, x])) };
    return main;
  })();
  return loading;
}

export const isLoaded = () => !!main;

/** Alimentos propios y recetas del usuario como items buscables. */
export function customItems(foodsDoc) {
  return (foodsDoc?.custom || []).map((x) => ({ ...x, src: 'mine' }));
}

/** Busca en propios + base estática. */
export function findFoods(q, foodsDoc, { limit = 30 } = {}) {
  const frequent = foodsDoc?.frequent || {};
  const own = search(buildIndex(customItems(foodsDoc)), q, { frequent, limit: 10 });
  const rest = main ? search(main.index, q, { frequent, limit }) : [];
  const seen = new Set(own.map((x) => x.id));
  return [...own, ...rest.filter((x) => !seen.has(x.id))].slice(0, limit);
}

/** Frecuentes para mostrar sin escribir nada. */
export function frequentFoods(foodsDoc, limit = 12) {
  const freq = Object.entries(foodsDoc?.frequent || {}).sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const own = new Map(customItems(foodsDoc).map((x) => [x.id, x]));
  return freq.map((id) => own.get(id) || main?.byId.get(id)).filter(Boolean).slice(0, limit);
}

export function byId(id, foodsDoc) {
  return customItems(foodsDoc).find((x) => x.id === id) || main?.byId.get(id) || null;
}

export function byEan(ean, foodsDoc) {
  return customItems(foodsDoc).find((x) => x.ean === ean) || main?.byEan.get(ean) || null;
}

// ---------------------------------------------------------------- en línea (Open Food Facts)
const OFF = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_es,brands,stores,quantity,nutriments';

function fromOff(p) {
  const n = p.nutriments || {};
  const kcal = n['energy-kcal_100g'] ?? (n['energy_100g'] != null ? n['energy_100g'] / 4.184 : null);
  const per100 = { kcal, p: n.proteins_100g, c: n.carbohydrates_100g, f: n.fat_100g };
  if (Object.values(per100).some((v) => v == null || Number.isNaN(+v))) return null;
  for (const k of Object.keys(per100)) per100[k] = Math.round(+per100[k] * 10) / 10;
  return {
    id: `off:${p.code}`, ean: p.code, name: (p.product_name_es || p.product_name || '').trim() || `Producto ${p.code}`,
    brand: (p.brands || '').split(',')[0].trim(), stores: (p.stores || '').split(',').slice(0, 3).join(', '), qty: p.quantity || '',
    per100, src: 'off', online: true,
  };
}

/** Producto por código de barras en Open Food Facts. null si no existe o no tiene tabla nutricional. */
export async function lookupBarcodeOnline(ean) {
  const r = await fetch(`${OFF}/api/v2/product/${encodeURIComponent(ean)}.json?fields=${FIELDS}`);
  if (!r.ok) return null;
  const j = await r.json();
  return j.status === 1 && j.product ? fromOff({ ...j.product, code: j.product.code || ean }) : null;
}

/** Búsqueda en línea (limitada por Open Food Facts a unas pocas por minuto). */
export async function searchOnline(q) {
  const url = `${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=${FIELDS}&tagtype_0=countries&tag_contains_0=contains&tag_0=spain`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Open Food Facts ${r.status}`);
  const j = await r.json();
  return (j.products || []).map(fromOff).filter(Boolean);
}

/** Macros de una cantidad. */
export function macrosFor(per100, g) {
  const k = (g || 0) / 100;
  return { kcal: per100.kcal * k, p: per100.p * k, c: per100.c * k, f: per100.f * k };
}

/** Gramos de "1 envase" a partir de la cantidad del producto ("400 g", "660 g (400 g escurrido)"). */
export function packageGrams(qty) {
  const m = String(qty || '').replace(',', '.').match(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l|cl)\b/i);
  if (!m) return null;
  const v = parseFloat(m[1]), u = m[2].toLowerCase();
  const g = u === 'kg' || u === 'l' ? v * 1000 : u === 'cl' ? v * 10 : v;
  return g > 0 && g <= 5000 ? Math.round(g) : null;
}
