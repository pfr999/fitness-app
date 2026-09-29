// Recetas: ingredientes en crudo + peso final cocinado. Cuando cocinas para varios días, pesas lo que
// sale de la olla una vez y luego apuntas cada ración pesando solo lo que te sirves. Puro.

const sum = (items) => (items || []).reduce((a, it) => {
  const k = (it.g || 0) / 100;
  a.kcal += it.per100.kcal * k; a.p += it.per100.p * k; a.c += it.per100.c * k; a.f += it.per100.f * k; a.g += it.g || 0;
  return a;
}, { kcal: 0, p: 0, c: 0, f: 0, g: 0 });

/** Totales de la receta (kcal, macros y gramos en crudo). */
export const recipeTotals = (r) => sum(r?.items);

/** Peso de referencia: el cocinado si se pesó; si no, la suma en crudo. */
export const recipeWeight = (r) => (r?.cooked_g > 0 ? r.cooked_g : recipeTotals(r).g);

/** La receta como un alimento más (valores por 100 g de lo cocinado y, si hay raciones, la unidad «ración»). */
export function recipeFood(r) {
  const t = recipeTotals(r), w = recipeWeight(r);
  const k = w ? 100 / w : 0;
  const round = (x) => Math.round(x * k * 10) / 10;
  return {
    id: r.id, name: r.name, brand: 'Receta', src: 'rec',
    per100: { kcal: round(t.kcal), p: round(t.p), c: round(t.c), f: round(t.f) },
    stores: `${Math.round(w)} g ${r.cooked_g > 0 ? 'cocinado' : 'en crudo'}`, // texto informativo (no es un envase)
    ...(r.servings > 0 && w ? { units: [{ name: 'ración', g: Math.round((w / r.servings) * 10) / 10 }] } : {}),
  };
}

/**
 * Ingredientes que corresponden a `grams` de la receta (cocinada), para apuntarla «por ingredientes»
 * y poder ajustar cada uno ese día.
 */
export function recipeItemsFor(r, grams) {
  const w = recipeWeight(r);
  const k = w ? grams / w : 0;
  return (r.items || []).map((it) => ({ ...structuredClone(it), g: Math.round(it.g * k * 10) / 10 })).filter((it) => it.g > 0);
}

/** Qué alimentos aportan más de `key` (p, kcal, c, f) en una lista de registros. [{name, value, share}] */
export function topContributors(items, key = 'p', n = 5) {
  const by = new Map();
  let total = 0;
  for (const it of items || []) {
    const v = (it.per100?.[key] || 0) * (it.g || 0) / 100;
    if (!v) continue;
    total += v;
    const k = it.food || it.name;
    const cur = by.get(k) || { name: it.name, value: 0 };
    cur.value += v;
    by.set(k, cur);
  }
  return [...by.values()].sort((a, b) => b.value - a.value).slice(0, n).map((x) => ({ ...x, share: total ? x.value / total : 0 }));
}
