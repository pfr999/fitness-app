// Hoy → Comidas: registro de alimentos por gramos, totales por comida y día frente al objetivo,
// alimentos propios, escáner de código de barras y botón «Día completo».

import { $, $$, esc, fmt, fmtK, num, int, toast, openSheet, closeSheet, icon } from '../ui/ui.js';
import { ring } from '../ui/charts.js';
import { addDays, fmtShort } from '../dates.js';
import { FILES, planFor, kcalTarget, sumItems } from '../model.js';
import { loadFoods, isLoaded, findFoods, frequentFoods, byEan, lookupBarcodeOnline, searchOnline, macrosFor, packageGrams } from '../foods/db.js';
import { highlightTerms, norm } from '../foods/search.js';
import { scannerSupported, startScanner } from '../foods/scanner.js';

// ---------------------------------------------------------------- objetivos
function slotsFor(ctx, v) {
  const fromPlan = (v?.diet?.meals || []).map((m) => m.slot).filter(Boolean);
  return fromPlan.length ? fromPlan : ctx.store.get(FILES.config)?.meal_slots || ['Desayuno', 'Comida', 'Merienda', 'Cena'];
}

/** Parte del día que corresponde a cada comida: por porciones del plan, o a partes iguales. */
function shares(v, slots) {
  const meals = v?.diet?.meals || [];
  const w = slots.map((s) => {
    const m = meals.find((x) => x.slot === s);
    return m ? Object.values(m.portions || {}).reduce((a, b) => a + (+b || 0), 0) : 0;
  });
  const tot = w.reduce((a, b) => a + b, 0);
  return Object.fromEntries(slots.map((s, i) => [s, tot ? w[i] / tot : 1 / slots.length]));
}

function targets(v, trained) {
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
  const t = targets(v, day.trained);
  const slots = slotsFor(ctx, v);
  const sh = shares(v, slots);
  const all = sumItems((day.meals || []).flatMap((m) => m.items));
  const complete = day.meals_complete === true;
  const label = day.trained === true ? 'Día de entreno' : day.trained === false ? 'Día de descanso' : 'Entreno sin marcar';
  const bar = (l, val, tgt, col) => `<div class="mac"><div class="row"><b>${l}</b><span class="num"><b style="color:var(--ink)">${fmtK(val)}</b> / ${fmtK(tgt)} g${tgt - val > 0 ? ` · quedan ${fmtK(tgt - val)}` : ''}</span></div><div class="bar"><i style="width:${Math.min(100, (val / (tgt || 1)) * 100)}%;background:${col}"></i></div></div>`;

  const cards = slots.map((slot) => {
    const m = mealOf(day, slot);
    const s = sumItems(m.items);
    const k = sh[slot];
    const y = mealOf(ctx.store.day(addDays(date, -1)), slot);
    return `<div class="card mc">
      <div class="ch"><h2>${esc(slot)}</h2><span class="aux num">${fmtK(s.kcal)} / ${fmtK(t.kcal * k)} kcal</span></div>
      ${m.items.length ? `<div class="mc-sub"><span>P <b>${fmtK(s.p)}</b>/${fmtK(t.p * k)}</span><span>C <b>${fmtK(s.c)}</b>/${fmtK(t.c * k)}</span><span>G <b>${fmtK(s.f)}</b>/${fmtK(t.f * k)} g</span></div>` : ''}
      ${m.items.map((it, i) => { const x = macrosFor(it.per100, it.g); return `<button class="fi" data-item="${esc(slot)}|${i}" style="width:100%;border-left:0;border-right:0;border-bottom:0;background:none;text-align:left"><div class="ft"><b>${esc(it.name)}${it.brand ? ` · ${esc(it.brand)}` : ''}</b><span>${fmtK(it.g)} g · P ${fmtK(x.p)} · C ${fmtK(x.c)} · G ${fmtK(x.f)}</span></div><div class="fk num">${fmtK(x.kcal)}<small>kcal</small></div></button>`; }).join('')}
      <div class="mc-actions"><button class="btn primary sm" data-add="${esc(slot)}">${icon.plus} Añadir</button>${!m.items.length && y.items.length ? `<button class="btn secondary sm" data-copy="${esc(slot)}">Copiar de ayer</button>` : ''}</div>
    </div>`;
  }).join('');

  return `<div class="card">
      <div class="ch"><h2>Hoy llevas</h2><span class="badge ${day.trained === true ? 'g' : 'n'}">${label}</span></div>
      <div class="ring-wrap">
        ${ring({ value: all.kcal, max: t.kcal, label: fmtK(all.kcal), sub: `de ${fmtK(t.kcal)} kcal` })}
        <div class="macros">${bar('Proteína', all.p, t.p, 'var(--accent)')}${bar('Carbohidratos', all.c, t.c, 'var(--blue)')}${bar('Grasas', all.f, t.f, 'var(--amber)')}</div>
      </div>
      ${day.trained == null ? `<div class="hint">Marca en «Día» si entrenas hoy: cambia el objetivo (entreno ${fmtK(v.diet.kcal.train)} · descanso ${fmtK(v.diet.kcal.rest)}).</div>` : ''}
    </div>
    ${cards}
    <button class="btn ${complete ? 'secondary' : 'primary'}" id="dayComplete" style="margin-bottom:6px">${complete ? `${icon.check} Día completo · toca para desmarcar` : 'Marcar día completo ✓'}</button>
    <div class="hint" style="text-align:center;margin-bottom:12px">${complete ? 'Lo apuntado cuenta como todo lo que comiste hoy.' : 'Púlsalo cuando hayas apuntado todo lo de hoy. Si no, el día cuenta como «sin registrar» y se resuelve en el control semanal.'}</div>
    <div class="attr" style="text-align:center">Datos: CIQUAL (ANSES) · Open Food Facts (ODbL)</div>`;
}

