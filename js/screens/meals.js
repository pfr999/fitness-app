// Hoy → Comidas: registro de alimentos por gramos, totales por comida y día frente al objetivo,
// alimentos propios, escáner de código de barras y botón «Día completo».

import { $, $$, esc, fmt, fmtK, num, int, toast, openSheet, closeSheet, icon, bindSeg, segValue, ask, askText } from '../ui/ui.js';
import { donut } from '../ui/charts.js';
import { addDays, fmtShort } from '../dates.js';
import { FILES, planFor, kcalTarget, sumItems } from '../model.js';
import { loadFoods, isLoaded, findFoods, frequentFoods, byEan, byId, lookupBarcodeOnline, searchOnline, macrosFor, packageGrams } from '../foods/db.js';
import { highlightTerms, norm } from '../foods/search.js';
import { scannerSupported, startScanner } from '../foods/scanner.js';
import { foodHistory, mealSignature, timesRepeated } from '../foods/history.js';

// ---------------------------------------------------------------- comidas del plan
/**
 * Comidas del plan. Modo «fixed»: lista fija (por defecto Comida 1–3), cada una con objetivo opcional
 * (gramos de macros o porciones). Modo «free»: no hay lista; cada día se añaden las que se hagan.
 * Nunca se reparte el objetivo del día entre comidas: lo que cuenta es el total del día.
 */
export function mealPlan(v) {
  const d = v?.diet || {};
  const mode = d.meals_mode === 'free' ? 'free' : 'fixed';
  const list = (d.meals || []).filter((m) => m.slot);
  return { mode, list: mode === 'fixed' && !list.length ? ['Comida 1', 'Comida 2', 'Comida 3'].map((slot) => ({ slot })) : list };
}

/** Comidas que se muestran un día: las fijas del plan + las que tengan algo apuntado + las añadidas hoy. */
export function slotsFor(ctx, v, date) {
  const { mode, list } = mealPlan(v);
  const day = ctx.store.day(date);
  const hidden = new Set(day.hidden_meals || []);
  // las comidas fijas vacías solo se muestran hoy (y en adelante); en días pasados, solo lo apuntado
  const planned = mode === 'fixed' && date >= ctx.today() ? list.map((m) => m.slot).filter((sl) => !hidden.has(sl)) : [];
  const logged = (day.meals || []).filter((m) => m.items?.length).map((m) => m.slot);
  const all = [...new Set([...planned, ...logged, ...(ctx.state.extraMeals?.[date] || [])])];
  // orden propio del día (se guarda al renombrar) para que una comida no salte de sitio
  const order = day.meal_order || [];
  const pos = (x) => { const i = order.indexOf(x); return i < 0 ? order.length + all.indexOf(x) : i; };
  return order.length ? all.sort((a, b) => pos(a) - pos(b)) : all;
}

/** Objetivo propio de una comida (si el plan se lo pone). */
function mealTarget(v, slot) {
  const m = (v?.diet?.meals || []).find((x) => x.slot === slot);
  if (m?.target && ['p', 'c', 'f'].some((k) => m.target[k] != null)) {
    const t = { p: +m.target.p || 0, c: +m.target.c || 0, f: +m.target.f || 0 };
    return { ...t, kcal: 4 * t.p + 4 * t.c + 9 * t.f };
  }
  return null;
}
const mealPortions = (v, slot) => (v?.diet?.meals || []).find((x) => x.slot === slot)?.portions || null;

export function dayTargets(v, trained) {
  const kcal = kcalTarget(v, trained);
  const d = v.diet;
  // los macros del plan son los del día de entreno: se escalan en días de descanso
  const scale = d.kcal.train ? kcal / d.kcal.train : 1;
  return { kcal, p: d.protein_g * (trained === false ? 1 : scale), c: d.carbs_g * scale, f: d.fat_g * scale };
}

const mealOf = (day, slot) => (day.meals || []).find((m) => m.slot === slot) || { slot, items: [] };

// ---------------------------------------------------------------- render
export function render(ctx) {
  const date = ctx.state.date;
  const v = planFor(ctx.store.get(FILES.plan), date);
  if (!v) return '';
  const day = ctx.store.day(date);
  const t = dayTargets(v, day.trained);
  const slots = slotsFor(ctx, v, date);
  const { mode } = mealPlan(v);
  const all = sumItems((day.meals || []).flatMap((m) => m.items));
  const complete = day.meals_complete === true;
  const label = day.trained === true ? 'Día de entreno' : day.trained === false ? 'Día de descanso' : 'Entreno sin marcar';
  const bar = (l, val, tgt, col) => `<div class="mac"><div class="row"><b>${l}</b><span class="num"><b style="color:var(--ink)">${fmtK(val)}</b> / ${fmtK(tgt)} g${tgt - val > 0 ? ` · quedan ${fmtK(tgt - val)}` : ''}</span></div><div class="bar"><i style="width:${Math.min(100, (val / (tgt || 1)) * 100)}%;background:${col}"></i></div></div>`;

  const allDays = ctx.store.allDays();
  const saved = savedMealsOf(ctx);
  const savedSigs = new Set(saved.map((x) => mealSignature(x.items)));
  const yday = ctx.store.day(addDays(date, -1));
  const canCopyDay = !all.kcal && (yday.meals || []).some((x) => x.items?.length);
  const cards = slots.map((slot) => {
    const m = mealOf(day, slot);
    const s = sumItems(m.items);
    const tg = mealTarget(v, slot);
    const por = mealPortions(v, slot);
    const y = mealOf(ctx.store.day(addDays(date, -1)), slot);
    const porChips = por && Object.keys(por).length ? `<div class="por" style="justify-content:flex-start;margin-bottom:6px">${Object.entries(por).filter(([, n]) => n).map(([k2, n]) => `<span class="${esc(k2)}">${esc(n)}${esc(k2)}</span>`).join('')}</div>` : '';
    return `<div class="card mc">
      <div class="ch"><h2 style="display:flex;align-items:center;gap:6px">${esc(slot)}<button class="mini" data-rename="${esc(slot)}" aria-label="Cambiar nombre de ${esc(slot)}" style="width:30px;height:30px">${icon.edit}</button></h2>
        <span style="display:flex;align-items:center;gap:8px"><span class="aux num">${fmtK(s.kcal)}${tg ? ` / ${fmtK(tg.kcal)}` : ''} kcal</span><button class="mini danger" data-rmmeal="${esc(slot)}" aria-label="Quitar ${esc(slot)} de este día" style="width:30px;height:30px">${icon.trash}</button></span></div>
      ${tg ? `<div class="mc-sub"><span>P <b>${fmtK(s.p)}</b>/${fmtK(tg.p)}</span><span>C <b>${fmtK(s.c)}</b>/${fmtK(tg.c)}</span><span>G <b>${fmtK(s.f)}</b>/${fmtK(tg.f)} g</span></div>`
        : m.items.length ? `<div class="mc-sub"><span style="color:var(--blue)">P <b style="color:var(--blue)">${fmtK(s.p)}</b></span><span>C <b>${fmtK(s.c)}</b></span><span>G <b>${fmtK(s.f)}</b> g</span></div>` : ''}
      ${porChips}
      ${m.items.map((it, i) => { const x = macrosFor(it.per100, it.g); const q = it.quick ? 'añadido rápido' : it.unit ? `${fmt(it.unit.n, it.unit.n % 1 ? 1 : 0)} ${esc(unitLabel(it.unit.name, it.unit.n))} · ${fmtK(it.g)} g` : `${fmtK(it.g)} g`; return `<button class="fi" data-item="${esc(slot)}|${i}" style="width:100%;border-left:0;border-right:0;border-bottom:0;background:none;text-align:left"><div class="ft"><b>${esc(it.name)}${it.brand ? ` · ${esc(it.brand)}` : ''}</b><span>${q} · P ${fmtK(x.p)} · C ${fmtK(x.c)} · G ${fmtK(x.f)}</span></div><div class="fk num">${fmtK(x.kcal)}<small>kcal</small></div></button>`; }).join('')}
      ${m.items.length && !savedSigs.has(mealSignature(m.items)) && timesRepeated(allDays, date, slot, m.items) >= 2 ? `<button class="savesug" data-savesug="${esc(slot)}">${icon.list}<span>Repites esta comida. <b>Guárdala</b> para añadirla de un toque.</span></button>` : ''}
      <div class="mc-actions"><button class="btn primary sm" data-add="${esc(slot)}">${icon.plus} Añadir</button>${!m.items.length && y.items.length ? `<button class="btn secondary sm" data-copy="${esc(slot)}">Copiar de ayer</button>` : ''}${!m.items.length && saved.length ? `<button class="btn secondary sm" data-savedpick="${esc(slot)}">Comida guardada</button>` : ''}<button class="mini" data-mmenu="${esc(slot)}" aria-label="Más opciones de ${esc(slot)}" style="width:40px;height:40px;flex:none">⋯</button></div>
    </div>`;
  }).join('');

  return `<div class="card">
      <div class="ch"><h2>Hoy llevas</h2><span class="badge ${day.trained === true ? 'g' : 'n'}">${label}</span></div>
      <div class="ring-wrap">
        ${donut({ pct: t.kcal ? all.kcal / t.kcal : 0, size: 104, stroke: 10, color: all.kcal > t.kcal * 1.1 ? 'var(--amber)' : 'var(--accent)', big: fmtK(all.kcal), sm: `de ${fmtK(t.kcal)}`, sm2: 'kcal' })}
        <div class="macros">${bar('Proteína', all.p, t.p, 'var(--blue)')}${bar('Carbos', all.c, t.c, 'var(--slate)')}${bar('Grasas', all.f, t.f, 'var(--slate)')}</div>
      </div>
      ${canCopyDay ? `<button class="btn secondary sm" id="copyDay" style="width:100%;margin-top:12px">${icon.copy} Copiar todo lo de ayer</button>` : ''}
      ${day.trained == null ? `<div class="hint">Marca en «Día» si entrenas hoy: cambia el objetivo (entreno ${fmtK(v.diet.kcal.train)} · descanso ${fmtK(v.diet.kcal.rest)}).</div>` : ''}
    </div>
    ${cards}
    ${!slots.length ? `<div class="card empty"><b>Sin comidas todavía</b>Añade la primera del día.</div>` : ''}
    <button class="btn secondary" id="addMeal" style="margin-bottom:12px">${icon.plus} ${mode === 'free' || !slots.length ? 'Añadir comida' : 'Otra comida'}</button>
    <button class="btn ${complete ? 'secondary' : 'primary'}" id="dayComplete" style="margin-bottom:6px">${complete ? `${icon.check} Día completo · toca para desmarcar` : 'Marcar día completo ✓'}</button>
    <div class="hint" style="text-align:center;margin-bottom:12px">${complete ? 'Lo apuntado cuenta como todo lo que comiste hoy.' : 'Cuando hayas apuntado todo lo de hoy.'}</div>
    <div class="attr" style="text-align:center">Datos: CIQUAL (ANSES) · Open Food Facts (ODbL)</div>`;
}

