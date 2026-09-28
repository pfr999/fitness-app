// Service worker: cachea la app para abrir al instante y sin conexión.
// Al publicar una versión nueva, CAMBIA `VERSION`: la app mostrará «Nueva versión disponible».
const VERSION = 'v0.7.3';
const CACHE = `recomp-${VERSION}`;
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'fonts/manrope-latin.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'js/theme.js', 'js/app.js', 'js/dates.js', 'js/model.js', 'js/demo.js', 'js/photos.js', 'js/summary.js',
  'js/engine/trend.js', 'js/engine/energy.js', 'js/engine/body.js', 'js/engine/targets.js', 'js/engine/analysis.js',
  'js/data/idb.js', 'js/data/github.js', 'js/data/local.js', 'js/data/store.js',
  'js/ui/ui.js', 'js/ui/charts.js', 'js/foods/search.js', 'js/foods/db.js', 'js/foods/scanner.js', 'js/training/catalog.js', 'js/engine/training.js', 'js/engine/week.js', 'js/screens/semana.js',
  'js/screens/setup.js', 'js/screens/hoy.js', 'js/screens/meals.js', 'js/screens/workout.js', 'js/screens/exercises.js', 'js/screens/control.js', 'js/screens/progreso.js', 'js/screens/plan.js', 'js/screens/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

// La base de alimentos (varios MB) no se precarga: se guarda la primera vez que se usa y se
// conserva entre versiones de la app. Al regenerarla (tools/), cambia esta fecha.
const FOODS = 'recomp-foods-2026-09-27';

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('recomp-') && k !== CACHE && k !== FOODS).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

// Solo se sirven desde caché los ficheros propios; la API de GitHub va siempre a la red.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/foods/')) {
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
