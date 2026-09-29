# Formato Recomp (importar / exportar el plan)

Para diseñar la rutina, la dieta o los objetivos con Claude (aquí o desde el móvil) y llevarlos a la
app **sin dar el token a nadie**: el plan viaja como texto y la app lo importa como nueva versión.

## Flujo
1. En la app: **Plan → Exportar / Claude → Copiar plan + instrucciones para Claude**.
2. Pégalo en la conversación con Claude y diseñad los cambios.
3. Pídele el resultado «en formato Recomp».
4. En la app: **Plan → Importar plan** → pegar → *Revisar cambios* → *Aplicar como nueva versión*.

La app acepta el bloque aunque venga dentro de ```json … ``` o con texto alrededor. Solo cambian las
secciones que vengan; el resto del plan se mantiene. Antes de aplicar enseña qué cambia y avisa si los
macros no cuadran con las kcal.

## Estructura
```json
{
  "formato": "recomp-plan",
  "fase": "1e", "micro": "1/6",
  "objetivos": { "objetivo": "perdida", "peso_kg": 97, "cintura_cm": 91, "pasos": 10000, "sesiones_semana": 5, "sueno_h": 7.5, "ritmo_pct_semana": null },
  "dieta": {
    "kcal_entreno": 3150, "kcal_descanso": 2850, "proteina_g": 260, "carbohidratos_g": 330, "grasas_g": 85,
    "comidas": [ { "nombre": "Desayuno", "porciones": { "P": 3, "C": 3, "G": 2 } } ],
    "reglas": [ "Comida libre opcional el domingo en la cena (máx. 1.200 kcal)" ]
  },
  "rutina": { "mesociclo": { "inicio": "2026-10-05", "semanas": 4, "rir": [3, 2, 2, 1], "descarga": true },
    "dias": [ { "nombre": "Día 1 · Pierna", "calentamiento": "3 min de respiración · movilidad de cadera", "ejercicios": [
    { "nombre": "Sentadilla trasera", "series": 4, "reps": [6, 8], "rpe": 8, "nota": "barra alta" },
    { "nombre": "Remo en anillas", "series": 3, "reps": [8, 12], "rpe": 9, "musculos": { "espalda": 1, "biceps": 0.5 } }
  ] } ] },
  "suplementos": [ { "nombre": "Creatina", "dosis": "5 g", "momento": "Con una comida", "tipo": "suplemento" } ]
}
```
- `reps`: número o `[mín, máx]`. `rpe`: 1–10.
- `objetivo`: `perdida`, `mantenimiento`, `volumen` o `sin_objetivo` (solo registro: sin franjas ni avisos).
- `ritmo_pct_semana`: `null` = automático según el objetivo; o `[mín, máx]` en % de peso por semana (en pérdida
  y volumen, en positivo en la dirección del objetivo; en mantenimiento, con signo: `[-0.2, 0.2]`).
- `kcal_entreno`, `kcal_descanso` y los macros pueden ser `null` (sin objetivo).
- Porciones: `P` proteína, `C` carbohidrato, `G` grasa, `F` fruta, `L` lácteo.
- `musculos` (opcional, para ejercicios fuera del catálogo): `1` directo, `0.5` indirecto. Claves:
  pecho, espalda, trapecio, delt_ant, delt_lat, delt_post, biceps, triceps, antebrazo, cuadriceps,
  isquios, gluteos, aductores, gemelos, abdomen, lumbar.
- `mesociclo` (opcional): `inicio` (un lunes), `semanas` de carga, `rir` (uno por semana; RIR 2 ≈ RPE 8) y
  `descarga` (semana final con la mitad de series y ~10 % menos de peso). Si no viene, se conserva el
  que hubiera; `null` lo quita.
- `calentamiento` (opcional, por día): texto libre que sale en Entreno como «Antes de empezar»; no es un ejercicio
  ni cuenta volumen.
- `tipo` de suplemento: `suplemento` o `medicacion`.

Código: `js/plan-io.js` (validación y conversión, con tests en `tests/plan-io.test.js`).
