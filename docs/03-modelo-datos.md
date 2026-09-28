# 03 · Modelo de datos

Repo privado `recomp-data`. Fuente de verdad en varios ficheros JSON pequeños (un guardado solo
reescribe el fichero afectado). Formato legible por humanos y por una IA. Fechas `AAAA-MM-DD`
**en hora local**, unidades SI (kg, cm, mm, kcal).

```
recomp-data/
  config.json                # perfil, catálogo de métricas, fórmulas, alertas
  plan.json                  # versiones del plan (rutina, dieta, suplementos, objetivos)
  exercises.json             # catálogo de ejercicios
  foods.json                 # alimentos propios y recetas
  days/AAAA-MM.json          # un fichero por mes: todo lo registrado, solo lo medido
  events.json                # timeline (lesiones, analíticas, otros; los de plan se derivan)
  labs.json                  # marcadores y resultados de analíticas
  resumen.md                 # generado (domingo y cambios de plan); no se edita a mano
  fotos/AAAA-MM-DD/{front,side_r,side_l,back}.jpg
  docs/*.pdf
```

## config.json
```jsonc
{
  "version": 1,
  "profile": { "sex": "M", "height_cm": 0, "birth_year": 0, "notes": "" },
  "metrics": [                                  // qué se mide; añadir una no cambia el esquema
    { "id": "waist", "label": "Cintura", "unit": "cm", "group": "perimeter", "site": "navel" },
    { "id": "sf_supraspinale", "label": "Supraespinal", "unit": "mm", "group": "skinfold", "site": "supraspinale" },
    { "id": "bf_bia", "label": "% graso (reloj, BIA)", "unit": "%", "group": "device" }
  ],
  "formulas": { "trend": "kalman", "bodyfat": "faulkner", "rmr": "tinsley" },
  "alerts": [ { "id": "rate_high", "on": true, "weeks": 2 }, { "id": "steps_low", "on": true, "weeks": 2 } ],
  "meal_slots": ["Desayuno", "Comida", "Merienda", "Pre-entreno", "Intra-entreno", "Cena"]
}
```

## plan.json
```jsonc
{ "versions": [                                  // completas; vigente = última con from <= fecha
  { "v": 3, "from": "AAAA-MM-DD", "phase": "A", "micro": "1/4", "reason": "texto",
    "targets": {
      "rate_pct_week": null,                     // null = automático según % graso (ver 04 §4)
      "protein_g_per_kg_ffm": [2.3, 3.1], "steps": 10000, "sessions": 5, "sleep_h": 7.5,
      "waist_cm": 91
    },
    "diet": {
      "kcal": { "train": 3150, "rest": 2850 }, "protein_g": 260, "carbs_g": 330, "fat_g": 85,
      "meals": [ { "slot": "Desayuno", "share": 0.22, "portions": { "P": 3, "C": 3, "G": 2 } } ],
      "rules": ["texto libre"]                   // share: parte del día; si falta, se deriva de las porciones
    },
    "routine": { "days": [ { "name": "Día 1", "items": [
      { "name": "Peso muerto rumano", "sets": 4, "reps": [7, 9], "rpe": 9, "note": "" } ] } ] },
      // MVP: el ejercicio se identifica por nombre; en la fase 3 se enlaza al catálogo (exercises.json)
    "supplements": [ { "name": "", "dose": "", "timing": "", "kind": "supplement|medication" } ]
  } ] }
```

## exercises.json (ejercicios propios)
```jsonc
{ "items": [ { "id": "mine:k3x9", "name": "Remo invertido", "muscles": { "espalda": 1, "biceps": 0.5 } } ] }
```
El catálogo base (~100 ejercicios con alias y músculos: 1 = directo, 0,5 = indirecto) está en el
código (`js/training/catalog.js`); aquí solo van los que crea el usuario. Un ejercicio de la rutina o
de una serie se reconoce por `ex` (id) o, si no lo tiene, por su nombre o alias.

