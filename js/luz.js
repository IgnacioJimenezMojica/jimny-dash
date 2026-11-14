/* =========================================================
   luz.js: día, atardecer/amanecer y noche en automático.

   - La hora sale del reloj de la pantalla (el del sistema), pero
     la pantalla del carro a veces arranca con la fecha 15 de enero
     de 2025 (no guarda la hora apagada). Por eso, en este orden:
       1. internet: la cabecera Date de la propia página (versión
          web), si el reloj está corrido más de 90 s;
       2. GPS: la hora de la posición, si va adelante del reloj
          (el GPS trae la hora de los satélites);
       3. estimada: si el reloj marca antes de la última hora buena
          que se vio (o antes de que existiera la app), se usa esa
          última hora buena hasta que llegue 1 o 2.
     La corrección vale solo para este encendido: al abrir de
     nuevo se vuelve a revisar (el reloj puede venir bien).
   - No usa horas fijas: calcula la altura del sol para la
     ubicación (la del GPS si ya hay una, si no Ciudad de Panamá).
       sol a más de 3 grados ........ día
       entre 3 y -7 grados .......... atardecer o amanecer
       más de 7 grados bajo el horizonte ... noche
   - Sin JavaScript, el botón de luz cambia entre día y noche a mano.
   ========================================================= */
