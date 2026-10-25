/* =========================================================
   luna.js: fase real de la luna en el cielo de noche.

   - Calcula la edad de la luna con el mes sinódico medio
     (29,53 días) desde una luna nueva conocida (6 de enero
     de 2000). El error es de menos de un día: suficiente
     para dibujarla.
   - Dibuja la parte iluminada: el borde de la luna por un
     lado y la línea de sombra (una media elipse) por el otro.
   - Creciente: iluminada hacia el lado del sol al atardecer;
     menguante: hacia el otro lado. Cerca del ecuador (Panamá
     está a 9 grados) la luna creciente se ve "acostada", como
     una sonrisa, así que se gira según la latitud.
   - Escribe la fase y el porcentaje iluminado en la tarjeta
     de la hora.
   ========================================================= */
(function () {
  'use strict';

  var MES = 29.530588853;
  var NUEVA_2000 = 2451550.1; // día juliano de la luna nueva del 6 de enero de 2000
  var R = 30;

  var luz = document.getElementById('luna-luz');
  var grupo = document.getElementById('luna');
  var halo = document.getElementById('luna-halo');

  function ahora() { return window.jimnyLuz ? window.jimnyLuz.ahora() : new Date(); }

  function calcular(fecha) {
    var jd = fecha.getTime() / 86400000 + 2440587.5;
    var fase = ((jd - NUEVA_2000) / MES) % 1;
    if (fase < 0) fase += 1;
    var iluminada = (1 - Math.cos(2 * Math.PI * fase)) / 2;
    return { fase: fase, iluminada: iluminada, edad: fase * MES, nombre: nombreDe(fase) };
  }

  function nombreDe(f) {
    if (f < 0.0339 || f >= 0.9661) return 'Luna nueva';
    if (f < 0.216) return 'Luna creciente';
    if (f < 0.284) return 'Cuarto creciente';
    if (f < 0.466) return 'Luna gibosa creciente';
    if (f < 0.534) return 'Luna llena';
    if (f < 0.716) return 'Luna gibosa menguante';
    if (f < 0.784) return 'Cuarto menguante';
    return 'Luna menguante';
  }

  // Camino de la parte iluminada en un círculo de radio R centrado en 0,0, iluminada a la derecha
  // (creciente). Para menguante se refleja con scale(-1, 1).
  function camino(fase) {
    var k = Math.cos(2 * Math.PI * fase);        // 1 nueva, 0 cuarto, -1 llena
    var rx = Math.abs(k) * R;
    var esMedialuna = k > 0; // menos de la mitad iluminada
    // Borde: media circunferencia del lado iluminado (derecha), de arriba a abajo
    // Sombra: media elipse de abajo hacia arriba; se curva hacia la derecha si es medialuna
    return 'M0,' + (-R) + ' A' + R + ',' + R + ' 0 0 1 0,' + R +
           ' A' + rx.toFixed(2) + ',' + R + ' 0 0 ' + (esMedialuna ? 0 : 1) + ' 0,' + (-R) + ' Z';
  }

  function latitud() {
    var g = window.jimnyWidgets && window.jimnyWidgets.gps && window.jimnyWidgets.gps.ultimo;
    if (g) return g.lat;
    try { var p = JSON.parse(localStorage.getItem('jimny-pos') || 'null'); if (p && typeof p.lat === 'number') return p.lat; } catch (e) { /* nada */ }
    return 8.98;
  }

  function pintar() {
    var c = calcular(ahora());
    var creciente = c.fase < 0.5;
    if (luz) {
      luz.setAttribute('d', camino(c.fase));
      // Giro: cerca del ecuador la parte iluminada mira hacia abajo (hacia el sol bajo el horizonte)
      var giro = (90 - Math.abs(latitud())) * 0.85;
      var t = 'translate(1380 300) rotate(' + (creciente ? giro : -giro).toFixed(1) + ')' + (creciente ? '' : ' scale(-1 1)');
      grupo.setAttribute('transform', t);
    }
    if (halo) halo.setAttribute('opacity', (0.15 + 0.85 * c.iluminada).toFixed(2));
    // La parte en sombra apenas se insinúa, y en luna nueva no se ve (si no, queda un círculo gris raro)
    var sombra = document.getElementById('luna-sombra');
    if (sombra) sombra.setAttribute('opacity', c.iluminada < 0.03 ? '0' : '0.18');
    var texto = document.querySelector('[data-w="luna"]');
    if (texto) texto.textContent = c.nombre + ', ' + Math.round(c.iluminada * 100) + ' %';
    window.jimnyLuna.ultimo = c;
  }

  window.jimnyLuna = { calcular: calcular, camino: camino, pintar: pintar, ultimo: null };
  pintar();
  setInterval(pintar, 10 * 60000);
})();