export function bind(root, ctx) {
  const date = ctx.state.date;
  if (!isLoaded()) loadFoods().catch(() => {});
  $$('[data-add]', root).forEach((b) => b.addEventListener('click', () => addSheet(ctx, date, b.dataset.add)));
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
    ctx.store.updateDay(date, (d) => { if (cur) delete d.meals_complete; else d.meals_complete = true; }, `Comidas ${fmtShort(date)}: ${cur ? 'día abierto' : 'día completo'}`);
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

function addItem(ctx, date, slot, food, g) {
  const item = { food: food.id, name: food.name, ...(food.brand ? { brand: food.brand } : {}), g, per100: { ...food.per100 } };
  ctx.store.updateDay(date, (d) => { const m = mealOf(d, slot); setMeal(d, slot, [...m.items, item]); }, `${slot} ${fmtShort(date)}: +${food.name} ${fmtK(g)} g`);
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
function gramsSheet(ctx, date, slot, food, { initial = 100, onSave = null } = {}) {
  const pkg = packageGrams(food.qty);
  const quick = [50, 100, 150, 200];
  openSheet(`<h3>${esc(food.name)}</h3><div class="muted">${[food.brand, food.stores || (food.src === 'gen' ? 'Genérico (CIQUAL)' : ''), food.qty].filter(Boolean).map(esc).join(' · ')} · ${fmtK(food.per100.kcal)} kcal/100 g</div>
    <div class="field" style="margin-top:14px"><label for="fg">Cantidad</label><div class="unit-wrap"><input class="inp" id="fg" inputmode="decimal" value="${fmtK(initial)}" autofocus><span class="u">g</span></div></div>
    <div class="gpick">${quick.map((v) => `<button type="button" data-g="${v}">${v} g</button>`).join('')}</div>
    ${pkg ? `<button type="button" class="btn secondary sm" data-g="${pkg}" style="width:100%;margin:-4px 0 12px">1 envase · ${fmtK(pkg)} g</button>` : ''}
    <div class="mtot" id="mt"></div>
    <button class="btn primary" id="fAdd">${onSave ? 'Guardar' : `Añadir a ${esc(slot)}`}</button>`, {
    bind: (sh) => {
      const upd = () => {
        const x = macrosFor(food.per100, num($('#fg', sh).value) || 0);
        $('#mt', sh).innerHTML = `<div><b class="num">${fmtK(x.kcal)}</b><span>kcal</span></div><div><b class="num">${fmt(x.p)}</b><span>prot. g</span></div><div><b class="num">${fmt(x.c)}</b><span>carb. g</span></div><div><b class="num">${fmt(x.f)}</b><span>grasa g</span></div>`;
      };
      $('#fg', sh).addEventListener('input', upd);
      $$('[data-g]', sh).forEach((b) => b.addEventListener('click', () => { $('#fg', sh).value = b.dataset.g; upd(); }));
      upd();
      $('#fg', sh).addEventListener('focus', (e) => e.target.select());
      $('#fAdd', sh).addEventListener('click', () => {
        const g = num($('#fg', sh).value);
        if (!g || g <= 0 || g > 5000) return toast('Cantidad no válida');
        if (onSave) onSave(g);
        else { addItem(ctx, date, slot, food, g); toast(`${food.name} · ${fmtK(g)} g`); }
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
  const slots = slotsFor(ctx, planFor(ctx.store.get(FILES.plan), date));
  const food = { id: it.food, name: it.name, brand: it.brand, per100: it.per100 };
  openSheet(`<h3>${esc(it.name)}</h3><div class="muted">${esc(slot)} · ${fmtK(it.g)} g</div>
    <div class="stack" style="margin-top:14px">
      <button class="btn secondary" id="iG">${icon.edit} Cambiar cantidad</button>
      <div class="field"><label for="iMove">Mover a</label><select class="inp" id="iMove">${slots.map((s) => `<option ${s === slot ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <button class="btn secondary" id="iDel" style="color:var(--amber)">${icon.trash} Quitar</button>
    </div>`, {
    bind: (sh) => {
      $('#iG', sh).addEventListener('click', () => gramsSheet(ctx, date, slot, food, {
        initial: it.g,
        onSave: (g) => ctx.store.updateDay(date, (d) => { const m = mealOf(d, slot); m.items[i].g = g; setMeal(d, slot, m.items); }, `${slot} ${fmtShort(date)}: ${it.name} ${fmtK(g)} g`),
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
        ctx.store.updateDay(date, (d) => { const m = mealOf(d, slot); m.items.splice(i, 1); setMeal(d, slot, m.items); }, `${slot} ${fmtShort(date)}: −${it.name}`);
        toast('Quitado'); closeSheet(); ctx.render();
      });
    },
  });
}

// ---------------------------------------------------------------- alimento propio
function customFoodSheet(ctx, date, slot, pre = {}) {
  openSheet(`<h3>Crear alimento</h3><div class="muted">Copia la tabla de la etiqueta (valores por 100 g). Queda guardado para siempre.</div>
    <div class="stack" style="margin-top:12px">
      <div class="field"><label for="cN">Nombre</label><input class="inp" id="cN" value="${esc(pre.name || '')}" placeholder="p. ej. Patatas cocidas bote"></div>
      <div class="g2"><div class="field"><label for="cB">Marca</label><input class="inp" id="cB" value="${esc(pre.brand || '')}" placeholder="Hacendado"></div><div class="field"><label for="cS">Tienda</label><input class="inp" id="cS" value="${esc(pre.stores || '')}" placeholder="Mercadona"></div></div>
      <div class="g2"><div class="field"><label for="cK">Kcal</label><input class="inp" id="cK" inputmode="decimal"></div><div class="field"><label for="cP">Proteína g</label><input class="inp" id="cP" inputmode="decimal"></div></div>
      <div class="g2"><div class="field"><label for="cC">Carbohidratos g</label><input class="inp" id="cC" inputmode="decimal"></div><div class="field"><label for="cF">Grasas g</label><input class="inp" id="cF" inputmode="decimal"></div></div>
      <div class="g2"><div class="field"><label for="cQ">Envase (opcional)</label><input class="inp" id="cQ" value="${esc(pre.qty || '')}" placeholder="400 g"></div><div class="field"><label for="cE">Código de barras</label><input class="inp" id="cE" inputmode="numeric" value="${esc(pre.ean || '')}"></div></div>
      <div class="hint" id="cChk"></div>
      <button class="btn primary" id="cSave">Guardar y elegir cantidad</button>
    </div>`, {
    bind: (sh) => {
      const vals = () => ({ kcal: num($('#cK', sh).value), p: num($('#cP', sh).value), c: num($('#cC', sh).value), f: num($('#cF', sh).value) });
      const chk = () => {
        const v = vals();
        if ([v.p, v.c, v.f].some((x) => x == null)) { $('#cChk', sh).textContent = ''; return; }
        const est = 4 * v.p + 4 * v.c + 9 * v.f;
        if (v.kcal == null) { $('#cK', sh).placeholder = fmtK(est); }
        $('#cChk', sh).textContent = v.kcal != null && Math.abs(v.kcal - est) > Math.max(25, est * 0.25) ? `Ojo: con esos macros saldrían unas ${fmtK(est)} kcal. Revisa la etiqueta.` : '';
      };
      ['#cK', '#cP', '#cC', '#cF'].forEach((s) => $(s, sh).addEventListener('input', chk));
      $('#cSave', sh).addEventListener('click', () => {
        const v = vals();
        const name = $('#cN', sh).value.trim();
        if (!name) return toast('Pon un nombre');
        if ([v.p, v.c, v.f].some((x) => x == null)) return toast('Faltan proteína, carbohidratos o grasas');
        if (v.kcal == null) v.kcal = Math.round(4 * v.p + 4 * v.c + 9 * v.f);
        const food = { id: `mine:${Date.now().toString(36)}`, name, brand: $('#cB', sh).value.trim() || undefined, stores: $('#cS', sh).value.trim() || undefined, qty: $('#cQ', sh).value.trim() || undefined, ean: $('#cE', sh).value.trim() || undefined, per100: v, source: 'manual' };
        ctx.store.update(FILES.foods, (doc) => {
          doc = doc && typeof doc === 'object' ? doc : {};
          doc.custom ||= []; doc.recipes ||= []; doc.frequent ||= {};
          doc.custom.push(JSON.parse(JSON.stringify(food)));
          return doc;
        }, `Alimento propio: ${name}`);
        toast('Alimento guardado');
        gramsSheet(ctx, date, slot, { ...food, src: 'mine' });
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
