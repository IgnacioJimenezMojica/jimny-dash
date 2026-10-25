/* =========================================================
   pwa.js: lo necesario cuando la página se abre desde una
   dirección web (HTTPS), no desde la USB.

   - Registra el service worker (sw.js), que guarda la página
     para que funcione aunque se caiga el internet.
   - Mantiene la pantalla encendida mientras se ve la
     animación (Screen Wake Lock), si el navegador lo permite.

   Desde un archivo local (file://) no hace nada: ahí no hay
   service worker y la página ya está en la USB.
   ========================================================= */
(function () {
  'use strict';

  var esWeb = location.protocol === 'https:' || location.protocol === 'http:';
  if (!esWeb) return;

  // ---------- Service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* sin service worker, sigue normal */ });
    });
  }

  // ---------- Pantalla siempre encendida ----------
  var bloqueo = null;

  function pedirPantallaEncendida() {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible' || bloqueo) return;
    navigator.wakeLock.request('screen').then(function (b) {
      bloqueo = b;
      bloqueo.addEventListener('release', function () { bloqueo = null; });
    }).catch(function () { /* el navegador no lo permitió, no pasa nada */ });
  }

  // Se vuelve a pedir al regresar a la página (el navegador lo suelta al cambiar de app)
  document.addEventListener('visibilitychange', pedirPantallaEncendida);
  // Algunos navegadores solo lo dan después de un toque
  document.addEventListener('click', pedirPantallaEncendida);
  pedirPantallaEncendida();

  window.jimnyPWA = { pantallaEncendida: function () { return !!bloqueo; } };
})();