(function () {
  'use strict';

  var raiz = document.documentElement;
  var radios = { auto: document.getElementById('luz-auto'), dia: document.getElementById('luz-dia'), noche: document.getElementById('luz-noche') };
  var etiquetaFase = document.querySelector('.l-auto .fase');
  var PANAMA = { lat: 8.9824, lon: -79.5199 };
  var SOL_DIA = 3, SOL_NOCHE = -7;
  var estado = { desfase: 0, fuenteHora: 'pantalla', fase: null, elevacion: null, confiable: true };
  // Un reloj que marque antes de 2026 está mal seguro (la pantalla arranca en enero de 2025)
  var FECHA_MINIMA = Date.UTC(2026, 0, 1);

  // ---------- Hora ----------
  function ahoraMs() { return Date.now() + estado.desfase; }
  function ahora() { return new Date(ahoraMs()); }

  // Última hora buena que se vio (se guarda cada minuto)
  function leerUltima() { try { var u = JSON.parse(localStorage.getItem('jimny-reloj') || 'null'); return u && u.ms > FECHA_MINIMA ? u.ms : FECHA_MINIMA; } catch (e) { return FECHA_MINIMA; } }
  function guardarUltima() { var t = ahoraMs(); if (t > leerUltima()) try { localStorage.setItem('jimny-reloj', JSON.stringify({ ms: t })); } catch (e) { /* nada */ } }

  function fijarDesfase(ms, fuente) {
    estado.desfase = ms;
    estado.fuenteHora = fuente;
    estado.confiable = true;
    guardarUltima();
    try { window.dispatchEvent(new CustomEvent('jimny-hora', { detail: { desfase: ms, fuente: fuente } })); } catch (e) { /* nada */ }
  }

  // Al arrancar: si el reloj marca antes de lo último que se vio, está atrasado
  (function () {
    try { localStorage.removeItem('jimny-desfase'); } catch (e) { /* era de la versión anterior: se aplicaba aunque el reloj viniera bien */ }
    var ultima = leerUltima();
    if (Date.now() < ultima - 5 * 60000) {
      estado.desfase = ultima - Date.now();
      estado.fuenteHora = 'estimada (el reloj de la pantalla vino atrasado; falta internet o GPS para saber la hora exacta)';
      estado.confiable = false;
    }
  })();

  // La hora del GPS: se usa si va adelante del reloj (sirve cuando la pantalla arranca atrasada)
  function horaDelGPS(ms) {
    if (typeof ms !== 'number' || ms < FECHA_MINIMA) return;
    var dif = ms - Date.now();
    if (estado.fuenteHora.indexOf('internet') === 0) return;      // internet manda
    if (dif > 120000 && Math.abs(dif - estado.desfase) > 120000) { fijarDesfase(dif, 'GPS (reloj de la pantalla atrasado ' + Math.round(dif / 60000) + ' min)'); actualizar(); }
  }

  function revisarHoraInternet() {
    if (!/^https?:$/.test(location.protocol) || !window.fetch || navigator.onLine === false) return;
    var antes = Date.now();
    fetch(location.href, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
      var cabecera = r.headers.get('Date');
      if (!cabecera) return;
      var despues = Date.now();
      var servidor = new Date(cabecera).getTime() + (despues - antes) / 2;
      var diferencia = servidor - despues;
      // La cabecera solo trae segundos; menos de 90 s de diferencia no vale la pena
      var d = Math.abs(diferencia) > 90000 ? diferencia : 0;
      fijarDesfase(d, d ? 'internet (reloj de la pantalla corrido ' + Math.round(diferencia / 60000) + ' min)' : 'internet (el reloj de la pantalla está bien)');
      actualizar();
    }).catch(function () { /* sin internet: se queda con la hora de la pantalla */ });
  }

  // ---------- Ubicación ----------
  function ubicacion() {
    var g = window.jimnyGPS && window.jimnyGPS.estado && window.jimnyGPS.estado.anterior;
    if (g && g.c) return { lat: g.c.latitude, lon: g.c.longitude };
    try {
      var p = JSON.parse(localStorage.getItem('jimny-pos') || 'null');
      if (p && typeof p.lat === 'number') return p;
    } catch (e) { /* sin almacenamiento */ }
    return PANAMA;
  }

  // ---------- Altura del sol (fórmulas simplificadas del Almanaque Náutico, error menor a 1 grado) ----------
  function elevacionSol(fecha, lat, lon) {
    var rad = Math.PI / 180;
    var d = fecha.getTime() / 86400000 + 2440587.5 - 2451545.0;       // días desde el año 2000
    var g = (357.529 + 0.98560028 * d) * rad;                         // anomalía media
    var q = 280.459 + 0.98564736 * d;                                 // longitud media
    var L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad; // longitud eclíptica
    var e = (23.439 - 0.00000036 * d) * rad;                          // inclinación del eje
    var ar = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));      // ascensión recta
    var dec = Math.asin(Math.sin(e) * Math.sin(L));                   // declinación
    var gmst = (18.697374558 + 24.06570982441908 * d) % 24;           // hora sidérea
    var angulo = (gmst * 15 + lon) * rad - ar;                        // ángulo horario
    var alt = Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(angulo));
    return alt / rad;
  }

  // ---------- Aplicar ----------
  function actualizar() {
    var fecha = ahora(), u = ubicacion();
    var elev = elevacionSol(fecha, u.lat, u.lon);
    var fase = elev > SOL_DIA ? 'dia' : (elev > SOL_NOCHE ? 'crepusculo' : 'noche');
    estado.elevacion = elev;
    estado.fase = fase;
    raiz.classList.toggle('luz-noche', fase === 'noche');
    raiz.classList.toggle('luz-crepusculo', fase === 'crepusculo');
    raiz.classList.toggle('luz-diurna', fase === 'dia');
    var nombre = { dia: 'día', noche: 'noche', crepusculo: fecha.getHours() < 12 ? 'amanecer' : 'atardecer' }[fase];
    if (etiquetaFase) etiquetaFase.textContent = nombre;
    var enAjustes = document.querySelector('.a-fase');
    if (enAjustes) enAjustes.textContent = ' (ahora: ' + nombre + ')';
  }

  function modoActual() {
    for (var m in radios) if (radios[m] && radios[m].checked) return m;
    return 'dia';
  }

  // Arranca en automático, o en el último modo que se eligió
  var modo = 'auto';
  try { modo = localStorage.getItem('jimny-luz') || 'auto'; } catch (e) { /* sin almacenamiento */ }
  if (radios[modo]) radios[modo].checked = true;

  document.addEventListener('change', function (ev) {
    if (ev.target && ev.target.name === 'luz') {
      try { localStorage.setItem('jimny-luz', modoActual()); } catch (e) { /* sin almacenamiento */ }
    }
  });

  actualizar();
  setInterval(actualizar, 60000);
  setInterval(function () { if (estado.confiable) guardarUltima(); }, 60000);
  window.addEventListener('pagehide', function () { if (estado.confiable) guardarUltima(); });
  // La hora de cada posición del GPS
  window.addEventListener('jimny-gps', function (ev) { var d = ev.detail || {}; if (!d.apagado) horaDelGPS(d.t); });
  // La primera revisión espera un poco para no competir con la carga de la página; si el
  // reloj vino atrasado se revisa enseguida
  setTimeout(revisarHoraInternet, estado.confiable ? 3000 : 500);
  setInterval(revisarHoraInternet, 6 * 3600000);
  window.addEventListener('online', revisarHoraInternet);
  // Al volver a la página (por ejemplo después de apagar el carro) se recalcula enseguida
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') actualizar(); });

  window.jimnyLuz = { estado: estado, actualizar: actualizar, elevacionSol: elevacionSol, ahora: ahora, ahoraMs: ahoraMs, FECHA_MINIMA: FECHA_MINIMA, horaDelGPS: horaDelGPS };
})();