## days/AAAA-MM.json
```jsonc
{ "AAAA-MM-DD": {
    "weight": 99.4, "steps": 9820, "sleep_h": 7.4, "rhr": 58,
    "wellness": { "energy": 4, "fatigue": 2 },          // 1–5, opcionales
    "meals": [ { "slot": "Desayuno", "items": [
        { "food": "off:8480000038524", "name": "Patata cocida en conserva", "brand": "Hacendado",
          "g": 120, "per100": { "kcal": 68, "p": 1.8, "c": 14.2, "f": 0.1 } } ] } ],
    "trained": true,                                    // true entreno · false descanso · ausente = sin marcar
    "meals_complete": null,                             // «día cerrado» desde Comidas (= diet logged)
    "diet": { "status": "logged|plan|over|under|unknown", "kcal_delta": 700 },  // validación del día (Hoy o revisión semanal)
    "supplements_taken": ["Creatina", "Vitamina D3"],
    "session": { "day": "Día 3", "sets": [
        { "ex": "peso_muerto_rumano", "name": "Peso muerto rumano", "i": 0, "kg": 100, "reps": 8, "rpe": 9 } ] },  // i = nº de serie
    "checkin": {                                        // solo el día de control
      "measures": { "waist": 93.8 }, "skinfolds": { "sf_supraspinale": 10.4 },
      "photos": ["front", "side_r", "side_l", "back"],
      "ratings": { "diet": 3, "training": 4, "sleep": 2, "stress": 1 },
      "adherence": { "status": "plan|over|under|unknown", "kcal_week": 1400 },  // días SIN registro de los 7 revisados (ver 04 §2)
      "autoreg": { "isquios": { "soreness": 2, "performance": 2 } },   // 1–4; 2/2 = normal
      "note": "", "decision": { "type": "keep|adjust|phase", "text": "" }
    },
    "note": ""
} }
```
- `per100` es una **copia** de los valores del alimento en el momento de registrarlo: el histórico
  no cambia aunque la base se actualice.
- Un día sin `meals` o con `meals_complete: null` **se asume según el plan** (no se cuenta lo
  registrado como ingesta total). En el control, `adherence` dice cómo fueron esos días sin registro.

## foods.json (alimentos propios)
```jsonc
{ "custom": [ { "id": "mine:1", "name": "", "brand": "", "store": "", "per100": { "kcal": 0, "p": 0, "c": 0, "f": 0 },
                "source": "manual|off", "ean": "" } ],
  "recipes": [ { "id": "rec:1", "name": "Mi desayuno", "items": [ { "food": "mine:1", "g": 120 } ] } ],
  "frequent": { "off:8480000038524": 9 } }         // contador de uso para ordenar el buscador
```

## events.json · labs.json
```jsonc
{ "events": [ { "date": "", "end": null, "kind": "supplement|medication|lab|injury|other", "title": "", "detail": "" } ] }
{ "markers": [ { "id": "ldl", "label": "LDL", "unit": "mg/dL", "ref": [0, 130], "target": [0, 100] } ],
  "results": [ { "date": "", "values": { "ldl": 128 }, "pdf": "docs/2026-09-15-analitica.pdf" } ] }
```

## Base de alimentos (repo público de la app, estática)
```
fitness-app/foods/
  generic.json    # CIQUAL 2025 traducido: [[id, nombre, alias|alias, kcal, p, c, g], …]  (3.286 · 230 KB)
  products.json   # Open Food Facts, vendidos en España: [[ean, nombre, marca, tiendas, envase, kcal, p, c, g, escaneos], …]
                  # (45.000 · 3,8 MB, ~1,1 MB comprimido)
  meta.json       # fecha de generación, recuentos y licencias
```
Los sinónimos (tienda ↔ marca blanca, formatos, preparaciones) están en `js/foods/search.js`.
Se regenera con `tools/` (ver `tools/README.md`).
Se descarga una vez y se guarda en IndexedDB. Lo que no está aquí se consulta en línea (API de
Open Food Facts) y, si se usa, pasa a `foods.json` como alimento propio.

## Decisiones de modelo
- **Día como documento**; el control semanal es un día con `checkin`.
- **Ficheros por mes** para los días: un guardado sube ~50 KB, no todo el histórico.
- **Planes como versiones completas**: "qué plan tenía el día X" = buscar por fecha. Los eventos de
  tipo plan se derivan de las versiones; no se duplican en `events.json`.
- **Métricas y comidas por catálogo** (`config.metrics`, `config.meal_slots`).
- **Solo lo medido**; todo lo derivado se calcula al abrir (ver 04).
- **Escritura**: API de contenidos de GitHub con `sha` (bloqueo optimista). Si otro dispositivo
  escribió antes, se recarga el fichero y se reaplica el cambio.
