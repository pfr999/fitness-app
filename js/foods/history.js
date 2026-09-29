// Lo que sale de tu historial de comidas (sin guardar nada aparte): última cantidad de cada alimento,
// cantidades habituales, lo que sueles poner en cada comida y lo reciente. Puro: sin red ni DOM.

import { addDays } from '../dates.js';

const qtyKey = (it) => (it.unit ? `u|${it.unit.name}|${it.unit.g}|${it.unit.n}` : `g|${Math.round(it.g)}`);
const fromKey = (k) => {
  const [t, a, b, c] = k.split('|');
  return t === 'u' ? { g: +b * +c, unit: { name: a, g: +b, n: +c } } : { g: +a, unit: null };
};

/**
 * @param {Object<string,object>} days  mapa fecha → día
 * @param {string} until                 último día que cuenta (incluido)
 */
export function foodHistory(days, until, { span = 60 } = {}) {
  const from = addDays(until, -span);
  const dates = Object.keys(days).filter((d) => d >= from && d <= until).sort();
  const last = new Map(), qty = new Map(), bySlot = new Map();
  dates.forEach((d, i) => {
    const w = 1 + i / Math.max(1, dates.length); // lo reciente pesa algo más
    for (const m of days[d]?.meals || []) {
      for (const it of m.items || []) {
        if (!it.food || it.quick) continue;
        last.set(it.food, { item: it, date: d });
        const q = qty.get(it.food) || new Map();
        q.set(qtyKey(it), (q.get(qtyKey(it)) || 0) + 1);
        qty.set(it.food, q);
        const s = bySlot.get(m.slot) || new Map();
        s.set(it.food, (s.get(it.food) || 0) + w);
        bySlot.set(m.slot, s);
      }
    }
  });
  return {
    /** Último registro de ese alimento (con su cantidad y unidad) o null. */
    last: (id) => last.get(id)?.item || null,
    /** Cantidades más usadas: [{g, unit}] de más a menos frecuente. */
    habitual: (id, n = 3) => [...(qty.get(id) || new Map())].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => fromKey(k)),
    /** Lo que sueles poner en esa comida (último registro de cada alimento). */
    forSlot: (slot, n = 6) => [...(bySlot.get(slot) || new Map())].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => last.get(id).item),
    /** Alimentos usados más recientemente. */
    recent: (n = 8) => [...last.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, n).map((x) => x.item),
  };
}

/** Firma de una comida: qué alimentos lleva (sin cantidades ni orden). */
export const mealSignature = (items) => [...new Set((items || []).filter((i) => i.food && !i.quick).map((i) => i.food))].sort().join(',');

/** Cuántos de los `span` días anteriores tuvo esa comida exactamente los mismos alimentos. */
export function timesRepeated(days, date, slot, items, { span = 14 } = {}) {
  const sig = mealSignature(items);
  if (!sig || !sig.includes(',')) return 0; // un solo alimento no es «una comida»
  let n = 0;
  for (let i = 1; i <= span; i++) {
    const m = (days[addDays(date, -i)]?.meals || []).find((x) => x.slot === slot);
    if (m && mealSignature(m.items) === sig) n++;
  }
  return n;
}
