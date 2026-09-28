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
  "objetivos": { "peso_kg": 97, "cintura_cm": 91, "pasos": 10000, "sesiones_semana": 5, "sueno_h": 7.5, "ritmo_pct_semana": null },
  "dieta": {
    "kcal_entreno": 3150, "kcal_descanso": 2850, "proteina_g": 260, "carbohidratos_g": 330, "grasas_g": 85,
    "comidas": [ { "nombre": "Desayuno", "porciones": { "P": 3, "C": 3, "G": 2 } } ],
    "reglas": [ "Comida libre opcional el domingo en la cena (máx. 1.200 kcal)" ]
  },
  "rutina": { "dias": [ { "nombre": "Día 1 · Pierna", "ejercicios": [
    { "nombre": "Sentadilla trasera", "series": 4, "reps": [6, 8], "rpe": 8, "nota": "barra alta" },
    { "nombre": "Remo en anillas", "series": 3, "reps": [8, 12], "rpe": 9, "musculos": { "espalda": 1, "biceps": 0.5 } }
  ] } ] },
  "suplementos": [ { "nombre": "Creatina", "dosis": "5 g", "momento": "Con una comida", "tipo": "suplemento" } ]
}
```
- `reps`: número o `[mín, máx]`. `rpe`: 1–10.
- `ritmo_pct_semana`: `null` = automático según % graso; o `[mín, máx]`.
- Porciones: `P` proteína, `C` carbohidrato, `G` grasa, `F` fruta, `L` lácteo.
- `musculos` (opcional, para ejercicios fuera del catálogo): `1` directo, `0.5` indirecto. Claves:
  pecho, espalda, trapecio, delt_ant, delt_lat, delt_post, biceps, triceps, antebrazo, cuadriceps,
  isquios, gluteos, aductores, gemelos, abdomen, lumbar.
- `tipo` de suplemento: `suplemento` o `medicacion`.

Código: `js/plan-io.js` (validación y conversión, con tests en `tests/plan-io.test.js`).
