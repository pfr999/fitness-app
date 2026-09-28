// Resumen en texto (Markdown) para Claude: se guarda como resumen.md y se copia desde la app.

import { addDays, fmtShort, range, lastWeekday, nextWeekday, daysBetween } from './dates.js';
import { FILES, planFor, currentPlan } from './model.js';
import { weekSummary, adherenceMap } from './engine/analysis.js';
import { weekBalance } from './engine/week.js';
import { allExercises, loggedVolume, exerciseHistory, strengthTrend, resolveExercise } from './engine/training.js';
import { MUSCLE_LABEL } from './training/catalog.js';

const f = (n, d = 1) => (n == null || Number.isNaN(n) ? '—' : n.toFixed(d).replace('.', ','));
const k = (n) => (n == null ? '—' : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));

export function buildSummary(ctx) {
  const today = ctx.today();
  const { config, plan, days } = ctx.data();
  const a = ctx.analysis();
  const L = a.latest || {};
  const v = currentPlan(plan);
  const wk = weekSummary({ days, plan }, today);
  const lines = [];
  lines.push(`# Resumen · ${fmtShort(today)}`);
  lines.push('');
  lines.push(`Generado por la app. Plan v${v?.v ?? '—'}${v?.phase ? ` · fase ${v.phase}` : ''}${v?.micro ? ` · micro ${v.micro}` : ''}.`);
  if (config.profile?.height_cm) lines.push(`Perfil: ${config.profile.sex === 'F' ? 'mujer' : 'hombre'}, ${config.profile.height_cm} cm${config.profile.birth_year ? `, nacido en ${config.profile.birth_year}` : ''}.`);
  lines.push('');
  lines.push('## Tendencias (motor de cálculo)');
  if (a.empty) lines.push('- Aún no hay pesadas registradas.');
  else {
    lines.push(`- Peso tendencia (Kalman): ${f(L.trend?.level)} kg · ritmo ${f(L.rate?.kgWeek, 2)} kg/sem (${f(L.rate?.pctWeek, 2)} %/sem) · objetivo de pérdida ${f(L.rateTarget?.[0])}–${f(L.rateTarget?.[1])} %/sem${L.rateReliable ? '' : ' · (menos de 14 días de datos)'}`);
    lines.push(`- Gasto energético adaptativo: ${L.tdeeReliable ? `${k(L.tdee.E)} ± ${k(L.tdee.sd)} kcal` : 'aún sin datos suficientes (21 días)'}${L.tdeeAssumedShare > 0.5 ? ' · estimado sobre todo con las kcal del plan (sin registro de comidas)' : ''}`);
    const b = a.body;
    if (b.waist != null) lines.push(`- Cintura: ${f(b.waist)} cm · cintura/altura ${f(b.whtr, 2)}`);
    if (b.sum != null) lines.push(`- Suma de pliegues: ${f(b.sum)} mm`);
    if (b.bfLow != null) lines.push(`- % graso estimado: ${f(b.bfLow)}–${f(b.bfHigh)} %${b.ffm ? ` · masa magra ≈ ${f(b.ffm)} kg` : ''}`);
    if (L.projection?.days && L.goal) lines.push(`- Previsión (modelo de Hall, kcal del plan): ${f(L.goal)} kg hacia ${fmtShort(addDays(today, Math.round(L.projection.days)))}`);
  }
  lines.push('');
  // semana que se revisa en el control (termina en el día de control más cercano)
  const wd = config.checkin_weekday ?? 0;
  const lastW = lastWeekday(today, wd);
  const W = daysBetween(lastW, today) <= 3 ? lastW : nextWeekday(today, wd);
  const checkins = Object.keys(days).filter((d) => days[d]?.checkin).map((d) => ({ date: d, checkin: days[d].checkin }));
  const B = weekBalance({ plan, days }, addDays(W, -6), W, { analysis: a.empty ? null : a, adherence: adherenceMap(checkins, days), exercises: allExercises(ctx.store.get('exercises.json')), until: today });
  lines.push(`## Balance de la semana (${fmtShort(addDays(W, -6))}–${fmtShort(W)}${W > today ? ', en curso' : ''})`);
  const E = B.energy;
  lines.push(`- Kcal media/día: ${k(E.kcalMean)} (objetivo ${k(E.targetMean)}) · ${E.logged} días registrados, ${E.estimated} estimados${E.unknown ? `, ${E.unknown} sin dato` : ''}${E.pending ? `, ${E.pending} sin validar (se asume el plan)` : ''}${E.deficit != null ? ` · déficit medio ≈ ${k(E.deficit)} kcal` : ''}`);
  if (B.macros) lines.push(`- Macros (media de ${B.macros.days} días registrados): P ${k(B.macros.p)}/${k(B.macros.target.p)} g · C ${k(B.macros.c)}/${k(B.macros.target.c)} g · G ${k(B.macros.f)}/${k(B.macros.target.f)} g`);
  lines.push(`- Pasos media ${k(B.steps.mean)}${B.steps.target ? `/${k(B.steps.target)}` : ''} · sesiones ${B.training.sessions}${B.training.target ? `/${B.training.target}` : ''} (${B.training.sets} series) · sueño ${f(B.sleep.mean)} h · pesadas ${B.weight.weighIns}/7`);
  if (B.weight.change != null) lines.push(`- Peso (tendencia): ${f(B.weight.start)} → ${f(B.weight.end)} kg (${B.weight.change > 0 ? '+' : ''}${f(B.weight.change, 2)} kg · ${f(B.weight.pctWeek, 2)} %/sem)`);
  const diets = B.rows.filter((r) => r.diet && r.diet.status !== 'logged' && r.diet.status !== 'plan').map((r) => `${fmtShort(r.date)} ${({ over: 'me pasé', under: 'me quedé corto', unknown: 'no lo sé' })[r.diet.status]}${r.diet.kcal_delta != null ? ` (${r.diet.kcal_delta > 0 ? '+' : ''}${k(r.diet.kcal_delta)})` : ''}`);
  if (diets.length) lines.push(`- Días fuera del plan: ${diets.join(', ')}`);
  for (const al of a.alerts || []) lines.push(`- Aviso: ${al.title}. ${al.text}`);
  const exs = allExercises(ctx.store.get('exercises.json'));
  const lv = loggedVolume(days, addDays(W, -6), W < today ? W : today, exs);
  if (Object.keys(lv.byMuscle).length) lines.push(`- Volumen (series fraccionales): ${Object.entries(lv.byMuscle).sort((x, y) => y[1] - x[1]).map(([m, v]) => `${MUSCLE_LABEL[m] || m} ${f(v, v % 1 ? 1 : 0)}`).join(', ')}`);
  const ids = new Set();
  for (const d of Object.keys(days)) for (const s of days[d]?.session?.sets || []) { const e = resolveExercise(s, exs); if (e) ids.add(e.id); }
  const trends = [...ids].map((id) => { const h = exerciseHistory(days, id, exs).filter((x) => x.best); const t = strengthTrend(h); return { name: exs.find((e) => e.id === id)?.name, t, last: h[h.length - 1]?.best }; }).filter((x) => x.t.status !== 'pocos');
  if (trends.length) lines.push(`- Fuerza (e1RM, 3 últimas sesiones vs 3 anteriores): ${trends.map((x) => `${x.name} ${x.t.status}${x.last ? ` (${f(x.last.e1rm, 0)} kg)` : ''}`).join(', ')}`);
  lines.push('');
  lines.push('## Últimos controles');
  const cks = (a.checkins || []).slice(-4).reverse();
  if (!cks.length) lines.push('- Ninguno todavía.');
  for (const c of cks) {
    const m = c.checkin.measures || {};
    const parts = [c.weight != null && `peso ${f(c.weight)}`, m.waist != null && `cintura ${f(m.waist)}`, m.abdomen != null && `abdomen ${f(m.abdomen)}`].filter(Boolean);
    lines.push(`- ${fmtShort(c.date)}: ${parts.join(' · ') || 'sin medidas'}${c.checkin.decision?.text ? ` · decisión: ${c.checkin.decision.text}` : ''}`);
    const ad = c.checkin.adherence;
    if (ad && ad.status !== 'plan') lines.push(`  - Dieta en días sin registrar: ${{ over: 'me pasé', under: 'me quedé corto', unknown: 'no lo sé' }[ad.status]}${ad.kcal_week != null ? ` (${ad.kcal_week > 0 ? '+' : ''}${k(ad.kcal_week)} kcal en la semana)` : ''}`);
    if (c.checkin.autoreg) {
      const off = Object.entries(c.checkin.autoreg).filter(([, a]) => a.soreness !== 2 || a.performance !== 2);
      if (off.length) lines.push(`  - Autorregulación (agujetas/rendimiento 1–4, normal 2/2): ${off.map(([m, a]) => `${MUSCLE_LABEL[m] || m} ${a.soreness}/${a.performance}`).join(', ')}`);
    }
    if (c.checkin.note) lines.push(`  - Nota: ${c.checkin.note.replace(/\n+/g, ' ')}`);
  }
  lines.push('');
  lines.push('## Plan actual');
  if (v) {
    const d = v.diet;
    lines.push(`- Dieta: ${k(d.kcal.train)} kcal entreno / ${k(d.kcal.rest)} descanso · P ${k(d.protein_g)} · C ${k(d.carbs_g)} · G ${k(d.fat_g)} g`);
    const t = v.targets || {};
    lines.push(`- Objetivos: pasos ${k(t.steps)} · sesiones ${t.sessions ?? '—'} · sueño ${f(t.sleep_h)} h${t.weight_kg ? ` · peso ${f(t.weight_kg)} kg` : ''}${t.waist_cm ? ` · cintura ${f(t.waist_cm)} cm` : ''}`);
    if (v.routine?.days?.length) lines.push(`- Rutina: ${v.routine.days.map((x) => `${x.name} (${x.items.length} ejercicios)`).join(', ')}`);
    if (v.supplements?.length) lines.push(`- Suplementos/medicación: ${v.supplements.map((s) => `${s.name}${s.dose ? ` ${s.dose}` : ''}`).join(', ')}`);
  }
  const changes = [...(plan.versions || [])].sort((x, y) => (x.from < y.from ? 1 : -1)).slice(0, 4);
  if (changes.length > 1) {
    lines.push('');
    lines.push('## Cambios de plan recientes');
    for (const c of changes) lines.push(`- ${fmtShort(c.from)} · v${c.v}: ${c.reason || '—'}`);
  }
  // Notas diarias de la última semana
  const notes = range(addDays(today, -6), today).filter((d) => days[d]?.note).map((d) => `- ${fmtShort(d)}: ${days[d].note.replace(/\n+/g, ' ')}`);
  if (notes.length) { lines.push(''); lines.push('## Notas de la semana'); lines.push(...notes); }
  lines.push('');
  return lines.join('\n');
}

export async function writeSummary(ctx) {
  try {
    await ctx.store.flush();
    await ctx.store.putText(FILES.summary, buildSummary(ctx), `Resumen ${fmtShort(ctx.today())}`);
  } catch { /* no bloquea: se reintenta en el siguiente control o cambio de plan */ }
}

export { planFor };
