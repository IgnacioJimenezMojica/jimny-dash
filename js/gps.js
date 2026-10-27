/* =========================================================
   gps.js: velocidad de la animación según la velocidad real
   del carro, usando el GPS del navegador.

   Es opcional: si no hay JavaScript, no hay permiso o no hay
   señal, la animación sigue funcionando sola con CSS.

   Cómo funciona:
   - navigator.geolocation.watchPosition entrega posiciones.
   - La velocidad sale de coords.speed (m/s). Si el equipo no
     la da, se calcula con la distancia entre dos posiciones.
   - Se suaviza para que no dé tirones.
   - Se cambia playbackRate de todas las animaciones. A
     diferencia de cambiar la duración en CSS, esto no hace
     saltar las capas de posición.
   ========================================================= */
(function () {
  'use strict';

  if (!('geolocation' in navigator) || !document.getAnimations) return;

  // Velocidad real (km/h) que corresponde a la animación normal de cada escena.
  // Ejemplo: en carretera, a 80 km/h la animación va a su velocidad de diseño.
  var VELOCIDAD_BASE = { carretera: 80, alrededores: 40, ciudad: 35, tierra: 30, montana: 20 };
  var RITMO_MAXIMO = 2;      // nunca más del doble de la velocidad de diseño
  var VEL_DETENIDO = 3;      // por debajo de esto (km/h) se considera detenido
  var PRECISION_MAX = 50;    // metros; posiciones peores se ignoran para calcular
  var SIN_SENAL_MS = 10000;  // sin datos por este tiempo se avisa "sin señal"
  // Animaciones que no dependen de la velocidad del carro (estrellas, aviso, lluvia, relámpago)
  var NO_SIGUEN_VELOCIDAD = ['titilar', 'latido', 'caer-lejos', 'caer-cerca', 'relampago'];

  var raiz = document.documentElement;
  var casilla = document.getElementById('gps');
  var indicador = document.querySelector('.velocimetro');
  var estado = { vigilancia: null, anterior: null, kmh: null, objetivo: 1, ritmo: 1, ultimoDato: 0 };

  raiz.classList.add('con-js');

  function escenaActual() {
    var r = document.querySelector('input[name="escena"]:checked');
    return r ? r.id.replace('esc-', '') : 'carretera';
  }

  function distanciaMetros(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b.latitude - a.latitude) * rad;
    var dLon = (b.longitude - a.longitude) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function mostrar(texto, clase) {
    indicador.textContent = texto;
    indicador.dataset.estado = clase;
  }

  function calcularObjetivo() {
    if (estado.kmh === null) return 1;
    if (estado.kmh < VEL_DETENIDO) return 0;
    var base = VELOCIDAD_BASE[escenaActual()] || 60;
    return Math.min(RITMO_MAXIMO, estado.kmh / base);
  }

  function alRecibir(pos) {
    var c = pos.coords, t = pos.timestamp || Date.now();
    var kmh = null;

    if (typeof c.speed === 'number' && !isNaN(c.speed) && c.speed >= 0) {
      // El equipo ya da la velocidad (lo normal en Android con GPS)
      kmh = c.speed * 3.6;
      estado.anterior = { c: c, t: t };
    } else if (!estado.anterior) {
      estado.anterior = { c: c, t: t };
    } else if (c.accuracy <= PRECISION_MAX) {
      // Calcularla con dos posiciones. Solo cuenta si se movió más que el error
      // del GPS; si a los 2 s no ha salido de ese margen, se considera detenido.
      var dt = (t - estado.anterior.t) / 1000;
      var d = distanciaMetros(estado.anterior.c, c);
      var umbral = Math.max(c.accuracy || 0, 5);
      if (d >= umbral && dt >= 0.8) { kmh = d / dt * 3.6; estado.anterior = { c: c, t: t }; }
      else if (dt >= 20) { kmh = 0; estado.anterior = { c: c, t: t }; }
      // Sigue dentro del margen de error tras 2 s: se toma como detenido, pero sin
      // mover el punto de referencia, para que un avance lento se note al salir del margen
      else if (dt >= 2) { kmh = 0; }
    }
    try { localStorage.setItem('jimny-pos', JSON.stringify({ lat: c.latitude, lon: c.longitude })); } catch (e) { /* sin almacenamiento */ }
    if (kmh !== null) {
      // Suavizado para la animación: mitad el dato nuevo, mitad lo anterior
      estado.kmh = estado.kmh === null ? kmh : (estado.kmh + kmh) / 2;
      estado.ultimoDato = Date.now();
      mostrar(Math.round(estado.kmh) + ' km/h', estado.kmh < VEL_DETENIDO ? 'detenido' : 'ok');
    } else if (estado.kmh === null) {
      mostrar('GPS: calculando', 'buscando');
    }

    // Aviso para los widgets (widgets.js): cada posición, con la velocidad sin suavizar
    avisar({
      latitud: c.latitude, longitud: c.longitude, precision: c.accuracy,
      altitud: typeof c.altitude === 'number' ? c.altitude : null,
      rumbo: typeof c.heading === 'number' && !isNaN(c.heading) ? c.heading : null,
      kmh: kmh, kmhSuave: estado.kmh,
      fuente: typeof c.speed === 'number' && !isNaN(c.speed) && c.speed >= 0 ? 'equipo' : 'calculada',
      t: t,
    });
  }

  function avisar(detalle) {
    try { window.dispatchEvent(new CustomEvent('jimny-gps', { detail: detalle })); } catch (e) { /* navegador viejo */ }
  }

  function alFallar(err) {
    if (err.code === 1) { mostrar('GPS: sin permiso', 'error'); apagar(true); return; }
    // Los errores sueltos de "sin posición" son normales (túneles, edificios, el propio
    // navegador). Solo se avisa si ya pasó un rato sin datos buenos.
    if (!estado.ultimoDato || Date.now() - estado.ultimoDato > SIN_SENAL_MS) mostrar('GPS: sin señal', 'error');
  }

  function encender() {
    if (estado.vigilancia !== null) return;
    mostrar('GPS: buscando', 'buscando');
    estado.vigilancia = navigator.geolocation.watchPosition(alRecibir, alFallar,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
    raiz.classList.add('gps-activo');
    guardar(true);
  }

  function apagar(mantenerAviso) {
    if (estado.vigilancia !== null) navigator.geolocation.clearWatch(estado.vigilancia);
    estado.vigilancia = null; estado.anterior = null; estado.kmh = null;
    raiz.classList.remove('gps-activo');
    if (!mantenerAviso) mostrar('', 'apagado');
    avisar({ apagado: true });
    if (casilla.checked) casilla.checked = false;
    guardar(false);
  }

  function guardar(valor) {
    try { localStorage.setItem('jimny-gps', valor ? '1' : '0'); } catch (e) { /* sin almacenamiento */ }
  }

  // Lleva el ritmo actual hacia el objetivo poco a poco y lo aplica a todas las animaciones.
  // Se repite 10 veces por segundo; incluye las animaciones nuevas que crea un cambio de escena.
  function aplicar() {
    if (estado.vigilancia !== null && estado.ultimoDato && Date.now() - estado.ultimoDato > SIN_SENAL_MS) {
      mostrar('GPS: sin señal', 'error');
    }
    estado.objetivo = estado.vigilancia === null ? 1 : calcularObjetivo();
    estado.ritmo += (estado.objetivo - estado.ritmo) * 0.15;
    if (Math.abs(estado.objetivo - estado.ritmo) < 0.005) estado.ritmo = estado.objetivo;

    var anims = document.getAnimations();
    for (var i = 0; i < anims.length; i++) {
      var a = anims[i];
      // Solo las animaciones del paisaje y del carro, no las transiciones de la interfaz
      if (!a.animationName || NO_SIGUEN_VELOCIDAD.indexOf(a.animationName) >= 0) continue;
      if (Math.abs(a.playbackRate - estado.ritmo) > 0.001) {
        if (a.updatePlaybackRate) a.updatePlaybackRate(estado.ritmo); else a.playbackRate = estado.ritmo;
      }
    }
    raiz.classList.toggle('detenido', estado.vigilancia !== null && estado.ritmo < 0.02);
  }

  casilla.addEventListener('change', function () { if (casilla.checked) encender(); else apagar(); });
  setInterval(aplicar, 100);

  // Recordar si el GPS estaba encendido la última vez
  var antes = null;
  try { antes = localStorage.getItem('jimny-gps'); } catch (e) { /* sin almacenamiento */ }
  if (antes === '1') { casilla.checked = true; encender(); }

  // Para pruebas desde la consola
  window.jimnyGPS = { estado: estado, VELOCIDAD_BASE: VELOCIDAD_BASE };
})();