export function bind(root, ctx) {
  const date = ctx.state.date;
  if (!isLoaded()) loadFoods().catch(() => {});
  $$('[data-add]', root).forEach((b) => b.addEventListener('click', () => addSheet(ctx, date, b.dataset.add)));
  $('#addMeal', root)?.addEventListener('click', () => newMealSheet(ctx, date));
  $$('[data-rmmeal]', root).forEach((b) => b.addEventListener('click', () => removeMeal(ctx, date, b.dataset.rmmeal)));
  $$('[data-rename]', root).forEach((b) => b.addEventListener('click', () => renameMealSheet(ctx, date, b.dataset.rename)));
  $$('[data-copy]', root).forEach((b) => b.addEventListener('click', () => {
    const slot = b.dataset.copy;
    const y = mealOf(ctx.store.day(addDays(date, -1)), slot);
    ctx.store.updateDay(date, (d) => { setMeal(d, slot, structuredClone(y.items)); }, `${slot} ${fmtShort(date)}: copiada de ayer`);
    toast(`${slot} copiada de ayer`);
    ctx.render();
  }));
  $$('[data-mmenu]', root).forEach((b) => b.addEventListener('click', () => mealMenuSheet(ctx, date, b.dataset.mmenu)));
  $$('[data-savedpick]', root).forEach((b) => b.addEventListener('click', () => savedPickSheet(ctx, date, b.dataset.savedpick)));
  $$('[data-savesug]', root).forEach((b) => b.addEventListener('click', () => saveMealAs(ctx, mealOf(ctx.store.day(date), b.dataset.savesug).items, b.dataset.savesug)));
  $('#copyDay', root)?.addEventListener('click', () => {
    const y = ctx.store.day(addDays(date, -1));
    const before = structuredClone(ctx.store.day(date).meals || null);
    ctx.store.updateDay(date, (d) => { for (const m of y.meals || []) if (m.items?.length) { const cur = mealOf(d, m.slot); setMeal(d, m.slot, [...cur.items, ...structuredClone(m.items)]); } }, `${fmtShort(date)}: copia el día de ayer`);
    ctx.render();
    toast('Día de ayer copiado', { action: { label: 'Deshacer', fn: () => { ctx.store.updateDay(date, (d) => { if (before) d.meals = before; else delete d.meals; }, `${fmtShort(date)}: deshace copia del día`); ctx.render(); } } });
  });
  $$('[data-item]', root).forEach((b) => b.addEventListener('click', () => {
    const [slot, i] = b.dataset.item.split('|');
    itemSheet(ctx, date, slot, +i);
  }));
  $('#dayComplete', root)?.addEventListener('click', () => {
    const cur = ctx.store.day(date).meals_complete === true;
    ctx.store.updateDay(date, (d) => {
      if (cur) { delete d.meals_complete; if (d.diet?.status === 'logged') delete d.diet; }
      else { d.meals_complete = true; d.diet = { status: 'logged' }; }
    }, `Comidas ${fmtShort(date)}: ${cur ? 'día abierto' : 'día completo'}`);
    toast(cur ? 'Día desmarcado' : 'Día completo ✓');
    ctx.render();
  });
}

function setMeal(d, slot, items) {
  d.meals ||= [];
  const m = d.meals.find((x) => x.slot === slot);
  if (m) m.items = items; else d.meals.push({ slot, items });
  d.meals = d.meals.filter((x) => x.items.length);
  if (!d.meals.length) delete d.meals;
}

function addItem(ctx, date, slot, food, g, unit = null) {
  const item = { food: food.id, name: food.name, ...(food.brand ? { brand: food.brand } : {}), g, ...(unit ? { unit } : {}), per100: { ...food.per100 } };
  const q = unit ? `${fmt(unit.n, unit.n % 1 ? 1 : 0)} ${unitLabel(unit.name, unit.n)}` : `${fmtK(g)} g`;
  ctx.store.updateDay(date, (d) => { const m = mealOf(d, slot); setMeal(d, slot, [...m.items, item]); }, `${slot} ${fmtShort(date)}: +${food.name} ${q}`);
  ctx.store.update(FILES.foods, (doc) => {
    doc = doc && typeof doc === 'object' ? doc : {};
    doc.custom ||= []; doc.recipes ||= []; doc.frequent ||= {};
    doc.frequent[food.id] = (doc.frequent[food.id] || 0) + 1;
    // un producto encontrado en línea pasa a ser propio: la próxima vez sale sin conexión
    if (food.online && !doc.custom.some((x) => x.id === food.id)) {
      const { online, ...keep } = food;
      doc.custom.push({ ...keep, source: 'off' });
    }
    return doc;
  }, 'Alimentos frecuentes');
}

/** «pastilla» → «pastillas» para n ≠ 1 (plural simple en español). */
export function unitLabel(name, n) {
  if (n === 1 || !name) return name || '';
  // «rebanada de pan» → «rebanadas de pan»: se pluraliza la primera palabra
  const sp = name.indexOf(' ');
  if (sp > 0) return unitLabel(name.slice(0, sp), n) + name.slice(sp);
  if (/(s|x)$/i.test(name)) return name;                       // «cápsulas» ya en plural
  if (/[aeiouáéíóú]$/i.test(name)) return `${name}s`;           // pastilla → pastillas
  if (/ón$/i.test(name)) return name.replace(/ón$/i, 'ones');   // ración → raciones
  if (/z$/i.test(name)) return name.replace(/z$/i, 'ces');      // nuez → nueces
  if (/[lrndjy]$/i.test(name)) return `${name}es`;              // pan → panes
  return `${name}s`;                                            // scoop → scoops
}

/** Unidades con las que se puede medir un alimento: las suyas (pastilla, ración…) y el envase. */
function unitsOf(food) {
  const out = [...(food.units || [])].filter((u) => u.name && u.g > 0);
  const pkg = packageGrams(food.qty);
  if (pkg && !out.some((u) => u.g === pkg)) out.push({ name: 'envase', g: pkg });
  return out;
}

// ---------------------------------------------------------------- quitar / renombrar una comida del día
const isPlanned = (ctx, date, slot) => mealPlan(planFor(ctx.store.get(FILES.plan), date)).list.some((m) => m.slot === slot);
const dropExtra = (ctx, date, slot) => { const l = ctx.state.extraMeals?.[date]; if (l) ctx.state.extraMeals[date] = l.filter((x) => x !== slot); };

