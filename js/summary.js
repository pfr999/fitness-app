// Resumen en texto (Markdown) para Claude: se guarda como resumen.md y se copia desde la app.

import { addDays, fmtShort, range } from './dates.js';
import { FILES, planFor, currentPlan } from './model.js';
import { weekSummary } from './engine/analysis.js';

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
  lines.push(`## Últimos 7 días (${fmtShort(wk.from)}–${fmtShort(wk.to)})`);
  lines.push(`- Pesadas: ${wk.weighIns}/7 · pasos media ${k(wk.steps)}${wk.targets.steps ? ` (objetivo ${k(wk.targets.steps)})` : ''} · sueño ${f(wk.sleep)} h · sesiones ${wk.sessions}${wk.targets.sessions ? `/${wk.targets.sessions}` : ''}`);
  for (const al of a.alerts || []) lines.push(`- Aviso: ${al.title}. ${al.text}`);
  lines.push('');
  lines.push('## Últimos controles');
  const cks = (a.checkins || []).slice(-4).reverse();
  if (!cks.length) lines.push('- Ninguno todavía.');
  for (const c of cks) {
    const m = c.checkin.measures || {};
    const parts = [c.weight != null && `peso ${f(c.weight)}`, m.waist != null && `cintura ${f(m.waist)}`, m.abdomen != null && `abdomen ${f(m.abdomen)}`].filter(Boolean);
    lines.push(`- ${fmtShort(c.date)}: ${parts.join(' · ') || 'sin medidas'}${c.checkin.decision?.text ? ` · decisión: ${c.checkin.decision.text}` : ''}`);
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
