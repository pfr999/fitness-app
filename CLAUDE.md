# Recomp · app

App personal de seguimiento de recomposición corporal. PWA estática (HTML + JS con módulos ES,
**sin framework ni compilación**) publicada con GitHub Pages en `https://pfr999.github.io/fitness-app/`.
Los datos del usuario viven en otro repo **privado** (`fitness-data`), al que la app escribe con la API
de GitHub usando un token que solo está en el móvil. Este repo es público: **nunca** metas aquí datos
personales (medidas, salud, planes concretos, fotos).

## Antes de tocar nada
- Lee `docs/README.md` (índice), `docs/02-producto.md` (modelo de la app) y `docs/decisiones.md`
  (decisiones con su motivo: no deshagas una sin razón y, si cambias una, añade una nueva fila).
- Otra sesión de Claude (Claude Code en un portátil) también trabaja en este repo: parte siempre de
  `main` actualizado y haz cambios pequeños con commits descriptivos en español.

## Estructura
```
index.html · manifest.webmanifest · sw.js     PWA (sw.js: caché de la app y aviso de nueva versión)
css/app.css · fonts/ · icons/
js/app.js            arranque, navegación (historial del navegador), contexto `ctx`
js/model.js · js/dates.js   modelo de datos y fechas (hora local, 'AAAA-MM-DD')
js/engine/           motor de cálculo PURO (tendencia Kalman, TDEE, Hall, composición, entreno, balance semanal)
js/data/             GitHub API, backend local (modo demo), Store (caché IndexedDB, guardado agrupado)
js/foods/            buscador y base de alimentos · js/training/catalog.js  catálogo de ejercicios
js/screens/          pantallas: hoy (día/comidas/entreno), semana/control, progreso, plan, ajustes
js/summary.js        resumen.md para Claude · js/claude-md.js  CLAUDE.md que la app escribe en el repo de datos
js/plan-io.js        importar/exportar el plan en «formato Recomp»
foods/               base de alimentos estática (se regenera con tools/)
tests/               node --test (motor, datos, buscador, plan)
docs/                producto, arquitectura, modelo de datos, fórmulas, decisiones
```

## Probar
```sh
npm test                                   # tests sin dependencias (deben pasar todos)
python3 -m http.server 8080                # y abrir http://localhost:8080/#demo
```
`#demo` arranca el **modo demo** con datos simulados (solo en el navegador; no toca GitHub).
Pestañas en la URL (tras cargar):  `#hoy`, `#domingo` (Semana), `#progreso`, `#plan`.

## Reglas del código
- Sin dependencias ni pasos de compilación. Nada cargado de CDN (CSP estricta en `index.html`).
- **Escapa siempre** con `esc()` todo texto que venga de datos del usuario antes de meterlo en HTML.
- Guardar **no repinta**: `ctx.store.update/updateDay` es optimista y no redibuja; si la pantalla debe
  cambiar, llama a `ctx.render()` después (nunca mientras hay un campo con el foco).
- Navegación con `ctx.nav({...})` (deja entrada en el historial para el botón «atrás»).
- **Nunca** `confirm()`, `prompt()` ni `alert()` del navegador: usa `ask()` / `askText()` de `js/ui/ui.js`
  (diálogo propio; lo destructivo con `danger: true` y, si se puede, «Deshacer» con `toast(texto, { action })`).
- Lo derivado se calcula; en los datos solo se guarda lo medido.
- Cambios en el modelo de datos: actualiza `docs/03-modelo-datos.md` y, si afectan a cómo Claude debe
  tratar el repo de datos, `js/claude-md.js` **subiendo `DATA_DOC_VERSION`**.

## Publicar una versión
1. Sube `VERSION` en `sw.js` (y añade al array `ASSETS` los ficheros JS nuevos).
2. `npm test` en verde.
3. Commit y push a `main`. GitHub Pages publica en 1–2 minutos; la app del móvil muestra
   «Nueva versión disponible».