async function removeMeal(ctx, date, slot) {
  const day = ctx.store.day(date);
  const m = mealOf(day, slot);
  const what = m.items.length ? ` y ${m.items.length === 1 ? 'su alimento' : `sus ${m.items.length} alimentos`}` : '';
  if (!(await ask({ title: `¿Borrar «${slot}»?`, text: `Se quita de este día${what}. Podrás deshacerlo justo después.`, ok: 'Borrar', danger: true }))) return;
  const before = { meals: structuredClone(day.meals || null), hidden: structuredClone(day.hidden_meals || null), order: structuredClone(day.meal_order || null) };
  const planned = isPlanned(ctx, date, slot);
  if (m.items.length || planned) {
    ctx.store.updateDay(date, (d) => {
      setMeal(d, slot, []);
      if (planned) d.hidden_meals = [...new Set([...(d.hidden_meals || []), slot])]; // la del plan: oculta solo este día
    }, `${fmtShort(date)}: quita ${slot}`);
  }
  dropExtra(ctx, date, slot);
  ctx.render();
  toast(`«${slot}» borrada`, { action: { label: 'Deshacer', fn: () => {
    ctx.store.updateDay(date, (d) => {
      if (before.meals) d.meals = before.meals; else delete d.meals;
      if (before.hidden) d.hidden_meals = before.hidden; else delete d.hidden_meals;
      if (before.order) d.meal_order = before.order; else delete d.meal_order;
    }, `${fmtShort(date)}: recupera ${slot}`);
    if (!m.items.length && !planned) ((ctx.state.extraMeals ||= {})[date] ||= []).push(slot);
    toast(`«${slot}» recuperada`);
    ctx.render();
  } } });
}

