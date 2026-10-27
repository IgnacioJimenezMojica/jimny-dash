/* =========================================================
   luz.js: día, atardecer/amanecer y noche en automático.

   - La hora sale del reloj de la pantalla (el del sistema).
   - En la versión web (HTTPS) además se compara con la hora
     del servidor (cabecera Date de la propia página). Si el
     reloj de la pantalla está corrido más de 90 s, se corrige.
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
  var estado = { desfase: 0, fuenteHora: 'pantalla', fase: null, elevacion: null };

  // ---------- Hora ----------
  function ahora() { return new Date(Date.now() + estado.desfase); }

  try {
    var guardado = JSON.parse(localStorage.getItem('jimny-desfase') || 'null');
    if (guardado && typeof guardado.desfase === 'number') { estado.desfase = guardado.desfase; estado.fuenteHora = 'internet (guardada)'; }
  } catch (e) { /* sin almacenamiento */ }

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
      estado.desfase = Math.abs(diferencia) > 90000 ? diferencia : 0;
      estado.fuenteHora = estado.desfase ? 'internet (reloj de la pantalla corrido ' + Math.round(diferencia / 60000) + ' min)' : 'pantalla (confirmada por internet)';
      try { localStorage.setItem('jimny-desfase', JSON.stringify({ desfase: estado.desfase, cuando: despues })); } catch (e) { /* sin almacenamiento */ }
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
  // La primera revisión espera unos segundos para no competir con la carga de la página
  setTimeout(revisarHoraInternet, 3000);
  setInterval(revisarHoraInternet, 6 * 3600000);
  window.addEventListener('online', revisarHoraInternet);
  // Al volver a la página (por ejemplo después de apagar el carro) se recalcula enseguida
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') actualizar(); });

  window.jimnyLuz = { estado: estado, actualizar: actualizar, elevacionSol: elevacionSol, ahora: ahora };
})();
