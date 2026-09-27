// Buscador de alimentos: texto libre, sin acentos, palabras en cualquier orden, por prefijo,
// con sinónimos (tienda ↔ marca blanca, formato, preparación). Puro: sin red ni DOM.

export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ%.,]+/g, ' ').trim();
const words = (s) => norm(s).split(/[\s,.]+/).filter(Boolean);

// Grupos de términos equivalentes. Escribir cualquiera encuentra los demás.
const GROUPS = [
  ['mercadona', 'hacendado', 'deliplus', 'bosque verde', 'compy'],
  ['lidl', 'milbona', 'crownfield', 'freeway', 'pikok', 'solevita', 'chef select', 'deluxe', 'sondey', 'alesto', 'vitasia'],
  ['carrefour', 'carrefour bio', 'carrefour classic'],
  ['aldi', 'milsani', 'golden bridge', 'cucina nobile', 'gourmet finest'],
  ['dia', 'dia%', 'bonte'],
  ['eroski', 'eroski basic', 'seleqtia'],
  ['alcampo', 'auchan'],
  ['consum'],
  ['lupa'],
  ['bote', 'frasco', 'conserva', 'lata', 'tarro'],
  ['cocida', 'cocido', 'cocidas', 'cocidos', 'hervida', 'hervido', 'hervidas', 'hervidos'],
  ['plancha', 'a la plancha', 'asado', 'asada', 'grill'],
  ['patata', 'patatas', 'papa', 'papas'],
  ['yogur', 'yogurt', 'yoghourt'],
  ['desnatado', 'desnatada', '0%', 'light', 'sin grasa'],
  ['atun', 'bonito'],
  ['judias verdes', 'vainas', 'judia verde'],
  ['garbanzo', 'garbanzos'],
  ['lenteja', 'lentejas'],
  ['arroz', 'arroces'],
  ['huevo', 'huevos'],
  ['proteina', 'whey', 'protein'],
];
const SYN = new Map();
for (const g of GROUPS) for (const t of g) SYN.set(norm(t), g.map(norm));
const STORE_TERMS = new Set(GROUPS.slice(0, 9).flat().map(norm));
// Palabras que ayudan a ordenar pero no son obligatorias: tiendas y formatos de envase
// (el producto puede no decir «bote» aunque lo sea).
const FORMAT_TERMS = new Set(['bote', 'frasco', 'lata', 'tarro', 'paquete', 'envase', 'bolsa', 'brick', 'conserva'].map(norm));
const isOptional = (t) => STORE_TERMS.has(t) || FORMAT_TERMS.has(t);

/** Alternativas de un término de búsqueda (él mismo + sinónimos). */
function alts(t) {
  return SYN.get(t) || [t];
}

/**
 * Prepara un índice.
 * items: [{id, name, brand?, stores?, aliases?, scans?, src:'gen'|'off'|'mine'|'rec'}]
 */
export function buildIndex(items) {
  return items.map((it) => {
    const text = [it.name, it.brand, it.stores, ...(it.aliases || []), it.qty].filter(Boolean).join(' ');
    const ws = words(text);
    return { it, ws, joined: ' ' + ws.join(' ') + ' ', brandWs: words(`${it.brand || ''} ${it.stores || ''}`) };
  });
}

function matchTerm(entry, alternatives) {
  for (const a of alternatives) {
    if (a.includes(' ')) { if (entry.joined.includes(' ' + a)) return true; continue; }
    for (const w of entry.ws) if (w.startsWith(a)) return true;
  }
  return false;
}

/**
 * Busca. Todas las palabras de la consulta deben aparecer (por prefijo o sinónimo).
 * @param {object[]} index      de buildIndex
 * @param {string} q
 * @param {{frequent?:Object<string,number>, limit?:number}} opts  frequent: id → usos
 */
export function search(index, q, { frequent = {}, limit = 30 } = {}) {
  const toks = words(q);
  if (!toks.length) return [];
  const required = toks.filter((t) => !isOptional(t));
  const optional = toks.filter(isOptional);
  const out = [];
  for (const e of index) {
    let score = 0, ok = true;
    for (const t of required) {
      const lit = e.ws.some((w) => w.startsWith(t));
      if (!lit && !matchTerm(e, alts(t))) { ok = false; break; }
      score += lit ? 12 : 4; // lo escrito tal cual pesa más que un sinónimo
      if (e.ws[0] && e.ws[0].startsWith(t)) score += 4; // coincide con la primera palabra del nombre
    }
    if (!ok) continue;
    let optHits = 0;
    for (const t of optional) {
      const a = alts(t);
      if (!matchTerm(e, a)) continue;
      optHits++;
      score += STORE_TERMS.has(t) ? 30 : 6;
    }
    // si solo se escribieron tiendas/formatos (p. ej. «hacendado»), exigir al menos uno
    if (!required.length && !optHits) continue;
    const it = e.it;
    score += Math.min(100, (frequent[it.id] || 0) * 20);
    if (it.src === 'mine' || it.src === 'rec') score += 25;
    if (it.src === 'gen') score += optional.some((t) => STORE_TERMS.has(t)) ? -40 : 6;
    score += Math.log10(1 + (it.scans || 0)) * 4;
    score -= e.ws.length * 0.3; // nombres cortos antes
    out.push({ it, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map((x) => x.it);
}

/** Palabras de la consulta, para resaltar en los resultados. */
export function highlightTerms(q) {
  return words(q).flatMap(alts);
}

export { words };
