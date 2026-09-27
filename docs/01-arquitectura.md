# 01 · Arquitectura

## Restricciones
- Cero servidores, cero infraestructura que mantener, coste 0 €.
- Uso diario 100 % desde el móvil; sin Excel como interfaz.
- Los datos son del usuario y están bajo su control.
- La app debe funcionar años sin mantenimiento. Claude Code solo se usa para **construirla**,
  no en el día a día.
- Un asistente de IA (cuenta personal de claude.ai) debe poder leer los datos para conversar.

## Solución

```
┌──────────────────── GITHUB (cuenta personal) ─────────────────────┐
│  recomp-app  (PÚBLICO)                recomp-data  (PRIVADO)      │
│  index.html · manifest · icons        config.json · plan.json     │
│  lib/ (gráficas incluidas en el repo) days/AAAA-MM.json ← SSOT    │
│  foods/ (base de alimentos estática)  foods.json (propios)        │
│  tools/build-foods (genera foods/)    resumen.md     ← para la IA │
│        │ GitHub Pages                 fotos/AAAA-MM-DD/*.jpg      │
└────────┼──────────────────────────────docs/*.pdf──────────────────┘
         ▼                                   ▲            ▲
   PWA instalada en el móvil ── API REST ────┘            │
   (token de grano fino, solo recomp-data)                │
                                         conector GitHub de claude.ai
```

| Pieza | Decisión |
|---|---|
| Frontend | HTML + JS plano (ES modules), **sin framework y sin compilación**. Nada que actualizar. |
| Gráficas | SVG propio o librería pequeña **incluida en el repo** (sin CDN en tiempo de ejecución). |
| Hosting | GitHub Pages desde el repo público `recomp-app` (solo contiene código). |
| Instalación | PWA: `manifest.json` + service worker mínimo (caché de la app). "Añadir a pantalla de inicio". |
| Datos | Varios JSON pequeños en `recomp-data` (`config`, `plan`, `days/AAAA-MM`…). Un guardado reescribe solo el fichero afectado (~50 KB). Un solo usuario; bloqueo optimista con `sha`. |
| Fotos | Ficheros JPG, redimensionados en el cliente (~1600 px) y **sin EXIF/GPS**. |
| Escritura | API de contenidos de GitHub (`PUT /repos/{owner}/{repo}/contents/{path}` con `sha`). Cada guardado = 1 commit → historial y copia de seguridad gratis. |
| Lectura | Al abrir se descargan config, plan y los últimos meses; se cachean en IndexedDB para arrancar al instante. Meses antiguos y fotos, bajo demanda. |
| Autenticación | Token personal de GitHub de grano fino, limitado a `recomp-data` con permiso *Contents: read/write*. Se pega una vez en el móvil. |
| Base de alimentos | Estática en `recomp-app/foods/`: genéricos CIQUAL 2025 (traducidos) + los **~25.000 productos más escaneados en España** en Open Food Facts (campo `unique_scans_n` del volcado masivo) con filtro de coherencia (4P+4C+9G ≈ kcal). Se descarga una vez y se cachea (IndexedDB) → búsqueda instantánea sin conexión. La cola larga se consulta **en línea** desde el móvil (API de OFF) y lo usado se guarda como alimento propio. Se regenera con `tools/build-foods` (opcional: GitHub Action mensual). |
| Código de barras | `BarcodeDetector` del navegador (Chrome Android). Busca en local → si no, API de Open Food Facts en línea → si no, alta manual. |
| Actualizaciones | El service worker cachea la app; al abrir comprueba `version.json` y muestra «Nueva versión» para recargar. |
| IA | `resumen.md` regenerado el domingo y al cambiar el plan (plan vigente + tendencias + últimas semanas en texto). claude.ai lo lee con el conector de GitHub dentro de un Proyecto. Plan B: botón "Copiar para Claude". |

## Por qué dos repos
- Un repo público con datos → descartado (privacidad).
- Un repo privado con Pages → exige GitHub Pro.
- Un repo privado + Cloudflare Pages → funciona, pero añade proveedor y mezcla código y datos.
- **Dos repos** → gratis, un proveedor, datos limpios para la IA, código actualizable sin tocar datos.

## Alternativas descartadas
| Opción | Motivo |
|---|---|
| Google Apps Script + Sheets + Drive | Iframe con banner, 1–3 s por llamada, no instalable como PWA, sin desarrollo local. Es la opción de respaldo si no se aceptan datos de salud en GitHub. |
| HTML estático + Google APIs | OAuth propio; token de 1 h con refresco silencioso poco fiable en móvil. |
| Cloudflare Workers + D1 + R2 | Excelente y gratis, pero es infraestructura. |
| App nativa Android | Innecesaria; una PWA cubre cámara, instalación y pantalla completa. |

## Seguridad
- El token vive en el almacenamiento del navegador del móvil. Si se pierde el móvil, se revoca en GitHub.
- Sin scripts de terceros cargados en tiempo de ejecución (reduce riesgo de XSS que robe el token).
- El token caduca: la app avisa unos días antes para renovarlo.
- Git conserva el historial: una foto borrada sigue en commits antiguos. Aceptable en repo privado; purgar exige reescribir historia.
- El repo público no contiene ningún dato ni configuración personal (la base de alimentos es pública por naturaleza).
- Licencias: CIQUAL (Licence Ouverte Etalab) y Open Food Facts (ODbL) → atribución visible en la app; la base derivada queda publicada en el repo público (compartir-igual).

## Límites conocidos
- La primera versión necesita conexión para guardar (se puede añadir una cola sin conexión más adelante).
- No está pensada para varios clientes: eso exigiría backend con autenticación. El modelo de datos
  por persona sí es portable si algún día se necesita.

## Entorno de desarrollo temporal (portátil de trabajo)
El desarrollo arranca en un portátil de empresa de forma provisional. Reglas:
- `fitness-data` **nunca se clona aquí**: los datos personales solo los escribe el móvil vía API.
- Push a `fitness-app` con una **deploy key** exclusiva del repo (`~/.ssh/id_ed25519_personal`,
  alias SSH `github-personal`), identidad de Git configurada solo en el repo y un hook `pre-push`
  que bloquea destinos o autores que no sean los personales.

**Checklist al devolver el portátil:**
1. `git status` limpio y `git push` hecho.
2. Borrar la deploy key en GitHub → `fitness-app` → Settings → Deploy keys.
3. Borrar `~/.ssh/id_ed25519_personal{,.pub}` y el bloque `Host github-personal` de `~/.ssh/config`.
4. Borrar la carpeta del proyecto.
