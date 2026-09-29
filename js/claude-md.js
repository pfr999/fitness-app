// Instrucciones para Claude (Claude Code o chat con el repo conectado) que la app mantiene en el repo de
// datos como CLAUDE.md. Así, al trabajar sobre el repo, Claude sabe qué es cada fichero y cómo cambiarlo
// sin romper nada. Cambia DATA_DOC_VERSION cuando cambie el modelo de datos.

export const DATA_DOC_VERSION = 6;

export const CLAUDE_MD = `# Recomp · repo de datos

<!-- Lo escribe la app Recomp (versión de instrucciones ${DATA_DOC_VERSION}). Si lo editas a mano, la app lo sobrescribirá. -->

Este repo es la **fuente de verdad** de la app Recomp (seguimiento personal de recomposición corporal).
La app (https://github.com/pfr999/fitness-app) lee y escribe estos ficheros. Tú, Claude, puedes ayudar
a analizar los datos y a **decidir y aplicar cambios del plan** (rutina, dieta, suplementos, objetivos),
siempre respetando estas reglas.

## Reglas
1. **Nunca borres ni reescribas datos registrados** (\`days/\`, \`fotos/\`, controles) salvo que el usuario lo
   pida explícitamente y confirme qué exactamente. Si pide «limpiar pruebas», enumera antes lo que vas a
   quitar y espera su «sí».
2. **Cambiar el plan = nueva versión** en \`plan.json\` (ver abajo). No modifiques versiones anteriores.
3. JSON válido siempre. Mantén el formato: \`plan.json\`, \`config.json\`, \`exercises.json\`, \`foods.json\` con
   2 espacios; \`days/AAAA-MM.json\` con **un día por línea**.
4. Fechas \`AAAA-MM-DD\` en hora de España. Unidades: kg, cm, mm, kcal, gramos.
5. **No edites \`resumen.md\`**: lo genera la app.
6. Mensajes de commit en español, cortos y descriptivos («Plan: rutina fase 1e (torso/pierna 4 días)»).
7. Antes de escribir, resume al usuario el cambio y pide confirmación. Después, recuérdale aprobar (merge)
   el cambio en GitHub y abrir la app.

## Ficheros
| Fichero | Contenido |
|---|---|
| \`config.json\` | perfil (\`profile\`), medidas del control (\`metrics\`), fórmulas, alertas, \`meal_slots\`, \`checkin_weekday\` (0 = domingo) |
| \`plan.json\` | \`{ "versions": [ … ] }\` versiones completas del plan |
| \`exercises.json\` | ejercicios propios \`{ "items": [ { "id": "mine:…", "name", "muscles": { "espalda": 1, "biceps": 0.5 } } ] }\` y preferencias por ejercicio \`"prefs": { "<id o n:nombre>": { "note": "Banco en la 3" } }\` |
| \`foods.json\` | alimentos propios (\`custom\`), frecuencia de uso, «Mis alimentos» (\`favorites\`: alimento + cantidad) y comidas guardadas (\`saved_meals\`) |
| \`days/AAAA-MM.json\` | un objeto por fecha con lo registrado ese día (ver abajo) |
| \`fotos/AAAA-MM-DD/*.jpg\` | fotos del control (frente, perfiles, espalda) |
| \`resumen.md\` | resumen legible (generado): **léelo primero para tener contexto rápido** |

## plan.json: cómo crear una versión
Copia la versión vigente (la de \`from\` más reciente ≤ hoy), aplica el cambio y añádela al final:
\`\`\`json
{ "v": <max v + 1>, "from": "<hoy AAAA-MM-DD>", "phase": "1e", "micro": "1/6",
  "reason": "<motivo corto>",
  "changes": [ { "at": "<fecha-hora ISO>", "reason": "<motivo corto>" } ],
  "targets": { "rate_pct_week": null, "steps": 10000, "sessions": 5, "sleep_h": 7.5, "waist_cm": 91, "weight_kg": 97 },
  "diet": { "kcal": { "train": 3150, "rest": 2850 }, "protein_g": 260, "carbs_g": 330, "fat_g": 85,
            "meals_mode": "fixed",
            "meals": [ { "slot": "Comida 1", "target": { "p": 50, "c": 80, "f": 20 } }, { "slot": "Intra-entreno", "portions": { "C": 1 } }, { "slot": "Comida 3" } ],
            "rules": [ "…" ] },
  "routine": { "days": [ { "name": "Día 1 · Pierna", "items": [
      { "name": "Sentadilla trasera", "ex": "sentadilla", "sets": 4, "reps": [6, 8], "rpe": 8, "note": "…" } ] } ] },
  "supplements": [ { "name": "Creatina", "dose": "5 g", "timing": "Con una comida", "kind": "supplement" } ] }
\`\`\`
- Si ya existe una versión con \`from\` = hoy, **modifica esa** (mismo \`v\`) y añade una entrada a su \`changes\`.
- \`rate_pct_week\`: \`null\` = automático según % graso; o \`[mín, máx]\` en % de peso por semana.
- \`kind\`: \`supplement\` o \`medication\`. Porciones: P proteína, C carbohidrato, G grasa, F fruta, L lácteo.
- Comidas: \`meals_mode\` \`fixed\` (lista \`meals\`, cada una con \`target\` en gramos, \`portions\` o nada) o \`free\`
  (\`meals\` vacío: se añaden cada día). **No repartas** el objetivo del día entre comidas salvo que lo pida.
- Comidas guardadas: \`{ "id": "m:…", "name": "Desayuno de siempre", "items": [ …mismo formato que en los días… ] }\`.
  Un registro con \`"quick": true\` es un «añadido rápido» (solo cifras, \`g\` = 100 y \`per100\` = los totales).
- En los días, un alimento puede llevar \`unit\` \`{ "name": "pastilla", "g": 5.5, "n": 4 }\` (\`g\` del registro = n × g).
- Ejercicios: \`name\` libre; la app los reconoce por nombre en su catálogo (~100 comunes: «Press banca con barra»,
  «Remo con mancuernas en banco inclinado», «Curl femoral sentado»…). Si inventas uno que no es habitual,
  añádelo a \`exercises.json\` con sus músculos (1 directo, 0.5 indirecto; claves: pecho, espalda, trapecio,
  delt_ant, delt_lat, delt_post, biceps, triceps, antebrazo, cuadriceps, isquios, gluteos, aductores, gemelos,
  abdomen, lumbar).

## days/AAAA-MM.json: qué hay en cada día
\`weight\`, \`steps\`, \`sleep_h\`, \`rhr\`, \`note\`, \`trained\` (true entreno / false descanso),
\`session\` \`{ "day": "Día 2", "sets": [ { "name", "ex", "i", "kg", "reps", "rpe", "warmup" } ], "swap": { "<ejercicio de la rutina>": "<el que se hizo hoy>" } }\`
(\`warmup: true\` = serie de calentamiento: no cuenta en volumen ni récords),
\`meals\` \`[ { "slot", "items": [ { "name", "brand", "g", "per100": { "kcal", "p", "c", "f" } } ] } ]\`,
\`diet\` \`{ "status": "logged|plan|over|under|unknown", "kcal_delta" }\` (validación del día),
\`supplements_taken\`, \`hidden_meals\` (comidas fijas del plan ocultas ese día), \`meal_order\` (orden de las comidas
ese día), y en el día del control semanal \`checkin\` (medidas, pliegues, fotos, valoraciones,
autorregulación por músculo, nota, decisión).

## Cómo interpreta la app los datos (para tus análisis)
- Tendencia de peso: filtro de Kalman (no la media simple). Ritmo en % de peso/semana.
- Gasto energético adaptativo (TDEE) con la ingesta de cada día: registrada si \`diet.status = logged\`,
  la del plan si \`plan\`, plan ± \`kcal_delta\` si \`over/under\`; \`unknown\` no cuenta.
- Volumen: series por músculo, directo 1 e indirecto ½. Franja útil 10–20 series/semana.
- Objetivo de ritmo automático según % graso: >20 % → 0,7–1,0 · 13–20 % → 0,4–0,7 · <13 % → 0,25–0,5 %/sem.
`;
