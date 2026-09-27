// Piezas de interfaz compartidas del entreno: músculos de un ejercicio, alta de ejercicios propios,
// autocompletado y barras de volumen semanal.

import { $, $$, esc, fmt, toast, openSheet, closeSheet } from '../ui/ui.js';
import { FILES } from '../model.js';
import { MUSCLES, MUSCLE_LABEL } from '../training/catalog.js';
import { allExercises, resolveExercise } from '../engine/training.js';

export const exercisesOf = (ctx) => allExercises(ctx.store.get(FILES.exercises));

/** «Pectoral · Tríceps ½ · Deltoides anterior ½» */
export function musclesLine(ex) {
  return Object.entries(ex.muscles).sort((a, b) => b[1] - a[1]).map(([m, w]) => `${MUSCLE_LABEL[m] || m}${w < 1 ? ' ½' : ''}`).join(' · ');
}

/** <datalist> con todos los ejercicios, para el autocompletado nativo del móvil. */
export function datalist(ctx, id = 'exList') {
  return `<datalist id="${id}">${exercisesOf(ctx).map((e) => `<option value="${esc(e.name)}"></option>`).join('')}</datalist>`;
}

/**
 * Alta (o edición) de un ejercicio propio indicando qué músculos trabaja.
 * Cada músculo al tocarlo pasa: no → directo (1) → indirecto (½) → no.
 */
export function assignSheet(ctx, name, onDone) {
  const existing = (ctx.store.get(FILES.exercises)?.items || []).find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  const muscles = { ...(existing?.muscles || {}) };
  const chip = (k, l) => { const w = muscles[k]; return `<button type="button" data-m="${k}" class="${w ? 'on' : ''}" style="${w === 0.5 ? 'opacity:.7' : ''}">${l}${w === 0.5 ? ' ½' : ''}</button>`; };
  const paint = (sh) => { $('#mChips', sh).innerHTML = MUSCLES.map(([k, l]) => chip(k, l)).join(''); bindChips(sh); };
  const bindChips = (sh) => $$('#mChips button', sh).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.m, w = muscles[k];
    if (!w) muscles[k] = 1; else if (w === 1) muscles[k] = 0.5; else delete muscles[k];
    paint(sh);
  }));
  openSheet(`<h3>Músculos de este ejercicio</h3>
    <div class="muted">Toca una vez = trabaja <b>directo</b> (cuenta 1 serie). Dos veces = <b>indirecto</b> (½). Tres = quitar.</div>
    <div class="field" style="margin-top:12px"><label for="aName">Nombre</label><input class="inp" id="aName" value="${esc(name)}"></div>
    <div class="chipset" id="mChips" style="margin-top:12px"></div>
    <button class="btn primary" id="aSave" style="margin-top:14px">Guardar ejercicio</button>`, {
    bind: (sh) => {
      paint(sh);
      $('#aSave', sh).addEventListener('click', () => {
        const nm = $('#aName', sh).value.trim();
        if (!nm) return toast('Pon un nombre');
        if (!Object.values(muscles).includes(1)) return toast('Marca al menos un músculo directo');
        const item = { id: existing?.id || `mine:${Date.now().toString(36)}`, name: nm, muscles: { ...muscles } };
        ctx.store.update(FILES.exercises, (doc) => {
          doc = doc && typeof doc === 'object' ? doc : {};
          doc.items = [...(doc.items || []).filter((x) => x.id !== item.id), item];
          return doc;
        }, `Ejercicio propio: ${nm}`);
        toast('Ejercicio guardado');
        closeSheet();
        onDone?.(item);
      });
    },
  });
}

/** Barras de volumen semanal por músculo, con la franja útil de 10–20 series. */
export function volumeBars(byMuscle, { max = 25 } = {}) {
  const rows = MUSCLES.filter(([k]) => byMuscle[k]).map(([k, l]) => [l, byMuscle[k]]);
  if (!rows.length) return '<div class="muted small">Sin datos.</div>';
  return rows.map(([l, v]) => `<div class="vol"><span>${esc(l)}</span><div class="track"><div class="z" style="left:${(10 / max) * 100}%;width:${(10 / max) * 100}%"></div><i class="${v < 10 ? 'lo' : ''}" style="width:${(Math.min(v, max) / max) * 100}%"></i></div><b class="num">${fmt(v, v % 1 ? 1 : 0)}</b></div>`).join('');
}

export { resolveExercise };
