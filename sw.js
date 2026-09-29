// Service worker: cachea la app para abrir al instante y sin conexión.
// Al publicar una versión nueva, CAMBIA `VERSION`: la app mostrará «Nueva versión disponible».
const VERSION = 'v1.5.2';
const CACHE = `recomp-${VERSION}`;
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'fonts/manrope-latin.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/theme.js', 'js/boot.js', 'js/app.js', 'js/dates.js', 'js/model.js', 'js/demo.js', 'js/photos.js', 'js/summary.js', 'js/plan-io.js', 'js/claude-md.js',
  'js/engine/trend.js', 'js/engine/energy.js', 'js/engine/body.js', 'js/engine/targets.js', 'js/engine/analysis.js',
  'js/data/idb.js', 'js/data/github.js', 'js/data/local.js', 'js/data/store.js',
  'js/ui/ui.js', 'js/ui/charts.js', 'js/ui/rest.js', 'js/foods/search.js', 'js/foods/db.js', 'js/foods/history.js', 'js/foods/recipes.js', 'js/foods/scanner.js', 'js/training/catalog.js', 'js/engine/training.js', 'js/engine/week.js', 'js/engine/meso.js', 'js/screens/semana.js',
  'js/screens/setup.js', 'js/screens/hoy.js', 'js/screens/meals.js', 'js/screens/workout.js', 'js/screens/exercises.js', 'js/screens/control.js', 'js/screens/progreso.js', 'js/screens/plan.js', 'js/screens/settings.js',
];

self.addEventListener('install', (e) => {
  // Siempre del servidor y con ?v=VERSION: ni la caché del navegador ni la de GitHub Pages (hasta 10 min)
  // pueden colar un fichero de otra versión. Mezclar versiones rompe los módulos y la app no arranca.
  // El fetch busca con ignoreSearch, así que la copia se encuentra igual sin el ?v=.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(`${u}${u.includes('?') ? '&' : '?'}v=${VERSION}`, { cache: 'reload' })))));
});

// La base de alimentos (varios MB) no se precarga: se guarda la primera vez que se usa y se
// conserva entre versiones de la app. Al regenerarla (tools/), cambia esta fecha.
const FOODS = 'recomp-foods-2026-09-29';

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('recomp-') && k !== CACHE && k !== FOODS).map((k) => caches.delete(k))))
    // limpia el código que versiones anteriores metieron por error en la caché de alimentos
    .then(() => caches.open(FOODS)).then((c) => c.keys().then((reqs) => Promise.all(reqs.filter((r) => !/\/foods\/[^/]+\.json$/.test(new URL(r.url).pathname) || new URL(r.url).pathname.includes('/js/')).map((r) => c.delete(r)))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

// Solo se sirven desde caché los ficheros propios; la API de GitHub va siempre a la red.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Solo los datos (foods/*.json en la raíz de la app), NUNCA el código de js/foods/: si el código se
  // quedara en esta caché permanente, no se actualizaría nunca (fallo de v1.0–v1.5.1).
  if (/\/foods\/[^/]+\.json$/.test(url.pathname) && !url.pathname.includes('/js/')) {
    e.respondWith(caches.open(FOODS).then(async (c) => {
      const hit = await c.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
