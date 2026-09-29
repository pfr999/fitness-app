// Hoy → Comidas: registro de alimentos por gramos, totales por comida y día frente al objetivo,
// alimentos propios, escáner de código de barras y botón «Día completo».

import { $, $$, esc, fmt, fmtK, num, int, toast, openSheet, closeSheet, icon, bindSeg, ask } from '../ui/ui.js';
import { donut } from '../ui/charts.js';
import { addDays, fmtShort } from '../dates.js';
import { FILES, planFor, kcalTarget, sumItems } from '../model.js';
import { loadFoods, isLoaded, findFoods, frequentFoods, byEan, byId, lookupBarcodeOnline, searchOnline, macrosFor, packageGrams } from '../foods/db.js';
import { highlightTerms, norm } from '../foods/search.js';
import { scannerSupported, startScanner } from '../foods/scanner.js';

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
        : m.items.length ? `<div class="mc-sub"><span>P <b>${fmtK(s.p)}</b></span><span>C <b>${fmtK(s.c)}</b></span><span>G <b>${fmtK(s.f)}</b> g</span></div>` : ''}
      ${porChips}
      ${m.items.map((it, i) => { const x = macrosFor(it.per100, it.g); const q = it.unit ? `${fmt(it.unit.n, it.unit.n % 1 ? 1 : 0)} ${esc(unitLabel(it.unit.name, it.unit.n))} · ${fmtK(it.g)} g` : `${fmtK(it.g)} g`; return `<button class="fi" data-item="${esc(slot)}|${i}" style="width:100%;border-left:0;border-right:0;border-bottom:0;background:none;text-align:left"><div class="ft"><b>${esc(it.name)}${it.brand ? ` · ${esc(it.brand)}` : ''}</b><span>${q} · P ${fmtK(x.p)} · C ${fmtK(x.c)} · G ${fmtK(x.f)}</span></div><div class="fk num">${fmtK(x.kcal)}<small>kcal</small></div></button>`; }).join('')}
      <div class="mc-actions"><button class="btn primary sm" data-add="${esc(slot)}">${icon.plus} Añadir</button>${!m.items.length && y.items.length ? `<button class="btn secondary sm" data-copy="${esc(slot)}">Copiar de ayer</button>` : ''}</div>
    </div>`;
  }).join('');

  return `<div class="card">
      <div class="ch"><h2>Hoy llevas</h2><span class="badge ${day.trained === true ? 'g' : 'n'}">${label}</span></div>
      <div class="ring-wrap">
        ${donut({ pct: t.kcal ? all.kcal / t.kcal : 0, size: 104, stroke: 10, color: all.kcal > t.kcal * 1.1 ? 'var(--amber)' : 'var(--accent)', big: fmtK(all.kcal), sm: `de ${fmtK(t.kcal)}`, sm2: 'kcal' })}
        <div class="macros">${bar('Proteína', all.p, t.p, 'var(--blue)')}${bar('Carbohidratos', all.c, t.c, 'var(--slate)')}${bar('Grasas', all.f, t.f, 'var(--slate)')}</div>
      </div>
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

// ---------------------------------------------------------------- añadir: buscar
function resultRow(f, terms) {
  const hl = (s) => esc(s).split(' ').map((w) => (terms.some((t) => norm(w).startsWith(t)) ? `<mark>${w}</mark>` : w)).join(' ');
  const src = f.src === 'gen' ? 'Genérico' : f.src === 'mine' ? 'Mío' : 'Producto';
  return `<button class="res" data-pick="${esc(f.id)}"><div class="ft"><b>${hl(f.name)}</b><span>${[f.brand && hl(f.brand), f.stores && esc(f.stores), f.qty && esc(f.qty)].filter(Boolean).join(' · ')}${f.brand || f.stores || f.qty ? ' · ' : ''}${fmtK(f.per100.kcal)} kcal · P ${fmt(f.per100.p)} · C ${fmt(f.per100.c)} · G ${fmt(f.per100.f)} /100 g</span></div><span class="src ${f.src === 'mine' ? 'mine' : ''}">${src}</span></button>`;
}