function renameMealSheet(ctx, date, slot) {
  openSheet(`<h3>Cambiar nombre</h3><div class="muted">Solo para este día. Los alimentos de «${esc(slot)}» pasan a la nueva.</div>
    <div class="field" style="margin-top:12px"><label for="rnName">Nombre</label><input class="inp" id="rnName" value="${esc(slot)}" autofocus></div>
    <div class="chipset" id="rnSug" style="margin-top:10px">${['Comida 1', 'Comida 2', 'Comida 3', 'Comida 4', 'Pre-entreno', 'Intra-entreno', 'Post-entreno', 'Snack'].filter((x) => x !== slot).map((x) => `<button type="button" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <div class="sheet-actions"><button class="btn primary" id="rnSave" style="margin-top:12px">Guardar</button></div>`, {
    bind: (sh) => {
      $$('#rnSug button', sh).forEach((b) => b.addEventListener('click', () => { $('#rnName', sh).value = b.dataset.v; }));
      $('#rnName', sh).addEventListener('focus', (e) => e.target.select());
      $('#rnSave', sh).addEventListener('click', () => {
        const to = $('#rnName', sh).value.trim();
        if (!to) return toast('Pon un nombre');
        if (to === slot) return closeSheet();
        const planned = isPlanned(ctx, date, slot);
        const order = [...new Set(slotsFor(ctx, planFor(ctx.store.get(FILES.plan), date), date).map((x) => (x === slot ? to : x)))];
        ctx.store.updateDay(date, (d) => {
          d.meal_order = order;
          const from = mealOf(d, slot), dest = mealOf(d, to);
          setMeal(d, to, [...dest.items, ...from.items]); // si ya existe una con ese nombre, se juntan
          setMeal(d, slot, []);
          if (planned) d.hidden_meals = [...new Set([...(d.hidden_meals || []), slot])];
          if (d.hidden_meals) { d.hidden_meals = d.hidden_meals.filter((x) => x !== to); if (!d.hidden_meals.length) delete d.hidden_meals; }
        }, `${fmtShort(date)}: ${slot} → ${to}`);
        dropExtra(ctx, date, slot);
        if (!mealOf(ctx.store.day(date), to).items.length) ((ctx.state.extraMeals ||= {})[date] ||= []).push(to);
        toast(`Ahora se llama «${to}»`);
        closeSheet();
        ctx.render();
      });
    },
  });
}

// ---------------------------------------------------------------- comida nueva (del día)
function newMealSheet(ctx, date) {
  const v = planFor(ctx.store.get(FILES.plan), date);
  const shown = new Set(slotsFor(ctx, v, date));
  let n = 1; while (shown.has(`Comida ${n}`)) n++;
  const sugg = [...new Set([`Comida ${n}`, ...mealPlan(v).list.map((m) => m.slot), 'Desayuno', 'Almuerzo', 'Comida', 'Merienda', 'Cena', 'Pre-entreno', 'Intra-entreno', 'Post-entreno', 'Snack'])].filter((x) => !shown.has(x));
  openSheet(`<h3>Añadir comida</h3>
    <div class="chipset" id="mSug" style="margin-top:12px">${sugg.slice(0, 10).map((x) => `<button type="button" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
    <div class="field" style="margin-top:12px"><label for="mName">O escribe el nombre</label><input class="inp" id="mName" placeholder="p. ej. Intra-entreno"></div>
    <div class="sheet-actions"><button class="btn primary" id="mAdd" style="margin-top:12px">Añadir y buscar alimento</button></div>`, {
    bind: (sh) => {
      const go = (name) => {
        name = String(name || '').trim();
        if (!name) return toast('Elige o escribe un nombre');
        ((ctx.state.extraMeals ||= {})[date] ||= []).includes(name) || ctx.state.extraMeals[date].push(name);
        ctx.render();
        addSheet(ctx, date, name);
      };
      $$('#mSug button', sh).forEach((b) => b.addEventListener('click', () => go(b.dataset.v)));
      $('#mAdd', sh).addEventListener('click', () => go($('#mName', sh).value));
    },
  });
}

// ---------------------------------------------------------------- mis alimentos, comidas guardadas e historial
const foodsDocOf = (ctx) => ctx.store.get(FILES.foods) || {};
export const favoritesOf = (ctx) => foodsDocOf(ctx).favorites || [];
export const savedMealsOf = (ctx) => foodsDocOf(ctx).saved_meals || [];
function updFoods(ctx, fn, msg) {
  ctx.store.update(FILES.foods, (doc) => {
    doc = doc && typeof doc === 'object' ? doc : {};
    doc.custom ||= []; doc.recipes ||= []; doc.frequent ||= {};
    fn(doc);
    return doc;
  }, msg);
}
/** Copia mínima de un alimento para guardarla con un favorito: lo justo para apuntarlo sin la base. */
const snap = (f) => JSON.parse(JSON.stringify({ id: f.id, name: f.name, brand: f.brand || undefined, per100: f.per100, units: f.units?.length ? f.units : undefined, qty: f.qty || undefined }));
/** Alimento a partir de un registro del día: el de la base si está cargada; si no, lo que guarda el registro. */
function foodOfItem(ctx, it) {
  return byId(it.food, ctx.store.get(FILES.foods)) || { id: it.food, name: it.name, brand: it.brand, per100: it.per100, units: it.unit ? [{ name: it.unit.name, g: it.unit.g }] : [] };
}
const historyAt = (ctx, date) => foodHistory(ctx.store.allDays(), date);
const qLabel = (e) => (e.unit ? `${fmt(e.unit.n, e.unit.n % 1 ? 1 : 0)} ${unitLabel(e.unit.name, e.unit.n)}` : `${fmtK(e.g)} g`);
const vib = (ms = 12) => { try { navigator.vibrate?.(ms); } catch { /* sin vibración */ } };

/** Bandeja: lo que se va eligiendo en «Añadir» antes de confirmarlo todo junto. [{food, g, unit}] */
let TRAY = { key: '', items: [] };

// ---------------------------------------------------------------- añadir: buscar
function resultRow(f, terms) {
  const hl = (s) => esc(s).split(' ').map((w) => (terms.some((t) => norm(w).startsWith(t)) ? `<mark>${w}</mark>` : w)).join(' ');
  const src = f.src === 'gen' ? 'Genérico' : f.src === 'mine' ? 'Mío' : 'Producto';
  return `<button class="res" data-pick="${esc(f.id)}"><div class="ft"><b>${hl(f.name)}</b><span>${[f.brand && hl(f.brand), f.stores && esc(f.stores), f.qty && esc(f.qty)].filter(Boolean).join(' · ')}${f.brand || f.stores || f.qty ? ' · ' : ''}${fmtK(f.per100.kcal)} kcal · P ${fmt(f.per100.p)} · C ${fmt(f.per100.c)} · G ${fmt(f.per100.f)} /100 g</span></div><span class="src ${f.src === 'mine' ? 'mine' : ''}">${src}</span></button>`;
}

/**
 * Añadir a una comida. Sin escribir nada: lo que sueles poner en esa comida, «Mis alimentos» (con su
 * cantidad), comidas guardadas y recientes; con «+» van a la bandeja y se confirman todos juntos.
 */
function addSheet(ctx, date, slot, { keep = false } = {}) {
  const key = `${date}|${slot}`;
  if (!keep || TRAY.key !== key) TRAY = { key, items: [] };
  const tray = TRAY.items;
  let lastResults = [], online = [], pool = [];
  const foodsDoc = () => ctx.store.get(FILES.foods);
  const h = historyAt(ctx, date);
  const v = planFor(ctx.store.get(FILES.plan), date);
  openSheet(`<h3>Añadir a ${esc(slot)}</h3>
    <div class="srch"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input class="inp" id="fq" placeholder="Buscar: «patata mercadona cocida»" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"></div>
    <div class="chips-row"><button id="fScan">▦ Escanear código</button><button id="fQuick">+ Rápido (solo kcal)</button><button id="fNew">+ Crear alimento</button><button id="fOnline">Buscar en internet</button></div>
    <div id="fres"></div>
    <div class="sheet-actions tray" id="tray" hidden></div>`, {
    bind: (sh) => {
      const input = $('#fq', sh);
      const inTray = (id) => tray.some((x) => x.food.id === id);
      const fromItem = (it) => ({ food: foodOfItem(ctx, it), g: it.g, unit: it.unit || null });
      const row = (e) => {
        const k = pool.push(e) - 1, x = macrosFor(e.food.per100, e.g), on = inTray(e.food.id);
        return `<div class="qrow ${on ? 'in' : ''}"><button class="qn" data-open="${k}"><b>${esc(e.food.name)}</b><span><b>${esc(qLabel(e))}</b> · ${fmtK(x.kcal)} kcal · P ${fmtK(x.p)}</span></button><button class="qplus" data-tadd="${k}" aria-label="${on ? 'Quitar de' : 'Añadir a'} la bandeja">${on ? icon.check : icon.plus}</button></div>`;
      };
      const chip = (e) => {
        const k = pool.push(e) - 1, on = inTray(e.food.id);
        return `<button class="favc ${on ? 'in' : ''}" data-tadd="${k}"><span class="fn">${esc(e.food.name)}</span><small>${esc(qLabel(e))}</small><span class="qplus">${on ? icon.check : icon.plus}</span></button>`;
      };
      const home = () => {
        const day = ctx.store.day(date);
        const inMeal = new Set(mealOf(day, slot).items.map((i) => i.food));
        const sugg = h.forSlot(slot).filter((it) => !inMeal.has(it.food)).slice(0, 5).map(fromItem);
        const favs = favoritesOf(ctx).map((f) => ({ food: f.food, g: f.g, unit: f.unit || null }));
        const saved = savedMealsOf(ctx);
        const seen = new Set([...sugg.map((e) => e.food.id), ...inMeal]);
        const rec = h.recent(14).filter((it) => !seen.has(it.food)).slice(0, 8).map(fromItem);
        let out = '';
        if (sugg.length) out += `<div class="grp">Sueles poner en ${esc(slot)}</div><div class="qlist">${sugg.map(row).join('')}</div>`;
        out += `<div class="grp">Mis alimentos</div>${favs.length ? `<div class="favs">${favs.map(chip).join('')}</div>` : '<div class="muted small">Toca la ⭐ al elegir la cantidad de un alimento y lo tendrás aquí, con esa cantidad, a un toque.</div>'}`;
        if (saved.length) out += `<div class="grp grp-row"><span>Comidas guardadas</span><button class="link" id="svEdit">Editar</button></div><div class="saved">${saved.map((m, i) => { const t = sumItems(m.items); return `<button class="sv" data-saved="${i}"><b>${esc(m.name)}</b><span>${m.items.length} ${m.items.length === 1 ? 'alimento' : 'alimentos'} · ${fmtK(t.kcal)} kcal · P ${fmtK(t.p)}</span></button>`; }).join('')}</div>`;
        if (rec.length) out += `<div class="grp">Recientes</div><div class="qlist">${rec.map(row).join('')}</div>`;
        if (!sugg.length && !favs.length && !rec.length) {
          const fr = frequentFoods(foodsDoc());
          out += fr.length ? `<div class="grp">Frecuentes</div>${fr.map((f) => resultRow(f, [])).join('')}` : '<div class="muted small" style="padding:10px 0">Escribe para buscar: genéricos, productos de supermercado y tus alimentos.</div>';
          lastResults = fr;
        }
        return out;
      };
      const paint = () => {
        pool = [];
        const q = input.value;
        if (!q.trim() && !online.length) {
          $('#fres', sh).innerHTML = home();
        } else {
          const terms = highlightTerms(q);
          const list = findFoods(q, foodsDoc());
          const onl = online.length ? `<div class="grp">En internet (Open Food Facts)</div>${online.map((f) => resultRow(f, terms)).join('')}` : '';
          lastResults = [...list, ...online];
          $('#fres', sh).innerHTML = list.map((f) => resultRow(f, terms)).join('') + onl +
            (!list.length && !online.length ? '<div class="muted small" style="padding:12px 0">Sin resultados. Prueba «Buscar en internet», escanea el código o créalo.</div>' : '');
        }
        $$('[data-pick]', sh).forEach((b) => b.addEventListener('click', () => {
          const f = lastResults.find((x) => x.id === b.dataset.pick);
          if (f) gramsSheet(ctx, date, slot, f, { back: true });
        }));
        $$('[data-open]', sh).forEach((b) => b.addEventListener('click', () => { const e = pool[+b.dataset.open]; gramsSheet(ctx, date, slot, e.food, { initial: e.g, initialUnit: e.unit, back: true }); }));
        $$('[data-tadd]', sh).forEach((b) => b.addEventListener('click', () => {
          const e = pool[+b.dataset.tadd];
          const i = tray.findIndex((x) => x.food.id === e.food.id);
          if (i >= 0) tray.splice(i, 1); else tray.push({ food: e.food, g: e.g, unit: e.unit });
          vib(); paint();
        }));
        $$('[data-saved]', sh).forEach((b) => b.addEventListener('click', () => {
          const m = savedMealsOf(ctx)[+b.dataset.saved];
          for (const it of m.items) if (!inTray(it.food)) tray.push(it.quick ? { food: { id: it.food, name: it.name, per100: it.per100, quick: true }, g: it.g, unit: null } : fromItem(it));
          vib(); paint(); toast(`«${m.name}» en la bandeja`);
        }));
        $('#svEdit', sh)?.addEventListener('click', () => savedManageSheet(ctx, date, slot));
        paintTray();
      };
      const paintTray = () => {
        const el = $('#tray', sh);
        if (!tray.length) { el.hidden = true; el.innerHTML = ''; return; }
        const add = tray.reduce((a, e) => { const x = macrosFor(e.food.per100, e.g); a.kcal += x.kcal; a.p += x.p; return a; }, { kcal: 0, p: 0 });
        const now = sumItems((ctx.store.day(date).meals || []).flatMap((m) => m.items));
        const tk = v ? dayTargets(v, ctx.store.day(date).trained).kcal : 0;
        const pct = (x) => Math.min(100, tk ? (x / tk) * 100 : 0);
        el.hidden = false;
        el.innerHTML = `<div class="tray-pre"><span>${tray.length} en la bandeja · <b>+${fmtK(add.kcal)} kcal · P +${fmtK(add.p)}</b></span>${tk ? `<span>el día quedaría en <b>${fmtK(now.kcal + add.kcal)} / ${fmtK(tk)}</b></span>` : ''}</div>
          ${tk ? `<div class="bar2"><i class="pre" style="width:${pct(now.kcal + add.kcal)}%"></i><i style="width:${pct(now.kcal)}%"></i></div>` : ''}
          <div class="tray-btns"><button class="btn secondary sm" id="trClear" type="button">Vaciar</button><button class="btn primary" id="trGo" type="button">Añadir ${tray.length} a ${esc(slot)}</button></div>`;
        $('#trClear', sh).addEventListener('click', () => { tray.length = 0; paint(); });
        $('#trGo', sh).addEventListener('click', () => commitTray(ctx, date, slot));
      };
      let t;
      input.addEventListener('input', () => { online = []; clearTimeout(t); t = setTimeout(paint, 120); });
      paint();
      if (!isLoaded()) loadFoods().then(() => { if (input.value.trim()) paint(); }).catch(() => { $('#fres', sh).insertAdjacentHTML('afterbegin', '<div class="err">No se pudo cargar la base de alimentos.</div>'); });
      $('#fNew', sh).addEventListener('click', () => customFoodSheet(ctx, date, slot, { name: input.value.trim() }));
      $('#fScan', sh).addEventListener('click', () => scanSheet(ctx, date, slot));
      $('#fQuick', sh).addEventListener('click', () => quickSheet(ctx, date, slot));
      $('#fOnline', sh).addEventListener('click', async (e) => {
        const q = input.value.trim();
        if (q.length < 3) return toast('Escribe al menos 3 letras');
        e.target.textContent = 'Buscando…';
        try { online = await searchOnline(q); if (!online.length) toast('Tampoco está en internet'); }
        catch { toast('No se pudo consultar (sin conexión o límite de búsquedas)'); }
        e.target.textContent = 'Buscar en internet';
        paint();
      });
    },
  });
}

/** Apunta todo lo de la bandeja en la comida, con «Deshacer». */
function commitTray(ctx, date, slot) {
  const tray = TRAY.items;
  if (!tray.length) return;
  const before = structuredClone(mealOf(ctx.store.day(date), slot).items);
  for (const e of tray) {
    if (e.food.quick) ctx.store.updateDay(date, (d) => { const m = mealOf(d, slot); setMeal(d, slot, [...m.items, { food: e.food.id, name: e.food.name, g: e.g, quick: true, per100: { ...e.food.per100 } }]); }, `${slot} ${fmtShort(date)}: +${e.food.name}`);
    else addItem(ctx, date, slot, e.food, e.g, e.unit);
  }
  const n = tray.length;
  TRAY = { key: '', items: [] };
  vib(20);
  closeSheet();
  ctx.render();
  toast(`${n} ${n === 1 ? 'alimento añadido' : 'alimentos añadidos'} a ${slot}`, { action: { label: 'Deshacer', fn: () => {
    ctx.store.updateDay(date, (d) => setMeal(d, slot, before), `${slot} ${fmtShort(date)}: deshace lo añadido`);
    ctx.render();
  } } });
}

// ---------------------------------------------------------------- cantidad
/**
 * Elegir cantidad. Empieza en tu última cantidad de ese alimento, ofrece tus cantidades habituales,
 * calcula los gramos para una proteína o unas kcal dadas y enseña cómo queda el día. ⭐ = Mis alimentos.
 * back: se abrió desde «Añadir» (permite volver y usar la bandeja).
 */
function gramsSheet(ctx, date, slot, food, { initial = null, initialUnit = null, onSave = null, back = false } = {}) {
  const units = unitsOf(food);
  const h = historyAt(ctx, date);
  const last = h.last(food.id);
  if (initial == null && !onSave && last) { initial = last.g; initialUnit = last.unit || null; }
  const fromHistory = initial != null && !initialUnit && !onSave;
  // unidad por defecto: la del registro que se edita o la última usada; si no, la primera propia del alimento
  let unit = initialUnit ? units.find((u) => u.name === initialUnit.name) || { name: initialUnit.name, g: initialUnit.g } : fromHistory ? null : (food.units?.[0] || null);
  let qty = initialUnit ? initialUnit.n : unit ? 1 : initial ?? 100;
  const hab = [...new Set([last && !last.unit ? Math.round(last.g) : null, ...h.habitual(food.id, 4).filter((q) => !q.unit).map((q) => q.g)].filter(Boolean))];
  const gramChips = [...hab, ...[50, 100, 150, 200].filter((x) => !hab.includes(x))].slice(0, 4);
  const trayN = back ? TRAY.items.length : 0;
  const v = planFor(ctx.store.get(FILES.plan), date);
  const isFav = () => favoritesOf(ctx).some((f) => f.food.id === food.id);
  const unitBtns = `<div class="seg" id="uSeg" style="margin:10px 0 0">${[['g', 'gramos'], ...units.map((u) => [u.name, `${u.name} · ${fmt(u.g, u.g % 1 ? 1 : 0)} g`])].map(([k, l]) => `<button type="button" data-v="${esc(k)}" class="${(unit ? unit.name : 'g') === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
  openSheet(`<div class="sheet-title">${back ? `<button class="mini" id="fBack" aria-label="Volver a la lista">${icon.back}</button>` : ''}<h3>${esc(food.name)}</h3>${food.quick ? '' : `<button class="star ${isFav() ? 'on' : ''}" id="fFav" aria-label="Mis alimentos">★</button>`}</div>
    <div class="muted">${[food.brand, food.stores || (food.src === 'gen' ? 'Genérico (CIQUAL)' : ''), food.qty].filter(Boolean).map(esc).join(' · ')}${food.brand || food.stores || food.qty || food.src === 'gen' ? ' · ' : ''}${fmtK(food.per100.kcal)} kcal/100 g</div>
    ${units.length ? unitBtns : ''}
    <div class="qty-big"><input id="fg" inputmode="decimal" value="${fmt(qty, qty % 1 ? 1 : 0)}" aria-label="Cantidad"><span id="fgU"></span></div>
    <div class="qchips" id="gpick"></div>
    ${onSave ? '' : `<div class="solver"><span>o calcula por</span><div class="seg sm" id="solveSeg"><button type="button" data-v="g" class="on">gramos</button><button type="button" data-v="p">proteína</button><button type="button" data-v="k">kcal</button></div></div>
    <div id="solveBox" hidden><div class="solver"><span>Quiero</span><input class="inp sm" id="solveIn" inputmode="decimal" style="width:84px;text-align:center"><span id="solveU">g de proteína</span></div>
      <div style="text-align:center;margin:-2px 0 10px"><button class="btn secondary sm" type="button" id="fillP">Lo que me falta de proteína</button></div></div>`}
    <div class="mtot" id="mt"></div>
    ${onSave || !v ? '' : '<div class="impact" id="imp"></div>'}
    <div class="sheet-actions">${!onSave && back && !trayN ? '<div class="g2" style="gap:8px"><button class="btn secondary" id="fMore">Añadir y elegir más</button><button class="btn primary" id="fAdd">Añadir</button></div>' : `<button class="btn primary" id="fAdd">${onSave ? 'Guardar' : trayN ? `Añadir a la bandeja (${trayN + 1})` : `Añadir a ${esc(slot)}`}</button>`}</div>
    ${food.quick ? '' : '<button class="link" id="fEdit" type="button" style="width:100%;text-align:center;margin-top:6px">Editar datos o unidades de este alimento</button>'}`, {
    bind: (sh) => {
      const grams = () => (num($('#fg', sh).value) || 0) * (unit ? unit.g : 1);
      const setGrams = (g) => { const n = unit ? g / unit.g : g; $('#fg', sh).value = fmt(Math.round(n * 10) / 10, (Math.round(n * 10) / 10) % 1 ? 1 : 0); upd(); };
      const paintQuick = () => {
        const list = unit ? [1, 2, 3, 4].map((x) => [x, '']) : gramChips.map((x) => [x, last && !last.unit && Math.round(last.g) === x ? 'la última' : hab.includes(x) ? 'habitual' : '']);
        $('#gpick', sh).innerHTML = list.map(([x, l]) => `<button type="button" class="qc" data-g="${x}">${x}${unit ? '' : ' g'}${l ? ` <small>· ${l}</small>` : ''}</button>`).join('');
        $$('[data-g]', sh).forEach((b) => b.addEventListener('click', () => { $('#fg', sh).value = b.dataset.g; upd(); }));
      };
      const upd = () => {
        const g = grams();
        const x = macrosFor(food.per100, g);
        $('#fgU', sh).textContent = unit ? unitLabel(unit.name, num($('#fg', sh).value) || 0) : 'g';
        $$('#gpick .qc', sh).forEach((b) => b.classList.toggle('on', num($('#fg', sh).value) === +b.dataset.g));
        $('#mt', sh).innerHTML = `<div><b class="num">${fmtK(x.kcal)}</b><span>kcal</span></div><div><b class="num" style="color:var(--blue)">${fmt(x.p)}</b><span>prot. g</span></div><div><b class="num">${fmt(x.c)}</b><span>carb. g</span></div><div><b class="num">${fmt(x.f)}</b><span>grasa g</span></div>${unit ? `<div style="grid-column:1/-1;font-size:11.5px;color:var(--ink-3);font-weight:700">= ${fmt(g, g % 1 ? 1 : 0)} g</div>` : ''}`;
        const imp = $('#imp', sh);
        if (imp) {
          const day = ctx.store.day(date);
          const t = dayTargets(v, day.trained);
          const now = sumItems((day.meals || []).flatMap((m) => m.items));
          const extra = trayN ? TRAY.items.reduce((a, e) => { const y = macrosFor(e.food.per100, e.g); a.kcal += y.kcal; a.p += y.p; a.c += y.c; a.f += y.f; return a; }, { kcal: 0, p: 0, c: 0, f: 0 }) : { kcal: 0, p: 0, c: 0, f: 0 };
          const line = (l, cur, add, goal, col) => `<div class="imp"><span>${l}</span><div class="bar2"><i class="pre" style="width:${Math.min(100, ((cur + add) / (goal || 1)) * 100)}%;background:${col}"></i><i style="width:${Math.min(100, (cur / (goal || 1)) * 100)}%;background:${col}"></i></div><span class="num"><b>${fmtK(cur + add)}</b> / ${fmtK(goal)}</span></div>`;
          imp.innerHTML = `<div class="grp" style="margin:0 0 6px">Así queda el día</div>${line('kcal', now.kcal + extra.kcal, x.kcal, t.kcal, 'var(--accent)')}${line('Proteína', now.p + extra.p, x.p, t.p, 'var(--blue)')}${line('Carbos', now.c + extra.c, x.c, t.c, 'var(--slate)')}${line('Grasas', now.f + extra.f, x.f, t.f, 'var(--slate)')}`;
        }
      };
      const pickUnit = (k) => {
        const g = grams();
        $$('#uSeg button', sh).forEach((x) => x.classList.toggle('on', x.dataset.v === k));
        unit = k === 'g' ? null : units.find((u) => u.name === k);
        setGrams(g);
        paintQuick(); upd();
      };
      $$('#uSeg button', sh).forEach((b) => b.addEventListener('click', () => pickUnit(b.dataset.v)));
      $('#fg', sh).addEventListener('input', upd);
      $('#fg', sh).addEventListener('focus', (e) => e.target.select());
      paintQuick(); upd();
      // calculadora inversa: gramos para X g de proteína o X kcal
      const solve = () => {
        const mode = segValue(sh, '#solveSeg'), want = num($('#solveIn', sh).value);
        const per = mode === 'p' ? food.per100.p : food.per100.kcal;
        if (want == null || !per) return;
        if (unit) pickUnit('g');
        setGrams(Math.max(0, Math.min(5000, (want / per) * 100)));
      };
      bindSeg(sh, '#solveSeg', (m) => {
        $('#solveBox', sh).hidden = m === 'g';
        if (m === 'g') return;
        const x = macrosFor(food.per100, grams());
        $('#solveU', sh).textContent = m === 'p' ? 'g de proteína' : 'kcal';
        $('#fillP', sh).hidden = m !== 'p';
        $('#solveIn', sh).value = fmtK(m === 'p' ? x.p : x.kcal);
        if (m === 'p' && !food.per100.p) toast('Este alimento no tiene proteína');
        $('#solveIn', sh).focus();
      });
      $('#solveIn', sh)?.addEventListener('input', solve);
      $('#solveIn', sh)?.addEventListener('focus', (e) => e.target.select());
      $('#fillP', sh)?.addEventListener('click', () => {
        const day = ctx.store.day(date);
        const falta = dayTargets(v, day.trained).p - sumItems((day.meals || []).flatMap((m) => m.items)).p;
        if (falta <= 0) return toast('Ya tienes la proteína del día');
        $('#solveIn', sh).value = fmtK(falta); solve();
      });
      $('#fFav', sh)?.addEventListener('click', (e) => {
        const on = isFav();
        const g = grams(), n = num($('#fg', sh).value);
        const u = unit ? { name: unit.name, g: unit.g, n } : null;
        updFoods(ctx, (doc) => {
          doc.favorites = (doc.favorites || []).filter((f) => f.food.id !== food.id);
          if (!on) doc.favorites.push({ food: snap(food), g, ...(u ? { unit: u } : {}) });
          if (!doc.favorites.length) delete doc.favorites;
        }, `${on ? 'Quita de' : 'Añade a'} Mis alimentos: ${food.name}`);
        e.currentTarget.classList.toggle('on', !on);
        vib();
        toast(on ? 'Quitado de Mis alimentos' : `En Mis alimentos con ${u ? qLabel({ unit: u }) : `${fmtK(g)} g`}`);
      });
      $('#fBack', sh)?.addEventListener('click', () => addSheet(ctx, date, slot, { keep: true }));
      $('#fEdit', sh)?.addEventListener('click', () => foodEditor(ctx, date, slot, food));
      const read = () => {
        const n = num($('#fg', sh).value);
        const g = grams();
        if (!n || n <= 0 || g > 5000) { toast('Cantidad no válida'); return null; }
        return { g, u: unit ? { name: unit.name, g: unit.g, n } : null };
      };
      const toTray = (r) => { TRAY.items.push({ food, g: r.g, unit: r.u }); vib(); addSheet(ctx, date, slot, { keep: true }); };
      $('#fMore', sh)?.addEventListener('click', () => { const r = read(); if (r) toTray(r); });
      $('#fAdd', sh).addEventListener('click', () => {
        const r = read(); if (!r) return;
        if (onSave) { onSave(r.g, r.u); closeSheet(); ctx.render(); return; }
        if (trayN) { toTray(r); return; }
        TRAY = { key: `${date}|${slot}`, items: [{ food, g: r.g, unit: r.u }] };
        commitTray(ctx, date, slot);
      });
    },
  });
}

// ---------------------------------------------------------------- añadir rápido (solo cifras)
function quickSheet(ctx, date, slot) {
  openSheet(`<h3>Añadir rápido</h3><div class="muted">Para cuando no sabes los alimentos (comer fuera): solo las cifras.</div>
    <div class="stack" style="margin-top:12px">
      <div class="field"><label for="qN">Qué fue</label><input class="inp" id="qN" placeholder="p. ej. Menú del día"></div>
      <div class="g2"><div class="field"><label for="qK">Kcal</label><input class="inp" id="qK" inputmode="decimal"></div><div class="field"><label for="qP">Proteína g</label><input class="inp" id="qP" inputmode="decimal"></div></div>
      <div class="g2"><div class="field"><label for="qC">Carbohidratos g</label><input class="inp" id="qC" inputmode="decimal"></div><div class="field"><label for="qF">Grasas g</label><input class="inp" id="qF" inputmode="decimal"></div></div>
      <div class="hint">Si no pones las kcal, se calculan con los macros.</div>
      <div class="sheet-actions"><button class="btn primary" id="qAdd">Añadir a ${esc(slot)}</button></div>
    </div>`, {
    bind: (sh) => $('#qAdd', sh).addEventListener('click', () => {
      const p = num($('#qP', sh).value) || 0, c = num($('#qC', sh).value) || 0, f = num($('#qF', sh).value) || 0;
      let kcal = num($('#qK', sh).value);
      if (kcal == null) kcal = Math.round(4 * p + 4 * c + 9 * f);
      if (!kcal || kcal < 0 || kcal > 6000) return toast('Pon las kcal (o los macros)');
      const name = $('#qN', sh).value.trim() || 'Añadido rápido';
      TRAY = { key: `${date}|${slot}`, items: [...(TRAY.key === `${date}|${slot}` ? TRAY.items : []), { food: { id: `quick:${Date.now().toString(36)}`, name, quick: true, per100: { kcal, p, c, f } }, g: 100, unit: null }] };
      commitTray(ctx, date, slot);
    }),
  });
}

// ---------------------------------------------------------------- menú de una comida: copiar, guardar
function copyMealTo(ctx, fromDate, slot, toDate) {
  const items = structuredClone(mealOf(ctx.store.day(fromDate), slot).items);
  if (!items.length) return toast('La comida está vacía');
  const before = structuredClone(mealOf(ctx.store.day(toDate), slot).items);
  ctx.store.updateDay(toDate, (d) => { const m = mealOf(d, slot); setMeal(d, slot, [...m.items, ...items]); }, `${slot} ${fmtShort(toDate)}: copiada de ${fmtShort(fromDate)}`);
  ctx.render();
  toast(`${slot} copiada al ${fmtShort(toDate)}`, { action: { label: 'Deshacer', fn: () => { ctx.store.updateDay(toDate, (d) => setMeal(d, slot, before), `${slot} ${fmtShort(toDate)}: deshace copia`); ctx.render(); } } });
}

async function saveMealAs(ctx, items, suggested = '') {
  const name = await askText({ title: 'Guardar comida', text: 'Para añadirla entera de un toque (en «Añadir» → Comidas guardadas).', placeholder: suggested || 'p. ej. Desayuno de siempre', ok: 'Guardar' });
  if (!name) return;
  updFoods(ctx, (doc) => { doc.saved_meals = [...(doc.saved_meals || []), { id: `m:${Date.now().toString(36)}`, name, items: structuredClone(items) }]; }, `Comida guardada: ${name}`);
  toast(`«${name}» guardada`);
  ctx.render();
}

function mealMenuSheet(ctx, date, slot) {
  const m = mealOf(ctx.store.day(date), slot);
  const today = ctx.today(), tomorrow = addDays(today, 1);
  const opt = (id, ic, t, sub = '') => `<button class="menu-it" id="${id}" type="button">${ic}<span>${t}${sub ? `<small>${sub}</small>` : ''}</span></button>`;
  openSheet(`<h3>${esc(slot)}</h3><div class="muted">${fmtShort(date)} · ${m.items.length} ${m.items.length === 1 ? 'alimento' : 'alimentos'}</div>
    <div class="menu-list">
      ${m.items.length && date !== today ? opt('mmToday', icon.copy, 'Copiar a hoy') : ''}
      ${m.items.length ? opt('mmTomorrow', icon.copy, date === tomorrow ? 'Copiar a hoy' : 'Copiar a mañana') : ''}
      ${m.items.length ? `<div class="menu-it"><span style="flex:1">Copiar a otro día<small>Se añade a «${esc(slot)}» de ese día</small></span><input type="date" class="inp sm" id="mmDate" max="${tomorrow}" style="width:auto"></div>` : ''}
      ${m.items.length ? opt('mmSave', icon.list, 'Guardar como comida', 'Para añadirla entera de un toque') : ''}
      ${opt('mmRename', icon.edit, 'Cambiar nombre')}
      <button class="menu-it danger" id="mmDel" type="button">${icon.trash}<span>Borrar comida</span></button>
    </div>`, {
    bind: (sh) => {
      $('#mmToday', sh)?.addEventListener('click', () => { closeSheet(); copyMealTo(ctx, date, slot, today); });
      $('#mmTomorrow', sh)?.addEventListener('click', () => { closeSheet(); copyMealTo(ctx, date, slot, date === tomorrow ? today : tomorrow); });
      $('#mmDate', sh)?.addEventListener('change', (e) => { const to = e.target.value; if (!to || to > tomorrow) return; closeSheet(); copyMealTo(ctx, date, slot, to); });
      $('#mmSave', sh)?.addEventListener('click', () => { closeSheet(); saveMealAs(ctx, m.items, slot); });
      $('#mmRename', sh).addEventListener('click', () => renameMealSheet(ctx, date, slot));
      $('#mmDel', sh).addEventListener('click', () => { closeSheet(); removeMeal(ctx, date, slot); });
    },
  });
}

/** Elegir una comida guardada para una comida vacía (se añade entera, con «Deshacer»). */
function savedPickSheet(ctx, date, slot) {
  const saved = savedMealsOf(ctx);
  openSheet(`<h3>Comida guardada</h3><div class="muted">Se añade entera a «${esc(slot)}».</div>
    <div class="saved" style="margin-top:12px">${saved.map((m, i) => { const t = sumItems(m.items); return `<button class="sv" data-sp="${i}"><b>${esc(m.name)}</b><span>${m.items.map((x) => esc(x.name)).join(' · ')}</span><span>${fmtK(t.kcal)} kcal · P ${fmtK(t.p)}</span></button>`; }).join('')}</div>`, {
    bind: (sh) => $$('[data-sp]', sh).forEach((b) => b.addEventListener('click', () => {
      const m = saved[+b.dataset.sp];
      const before = structuredClone(mealOf(ctx.store.day(date), slot).items);
      ctx.store.updateDay(date, (d) => { const cur = mealOf(d, slot); setMeal(d, slot, [...cur.items, ...structuredClone(m.items)]); }, `${slot} ${fmtShort(date)}: ${m.name}`);
      closeSheet(); ctx.render(); vib(20);
      toast(`«${m.name}» añadida`, { action: { label: 'Deshacer', fn: () => { ctx.store.updateDay(date, (d) => setMeal(d, slot, before), `${slot} ${fmtShort(date)}: deshace ${m.name}`); ctx.render(); } } });
    })),
  });
}

function savedManageSheet(ctx, date, slot) {
  const saved = savedMealsOf(ctx);
  openSheet(`<h3>Comidas guardadas</h3><div class="muted">Para crear una: menú ⋯ de una comida → «Guardar como comida».</div>
    <div style="margin-top:10px">${saved.map((m, i) => { const t = sumItems(m.items); return `<div class="row-edit"><div class="t"><b>${esc(m.name)}</b><span>${m.items.map((x) => esc(x.name)).join(' · ')} · ${fmtK(t.kcal)} kcal</span></div><div class="ops"><button class="mini danger" data-sdel="${i}" aria-label="Borrar ${esc(m.name)}">${icon.trash}</button></div></div>`; }).join('') || '<div class="muted small">No hay ninguna.</div>'}</div>
    <button class="btn secondary" id="svBack" style="margin-top:12px">Volver</button>`, {
    bind: (sh) => {
      $('#svBack', sh).addEventListener('click', () => addSheet(ctx, date, slot, { keep: true }));
      $$('[data-sdel]', sh).forEach((b) => b.addEventListener('click', async () => {
        const m = saved[+b.dataset.sdel];
        if (!(await ask({ title: `¿Borrar «${m.name}»?`, text: 'Solo se borra la comida guardada; lo que ya apuntaste no se toca.', ok: 'Borrar', danger: true }))) return;
        updFoods(ctx, (doc) => { doc.saved_meals = (doc.saved_meals || []).filter((x) => x.id !== m.id); if (!doc.saved_meals.length) delete doc.saved_meals; }, `Borra comida guardada: ${m.name}`);
        toast(`«${m.name}» borrada`);
        savedManageSheet(ctx, date, slot);
      }));
    },
  });
}

// ---------------------------------------------------------------- editar un alimento apuntado
function itemSheet(ctx, date, slot, i) {
  const day = ctx.store.day(date);
  const it = mealOf(day, slot).items[i];
  if (!it) return;
  const slots = slotsFor(ctx, planFor(ctx.store.get(FILES.plan), date), date);
  const known = byId(it.food, ctx.store.get(FILES.foods));
  const food = { id: it.food, name: it.name, brand: it.brand, per100: it.per100, units: known?.units || (it.unit ? [{ name: it.unit.name, g: it.unit.g }] : []), qty: known?.qty };
  openSheet(`<h3>${esc(it.name)}</h3><div class="muted">${esc(slot)} · ${it.unit ? `${fmt(it.unit.n, it.unit.n % 1 ? 1 : 0)} ${esc(unitLabel(it.unit.name, it.unit.n))} · ` : ''}${fmtK(it.g)} g</div>
    <div class="stack" style="margin-top:14px">
      ${it.quick ? '' : `<button class="btn secondary" id="iG">${icon.edit} Cambiar cantidad</button>`}
      <div class="field"><label for="iMove">Mover a</label><select class="inp" id="iMove">${slots.map((s) => `<option ${s === slot ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <button class="btn secondary" id="iDel" style="color:var(--amber)">${icon.trash} Quitar</button>
    </div>`, {
    bind: (sh) => {
      $('#iG', sh)?.addEventListener('click', () => gramsSheet(ctx, date, slot, food, {
        initial: it.g,
        initialUnit: it.unit || null,
        onSave: (g, u) => ctx.store.updateDay(date, (d) => { const m = mealOf(d, slot); m.items[i].g = g; if (u) m.items[i].unit = u; else delete m.items[i].unit; setMeal(d, slot, m.items); }, `${slot} ${fmtShort(date)}: ${it.name} ${fmtK(g)} g`),
      }));
      $('#iMove', sh).addEventListener('change', (e) => {
        const to = e.target.value;
        if (to === slot) return;
        ctx.store.updateDay(date, (d) => {
          const from = mealOf(d, slot), dest = mealOf(d, to);
          const [moved] = from.items.splice(i, 1);
          setMeal(d, slot, from.items);
          setMeal(d, to, [...dest.items, moved]);
        }, `${fmtShort(date)}: ${it.name} a ${to}`);
        closeSheet(); ctx.render();
      });
      $('#iDel', sh).addEventListener('click', () => {
        const removed = structuredClone(it);
        ctx.store.updateDay(date, (d) => { const m = mealOf(d, slot); m.items.splice(i, 1); setMeal(d, slot, m.items); }, `${slot} ${fmtShort(date)}: −${it.name}`);
        closeSheet(); ctx.render();
        toast(`${it.name} quitado`, { action: { label: 'Deshacer', fn: () => {
          ctx.store.updateDay(date, (d) => { const m = mealOf(d, slot); m.items.splice(Math.min(i, m.items.length), 0, removed); setMeal(d, slot, m.items); }, `${slot} ${fmtShort(date)}: +${it.name} (recuperado)`);
          ctx.render();
        } } });
      });
    },
  });
}

// ---------------------------------------------------------------- alimento propio (crear o editar)
function customFoodSheet(ctx, date, slot, pre = {}) {
  foodEditor(ctx, date, slot, { ...pre, per100: null });
}

/**
 * Crear o editar un alimento. Editar uno propio lo actualiza; editar uno de la base (genérico o producto)
 * crea tu versión, que desde entonces sale primero y la usa el escáner. Unidades: «1 pastilla = 5,5 g».
 * Los valores se pueden meter por 100 g o por unidad (como vengan en la etiqueta).
 */
function foodEditor(ctx, date, slot, food) {
  const isMine = String(food.id || '').startsWith('mine:');
  const isNew = !food.per100;
  const units = [...(food.units || [])];
  const per = food.per100 || {};
  const unitRow = (u, i) => `<div class="row" data-unit="${i}" style="gap:6px;margin-bottom:6px"><input class="inp sm" data-f="un" value="${esc(u.name || '')}" placeholder="pastilla, ración, scoop…" style="flex:1"><div class="unit-wrap" style="width:110px"><input class="inp sm" data-f="ug" inputmode="decimal" value="${u.g != null ? fmt(u.g, u.g % 1 ? 1 : 0) : ''}" placeholder="peso"><span class="u">g</span></div><button type="button" class="mini danger" data-udel="${i}" aria-label="Quitar unidad">${icon.trash}</button></div>`;
  openSheet(`<h3>${isNew ? 'Crear alimento' : isMine ? 'Editar alimento' : 'Tu versión de este alimento'}</h3>
    <div class="muted">${isNew ? 'Copia la tabla de la etiqueta. Queda guardado para siempre.' : isMine ? 'Cambia lo que necesites.' : 'El original de la base no se toca: se guarda tu versión y es la que saldrá primero (también al escanear).'}</div>
    <div class="stack" style="margin-top:12px">
      <div class="field"><label for="cN">Nombre</label><input class="inp" id="cN" value="${esc(food.name || '')}" placeholder="p. ej. Pastillas de dextrosa"></div>
      <div class="g2"><div class="field"><label for="cB">Marca</label><input class="inp" id="cB" value="${esc(food.brand || '')}"></div><div class="field"><label for="cS">Tienda</label><input class="inp" id="cS" value="${esc(food.stores || '')}"></div></div>

      <div class="grp">Unidades (opcional)</div>
      <div class="muted small" style="margin-top:-4px">Para apuntar «4 pastillas» en vez de gramos. Si el envase no dice cuánto pesa una, pon los gramos de lo que aporta (p. ej. 5,5 g de dextrosa).</div>
      <div id="uList">${units.map(unitRow).join('')}</div>
      <button type="button" class="btn secondary sm" id="uAdd">${icon.plus} Añadir unidad</button>

      <div class="grp">Valores nutricionales</div>
      <div class="seg" id="cPer"><button data-v="100" class="on">Por 100 g</button><button data-v="unit">Por 1 unidad</button></div>
      <div class="g2"><div class="field"><label for="cK">Kcal</label><input class="inp" id="cK" inputmode="decimal" value="${per.kcal != null ? fmt(per.kcal) : ''}"></div><div class="field"><label for="cP">Proteína g</label><input class="inp" id="cP" inputmode="decimal" value="${per.p != null ? fmt(per.p) : ''}"></div></div>
      <div class="g2"><div class="field"><label for="cC">Carbohidratos g</label><input class="inp" id="cC" inputmode="decimal" value="${per.c != null ? fmt(per.c) : ''}"></div><div class="field"><label for="cF">Grasas g</label><input class="inp" id="cF" inputmode="decimal" value="${per.f != null ? fmt(per.f) : ''}"></div></div>
      <div class="g2"><div class="field"><label for="cQ">Envase (opcional)</label><input class="inp" id="cQ" value="${esc(food.qty || '')}" placeholder="200 pastillas · 400 g"></div><div class="field"><label for="cE">Código de barras</label><input class="inp" id="cE" inputmode="numeric" value="${esc(food.ean || '')}"></div></div>
      <div class="hint" id="cChk"></div>
      <div class="sheet-actions"><button class="btn primary" id="cSave">Guardar y elegir cantidad</button></div>
    </div>`, {
    bind: (sh) => {
      const readUnits = () => $$('[data-unit]', sh).map((r) => ({ name: $('[data-f="un"]', r).value.trim(), g: num($('[data-f="ug"]', r).value) })).filter((u) => u.name && u.g > 0);
      const bindUnits = () => $$('[data-udel]', sh).forEach((b) => b.addEventListener('click', () => { const u = readUnits(); u.splice(+b.dataset.udel, 1); $('#uList', sh).innerHTML = u.map(unitRow).join(''); bindUnits(); }));
      bindUnits();
      $('#uAdd', sh).addEventListener('click', () => { const u = [...readUnits(), { name: '', g: null }]; $('#uList', sh).innerHTML = u.map(unitRow).join(''); bindUnits(); $$('[data-f="un"]', sh).pop()?.focus(); });
      bindSeg(sh, '#cPer', (v) => {
        if (v === 'unit' && !readUnits().length) { toast('Primero añade la unidad y su peso'); $$('#cPer button', sh).forEach((b) => b.classList.toggle('on', b.dataset.v === '100')); }
      });
      const vals = () => ({ kcal: num($('#cK', sh).value), p: num($('#cP', sh).value), c: num($('#cC', sh).value), f: num($('#cF', sh).value) });
      const chk = () => {
        const v = vals();
        if ([v.p, v.c, v.f].some((x) => x == null)) { $('#cChk', sh).textContent = ''; return; }
        const est = 4 * v.p + 4 * v.c + 9 * v.f;
        if (v.kcal == null) $('#cK', sh).placeholder = fmtK(est);
        $('#cChk', sh).textContent = v.kcal != null && Math.abs(v.kcal - est) > Math.max(5, est * 0.25) ? `Ojo: con esos macros saldrían unas ${fmtK(est)} kcal. Revisa la etiqueta.` : '';
      };
      ['#cK', '#cP', '#cC', '#cF'].forEach((x) => $(x, sh).addEventListener('input', chk));
      $('#cSave', sh).addEventListener('click', () => {
        const v = vals();
        const name = $('#cN', sh).value.trim();
        const us = readUnits();
        if (!name) return toast('Pon un nombre');
        if ([v.p, v.c, v.f].some((x) => x == null)) return toast('Faltan proteína, carbohidratos o grasas');
        if (v.kcal == null) v.kcal = Math.round(4 * v.p + 4 * v.c + 9 * v.f);
        // por unidad → por 100 g (usando la primera unidad)
        const perUnit = $('#cPer button.on', sh)?.dataset.v === 'unit';
        if (perUnit) {
          if (!us.length) return toast('Añade la unidad y su peso');
          const k = 100 / us[0].g;
          for (const key of ['kcal', 'p', 'c', 'f']) v[key] = Math.round(v[key] * k * 10) / 10;
        }
        const id = isMine ? food.id : `mine:${Date.now().toString(36)}`;
        const saved = {
          id, name, brand: $('#cB', sh).value.trim() || undefined, stores: $('#cS', sh).value.trim() || undefined,
          qty: $('#cQ', sh).value.trim() || undefined, ean: $('#cE', sh).value.trim() || undefined,
          units: us.length ? us : undefined, per100: v, source: isMine ? food.source || 'manual' : isNew ? 'manual' : `copia:${food.id}`,
        };
        ctx.store.update(FILES.foods, (doc) => {
          doc = doc && typeof doc === 'object' ? doc : {};
          doc.custom ||= []; doc.recipes ||= []; doc.frequent ||= {};
          doc.custom = [...doc.custom.filter((x) => x.id !== id), JSON.parse(JSON.stringify(saved))];
          if (!isMine && food.id && doc.frequent[food.id]) doc.frequent[id] = doc.frequent[food.id]; // hereda la frecuencia
          return doc;
        }, `${isNew ? 'Alimento propio' : 'Edita alimento'}: ${name}`);
        toast('Alimento guardado');
        gramsSheet(ctx, date, slot, { ...saved, src: 'mine' }, { back: true });
      });
    },
  });
}

// ---------------------------------------------------------------- escáner
function scanSheet(ctx, date, slot) {
  const supported = scannerSupported();
  let scanner = null;
  openSheet(`<h3>Escanear código</h3>
    ${supported ? `<div style="position:relative;border-radius:16px;overflow:hidden;background:#000;aspect-ratio:4/3;margin:12px 0"><video id="scv" playsinline muted style="width:100%;height:100%;object-fit:cover"></video>
      <div style="position:absolute;left:12%;right:12%;top:40%;height:20%;border:2px solid rgba(255,255,255,.8);border-radius:12px"></div></div>
      <div class="muted small" id="scMsg">Apunta al código de barras del envase.</div>` : `<div class="muted" style="margin:10px 0">Este navegador no puede leer códigos con la cámara. Escribe los números del código de barras:</div>`}
    <div class="field" style="margin-top:12px"><label for="scE">Código (a mano)</label><input class="inp" id="scE" inputmode="numeric" placeholder="8480000…"></div>
    <button class="btn secondary" id="scGo" style="margin-top:8px">Buscar este código</button>`, {
    close: () => scanner?.stop(),
    bind: (sh) => {
      const handle = async (ean) => {
        const msg = $('#scMsg', sh);
        if (msg) msg.textContent = `Código ${ean}: buscando…`;
        await loadFoods().catch(() => {});
        let f = byEan(ean, ctx.store.get(FILES.foods));
        if (!f) { try { f = await lookupBarcodeOnline(ean); } catch { f = null; } }
        if (f) { scanner?.stop(); gramsSheet(ctx, date, slot, f, { back: true }); }
        else { scanner?.stop(); toast('No está en ninguna base: créalo con la etiqueta'); customFoodSheet(ctx, date, slot, { ean }); }
      };
      if (supported) {
        scanner = startScanner($('#scv', sh));
        scanner.promise.then(handle).catch((e) => { const m = $('#scMsg', sh); if (m && e.message !== 'cancelado') m.textContent = 'No se pudo abrir la cámara. Escribe el código a mano.'; });
      }
      $('#scGo', sh).addEventListener('click', () => { const e = $('#scE', sh).value.replace(/\D/g, ''); if (e.length >= 8) handle(e); else toast('Código no válido'); });
    },
  });
}
