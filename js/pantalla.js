/* =========================================================
   pantalla.js: botón de pantalla completa.

   - Usa la API de pantalla completa del navegador: esconde la
     barra de direcciones, las pestañas y los botones de Chrome.
   - El navegador solo la permite después de un toque, así que
     no se puede activar sola al abrir. Al recargar se sale.
   - El mismo botón sirve para salir.
   - Si el navegador no la tiene, o la página ya está abierta
     como app a pantalla completa, el botón no aparece.
   ========================================================= */
(function () {
  'use strict';

  var raiz = document.documentElement;
  var botones = document.querySelectorAll('.b-pantalla, .b-pantalla-ajustes');
  var bloqueAjustes = document.querySelector('.a-control-pantalla');

  var pedir = raiz.requestFullscreen || raiz.webkitRequestFullscreen;
  var salir = document.exitFullscreen || document.webkitExitFullscreen;
  var habilitada = document.fullscreenEnabled || document.webkitFullscreenEnabled;

  function enPantallaCompleta() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }

  // Abierta como app instalada a pantalla completa: no hace falta el botón
  function comoApp() {
    try { return window.matchMedia('(display-mode: fullscreen)').matches && !enPantallaCompleta(); } catch (e) { return false; }
  }

  function pintar() {
    var dentro = enPantallaCompleta();
    raiz.classList.toggle('en-pantalla-completa', dentro);
    botones.forEach(function (b) {
      if (b.classList.contains('b-pantalla-ajustes')) b.textContent = dentro ? 'Salir de pantalla completa' : 'Pantalla completa';
      else { b.setAttribute('aria-label', dentro ? 'Salir de pantalla completa' : 'Pantalla completa'); b.title = b.getAttribute('aria-label'); }
    });
  }

  function alternar() {
    if (enPantallaCompleta()) { if (salir) salir.call(document); return; }
    try {
      var r = pedir.call(raiz, { navigationUI: 'hide' });
      if (r && r.catch) r.catch(function () { /* el navegador no quiso; no pasa nada */ });
    } catch (e) { /* navegador viejo */ }
  }

  if (!pedir || habilitada === false || comoApp()) return;

  botones.forEach(function (b) { b.hidden = false; b.addEventListener('click', alternar); });
  if (bloqueAjustes) bloqueAjustes.hidden = false;
  document.addEventListener('fullscreenchange', pintar);
  document.addEventListener('webkitfullscreenchange', pintar);
  pintar();

  window.jimnyPantalla = { alternar: alternar, enPantallaCompleta: enPantallaCompleta };
})();
