# Recomp

App personal de seguimiento de recomposición corporal. Una PWA estática (HTML + JS, sin
compilación) que guarda los datos en un repo **privado** de GitHub a través de su API.

- Documentación de producto, arquitectura, modelo de datos y fórmulas: [`docs/`](docs/README.md)
- El prototipo de diseño (`docs/mock.html`) no se versiona: contiene datos personales.

## Estructura

```
index.html · manifest.webmanifest · sw.js   PWA
css/ · fonts/ · icons/                      estilos, fuente Manrope (OFL), iconos
js/engine/     motor de cálculo (funciones puras): tendencia Kalman, TDEE, Hall, composición
js/data/       GitHub API, backend local (demo), caché IndexedDB y guardado agrupado
js/screens/    pantallas: hoy, control, progreso, plan, ajustes, configuración
tests/         tests del motor y de la capa de datos (node --test)
docs/          producto y decisiones
```

## Desarrollo

```sh
npm test                      # 22 tests, sin dependencias
python3 -m http.server 8080   # y abre http://localhost:8080/#demo
```

`#demo` arranca el modo demo con datos simulados (se guardan solo en el navegador).

## Publicar (GitHub Pages)

1. `git push` a `fitness-app` (rama `main`).
2. En GitHub → `fitness-app` → Settings → Pages → Source: **Deploy from a branch** → `main` / `(root)`.
3. La app queda en `https://pfr999.github.io/fitness-app/`.
4. **Cada versión nueva:** sube `VERSION` en `sw.js`; la app mostrará «Nueva versión disponible».

## Primer uso en el móvil

1. Crea el token: GitHub → Settings → Developer settings → Personal access tokens →
   **Fine-grained** → Only select repositories: `fitness-data` → Repository permissions:
   **Contents: Read and write** → caducidad máxima.
2. Abre la URL en Chrome (Android), pega usuario, repo y token → **Conectar**. Si el repo de
   datos está vacío, la app crea la estructura inicial.
3. Menú de Chrome → **Añadir a pantalla de inicio**.

El token se guarda solo en ese dispositivo. Si lo pierdes: revócalo en GitHub y crea otro.