function addSheet(ctx, date, slot) {
  let lastResults = [];
  let online = [];
  const foodsDoc = () => ctx.store.get(FILES.foods);
  openSheet(`<h3>Añadir a ${esc(slot)}</h3>
    <div class="srch"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input class="inp" id="fq" placeholder="p. ej. patata mercadona cocida bote" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" autofocus></div>
    <div class="chips-row"><button id="fScan">▦ Escanear código</button><button id="fNew">+ Crear alimento</button><button id="fOnline">Buscar en internet</button></div>
    <div id="fres"><div class="muted small" style="padding:10px 0">${isLoaded() ? '' : 'Cargando la base de alimentos (solo la primera vez)…'}</div></div>`, {
    bind: (sh) => {
      const input = $('#fq', sh);
      const paint = () => {
        const q = input.value;
        const terms = highlightTerms(q);
        let list, head = '';
        if (!q.trim()) { list = frequentFoods(foodsDoc()); head = list.length ? '<div class="grp" style="margin:4px 0 0">Frecuentes</div>' : '<div class="muted small" style="padding:10px 0">Escribe para buscar: genéricos, productos de supermercado y tus alimentos.</div>'; }
        else list = findFoods(q, foodsDoc());
        const onl = online.length ? `<div class="grp">En internet (Open Food Facts)</div>${online.map((f) => resultRow(f, terms)).join('')}` : '';
        lastResults = [...list, ...online];
        $('#fres', sh).innerHTML = head + list.map((f) => resultRow(f, terms)).join('') + onl +
          (q.trim() && !list.length && !online.length ? `<div class="muted small" style="padding:12px 0">Sin resultados. Prueba «Buscar en internet», escanea el código o créalo.</div>` : '');
        $$('[data-pick]', sh).forEach((b) => b.addEventListener('click', () => {
          const f = lastResults.find((x) => x.id === b.dataset.pick);
          if (f) gramsSheet(ctx, date, slot, f);
        }));
      };
      let t;
      input.addEventListener('input', () => { online = []; clearTimeout(t); t = setTimeout(paint, 120); });
      loadFoods().then(paint).catch(() => { $('#fres', sh).innerHTML = '<div class="err">No se pudo cargar la base de alimentos.</div>'; });
      $('#fNew', sh).addEventListener('click', () => customFoodSheet(ctx, date, slot, { name: input.value.trim() }));
      $('#fScan', sh).addEventListener('click', () => scanSheet(ctx, date, slot));
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

// ---------------------------------------------------------------- cantidad
function gramsSheet(ctx, date, slot, food, { initial = 100, initialUnit = null, onSave = null } = {}) {
  const units = unitsOf(food);
  // unidad por defecto: la del registro que se edita, o la primera propia del alimento (p. ej. pastilla)
  let unit = initialUnit ? units.find((u) => u.name === initialUnit.name) || { name: initialUnit.name, g: initialUnit.g } : (food.units?.[0] || null);
  let qty = initialUnit ? initialUnit.n : unit ? 1 : initial;
  const quick = unit ? [1, 2, 3, 4] : [50, 100, 150, 200];
  const unitBtns = `<div class="seg" id="uSeg" style="margin:10px 0 0">${[['g', 'gramos'], ...units.map((u) => [u.name, `${u.name} · ${fmt(u.g, u.g % 1 ? 1 : 0)} g`])].map(([k, l]) => `<button type="button" data-v="${esc(k)}" class="${(unit ? unit.name : 'g') === k ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
  openSheet(`<h3>${esc(food.name)}</h3><div class="muted">${[food.brand, food.stores || (food.src === 'gen' ? 'Genérico (CIQUAL)' : ''), food.qty].filter(Boolean).map(esc).join(' · ')} · ${fmtK(food.per100.kcal)} kcal/100 g</div>
    ${units.length ? unitBtns : ''}
    <div class="field" style="margin-top:12px"><label for="fg" id="fgL">Cantidad</label><div class="unit-wrap"><input class="inp" id="fg" inputmode="decimal" value="${fmt(qty, qty % 1 ? 1 : 0)}" autofocus><span class="u" id="fgU"></span></div></div>
    <div class="gpick" id="gpick"></div>
    <div class="mtot" id="mt"></div>
    <div class="sheet-actions"><button class="btn primary" id="fAdd">${onSave ? 'Guardar' : `Añadir a ${esc(slot)}`}</button></div>
    <button class="link" id="fEdit" type="button" style="width:100%;text-align:center;margin-top:6px">Editar datos o unidades de este alimento</button>`, {
    bind: (sh) => {
      const grams = () => (num($('#fg', sh).value) || 0) * (unit ? unit.g : 1);
      const paintQuick = () => {
        const q = unit ? [1, 2, 3, 4] : quick;
        $('#gpick', sh).innerHTML = q.map((v) => `<button type="button" data-g="${v}">${v}${unit ? '' : ' g'}</button>`).join('');
        $$('[data-g]', sh).forEach((b) => b.addEventListener('click', () => { $('#fg', sh).value = b.dataset.g; upd(); }));
        $('#fgU', sh).textContent = unit ? unitLabel(unit.name, num($('#fg', sh).value) || 0) : 'g';
        $('#fgL', sh).textContent = unit ? `Cantidad (${unitLabel(unit.name, 2)})` : 'Cantidad';
      };
      const upd = () => {
        const g = grams();
        const x = macrosFor(food.per100, g);
        $('#fgU', sh).textContent = unit ? unitLabel(unit.name, num($('#fg', sh).value) || 0) : 'g';
        $('#mt', sh).innerHTML = `<div><b class="num">${fmtK(x.kcal)}</b><span>kcal</span></div><div><b class="num">${fmt(x.p)}</b><span>prot. g</span></div><div><b class="num">${fmt(x.c)}</b><span>carb. g</span></div><div><b class="num">${fmt(x.f)}</b><span>grasa g</span></div>${unit ? `<div style="grid-column:1/-1;font-size:11.5px;color:var(--ink-3);font-weight:700">= ${fmt(g, g % 1 ? 1 : 0)} g</div>` : ''}`;
      };
      $$('#uSeg button', sh).forEach((b) => b.addEventListener('click', () => {
        const g = grams();
        $$('#uSeg button', sh).forEach((x) => x.classList.toggle('on', x === b));
        unit = b.dataset.v === 'g' ? null : units.find((u) => u.name === b.dataset.v);
        // convertir lo escrito a la nueva unidad
        const v = unit ? g / unit.g : g;
        $('#fg', sh).value = fmt(Math.round(v * 10) / 10, (Math.round(v * 10) / 10) % 1 ? 1 : 0);
        paintQuick(); upd();
      }));
      $('#fg', sh).addEventListener('input', upd);
      $('#fg', sh).addEventListener('focus', (e) => e.target.select());
      paintQuick(); upd();
      $('#fEdit', sh)?.addEventListener('click', () => foodEditor(ctx, date, slot, food));
      $('#fAdd', sh).addEventListener('click', () => {
        const n = num($('#fg', sh).value);
        const g = grams();
        if (!n || n <= 0 || g > 5000) return toast('Cantidad no válida');
        const u = unit ? { name: unit.name, g: unit.g, n } : null;
        if (onSave) onSave(g, u);
        else { addItem(ctx, date, slot, food, g, u); toast(`${food.name} · ${u ? `${fmt(n, n % 1 ? 1 : 0)} ${unitLabel(u.name, n)}` : `${fmtK(g)} g`}`); }
        closeSheet();
        ctx.render();
      });
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
      <button class="btn secondary" id="iG">${icon.edit} Cambiar cantidad</button>
      <div class="field"><label for="iMove">Mover a</label><select class="inp" id="iMove">${slots.map((s) => `<option ${s === slot ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <button class="btn secondary" id="iDel" style="color:var(--amber)">${icon.trash} Quitar</button>
    </div>`, {
    bind: (sh) => {
      $('#iG', sh).addEventListener('click', () => gramsSheet(ctx, date, slot, food, {
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
        gramsSheet(ctx, date, slot, { ...saved, src: 'mine' });
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
        if (f) { scanner?.stop(); gramsSheet(ctx, date, slot, f); }
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
