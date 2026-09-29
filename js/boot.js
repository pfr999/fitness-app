// Red de seguridad (script clásico, se carga antes que la app): si la app no llega a pintarse
// — por ejemplo, una actualización que dejó ficheros de versiones distintas — ofrece repararla.
// «Reparar» solo borra la copia de la app y el service worker: tus datos, el token y lo pendiente
// de subir (IndexedDB y ajustes) no se tocan.
(function () {
  var errors = [];
  window.addEventListener('error', function (e) { errors.push(e.message || String(e.error || 'error')); });
  function repair() {
    var sw = navigator.serviceWorker ? navigator.serviceWorker.getRegistrations() : Promise.resolve([]);
    sw.then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })
      .then(function () { return window.caches ? caches.keys() : []; })
      .then(function (ks) {
        return Promise.all(ks.map(function (k) {
          if (k.indexOf('recomp-v') === 0) return caches.delete(k);
          // en la caché de alimentos solo deben quedar los datos, no código
          if (k.indexOf('recomp-foods') === 0) return caches.open(k).then(function (c) { return c.keys().then(function (rs) { return Promise.all(rs.filter(function (r) { return r.url.indexOf('/js/') >= 0; }).map(function (r) { return c.delete(r); })); }); });
          return null;
        }));
      })
      .catch(function () {})
      .then(function () { location.reload(); });
  }
  setTimeout(function () {
    if (document.body.dataset.booted) return;
    var el = document.createElement('div');
    el.className = 'boot-fail';
    el.innerHTML = '<b>La app no ha terminado de cargar</b><span>Suele pasar si una actualización se quedó a medias. Reparar vuelve a descargar la app; tus datos no se tocan.</span><button type="button">Reparar y recargar</button>' +
      (errors.length ? '<small></small>' : '');
    if (errors.length) el.querySelector('small').textContent = errors.slice(0, 2).join(' · ');
    el.querySelector('button').addEventListener('click', repair);
    document.body.appendChild(el);
  }, 7000);
})();
