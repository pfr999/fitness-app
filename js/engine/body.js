// Composición corporal. Ver docs/04-motor-calculo.md §5.

export const MDC = { waist: 2.5, sumSkinfolds: 8 }; // cambio mínimo detectable (cm, mm)

/** Faulkner (4 pliegues: tríceps, subescapular, supraespinal/suprailíaco, abdominal). */
export function faulkner({ triceps, subscapular, supraspinale, abdominal }) {
  if ([triceps, subscapular, supraspinale, abdominal].some((v) => v == null)) return null;
  return 0.153 * (triceps + subscapular + supraspinale + abdominal) + 5.783;
}

/** US Navy (hombres, cm). */
export function navyMale({ waist, neck, height }) {
  if (!waist || !neck || !height || waist <= neck) return null;
  return 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(height)) - 450;
}

/** US Navy (mujeres, cm). */
export function navyFemale({ waist, neck, hip, height }) {
  if (!waist || !neck || !hip || !height) return null;
  return 495 / (1.29579 - 0.35004 * Math.log10(waist + hip - neck) + 0.221 * Math.log10(height)) - 450;
}

/** Relative Fat Mass (Woolcott 2018). */
export function rfm({ height, waist, male = true }) {
  if (!height || !waist) return null;
  return (male ? 64 : 76) - 20 * (height / waist);
}

export function whtr({ waist, height }) {
  return waist && height ? waist / height : null;
}

export function whtrCategory(r) {
  if (r == null) return null;
  if (r < 0.5) return 'sano';
  if (r < 0.6) return 'elevado';
  return 'alto';
}

export function ffm(weight, bfPct) {
  return weight != null && bfPct != null ? weight * (1 - bfPct / 100) : null;
}

export function ffmi(ffmKg, heightCm) {
  if (ffmKg == null || !heightCm) return null;
  const h = heightCm / 100;
  const v = ffmKg / (h * h);
  return { ffmi: v, normalized: v + 6.1 * (1.8 - h) };
}

export function sumSkinfolds(sf) {
  const vals = Object.values(sf || {}).filter((v) => typeof v === 'number');
  return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
}

/** Media móvil de los últimos n valores (para tendencias de medidas). */
export function rollingMean(values, n = 3) {
  return values.map((_, i) => {
    const w = values.slice(Math.max(0, i - n + 1), i + 1).filter((v) => v != null);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : null;
  });
}

/** ¿El cambio supera el margen de error de la medida? */
export function isRealChange(delta, mdc) {
  return delta != null && Math.abs(delta) >= mdc;
}
