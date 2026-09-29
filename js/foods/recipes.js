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
