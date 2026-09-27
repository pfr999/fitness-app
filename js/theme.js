// Se carga antes de pintar para evitar el parpadeo de tema. Preferencia por dispositivo.
(function () {
  var t = 'auto';
  try { t = localStorage.getItem('theme') || 'auto'; } catch (e) {}
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();
