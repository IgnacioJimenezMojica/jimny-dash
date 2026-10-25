/* =========================================================
   widgets.js: panel de datos sobre la animación.

   - Velocidad: la del momento, el promedio del viaje (solo el
     tiempo en movimiento, como la computadora de viaje de un
     carro) y la máxima.
   - Viaje: distancia y tiempo en movimiento. Se guarda; si el
     carro pasa más de 4 horas sin moverse, empieza uno nuevo.
     Se reinicia tocando la tarjeta dos veces.
   - Rumbo (brújula) y altura sobre el nivel del mar.
   - Hora y la próxima salida o puesta del sol.
   - Clima: temperatura y cielo de Open-Meteo (gratis, sin
     clave). Necesita internet; si no hay, muestra el último.
   - Carro: odómetro y cuándo toca el mantenimiento (db.js).
   - El viaje muestra lo que va costando en gasolina (db.js).

   Los datos del GPS llegan con el evento "jimny-gps" de gps.js.
   ========================================================= */
(function () {
  'use strict';

  var panel = document.querySelector('.widgets');
  var casilla = document.getElementById('datos');
  if (!panel || !casilla) return;

  var PANAMA = { lat: 8.9824, lon: -79.5199 };
  var VEL_MOVIMIENTO = 3;          // km/h
  var NUEVO_VIAJE_MS = 4 * 3600000;
  var PRECISION_VIAJE = 30;        // metros; peor que esto no suma distancia
  var CLIMA_CADA_MS = 15 * 60000;

  function $(nombre) { return panel.querySelector('[data-w="' + nombre + '"]'); }
  function poner(nombre, texto) { var e = $(nombre); if (e && e.textContent !== texto) e.textContent = texto; }
  function leer(clave) { try { return JSON.parse(localStorage.getItem(clave) || 'null'); } catch (e) { return null; } }
  function guardar(clave, valor) { try { localStorage.setItem(clave, JSON.stringify(valor)); } catch (e) { /* sin almacenamiento */ } }
  function dinero(n) { return '$' + n.toLocaleString('es-PA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function numero(n, dec) { return n.toLocaleString('es-PA', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }); }
  function ahora() { return window.jimnyLuz ? window.jimnyLuz.ahora() : new Date(); }

  function distancia(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function rumboEntre(a, b) {
    var rad = Math.PI / 180;
    var y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad);
    var x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
    return (Math.atan2(y, x) / rad + 360) % 360;
  }

  // ---------- Mostrar u ocultar el panel (se recuerda) ----------
  var preferido = leer('jimny-datos');
  casilla.checked = preferido === null ? true : !!preferido;
  casilla.addEventListener('change', function () { guardar('jimny-datos', casilla.checked); });

  // ---------- Velocidad y viaje ----------
  var viaje = leer('jimny-viaje');
  if (!viaje || Date.now() - (viaje.ultimaVez || 0) > NUEVO_VIAJE_MS) {
    if (viaje && window.jimnyDB) window.jimnyDB.guardarViaje(viaje); // el viaje anterior pasa al historial
    viaje = nuevoViaje();
  }
  var gps = { activo: false, vel: 0, ultimo: null, ultimoMovido: null, rumbo: null, altitud: null, precision: null, fuente: null };

  var posicionesSinGuardar = 0;
  function nuevoViaje() { return { metros: 0, segundos: 0, maxima: 0, inicio: Date.now(), ultimaVez: Date.now() }; }

  window.addEventListener('jimny-gps', function (ev) {
    var d = ev.detail || {};
    if (d.apagado) { gps.activo = false; gps.ultimo = null; gps.vel = 0; pintarGPS(); return; }
    gps.activo = true;
    gps.precision = d.precision;
    gps.fuente = d.fuente;
    if (d.altitud !== null) gps.altitud = d.altitud;

    // Velocidad que se muestra: la del equipo casi directa (es la más precisa, la misma
    // que usan las apps de navegación); la calculada, ya suavizada por gps.js
    var v = d.fuente === 'equipo' ? d.kmh : d.kmhSuave;
    if (typeof v === 'number') gps.vel = d.fuente === 'equipo' ? (gps.vel * 0.4 + v * 0.6) : v;
    // Para decidir si se mueve se usa el dato sin suavizar, así no suma segundos al frenar
    var vDato = d.fuente === 'equipo' ? d.kmh : d.kmhSuave;
    var enMovimiento = typeof vDato === 'number' && vDato >= VEL_MOVIMIENTO;

    var punto = { lat: d.latitud, lon: d.longitud, t: d.t };
    if (gps.ultimo && d.precision <= PRECISION_VIAJE) {
      var dt = (punto.t - gps.ultimo.t) / 1000;
      if (dt > 0 && dt <= 15 && enMovimiento && gps.vel < 250) {
        var tramo = distancia(gps.ultimo, punto);
        viaje.metros += tramo;
        if (window.jimnyDB) window.jimnyDB.sumarMetros(tramo); // el odómetro también suma
        if (++posicionesSinGuardar >= 5) { posicionesSinGuardar = 0; guardar('jimny-viaje', viaje); }
        viaje.segundos += dt;
        viaje.maxima = Math.max(viaje.maxima, gps.vel);
        viaje.ultimaVez = Date.now();
      }
    }
    if (d.precision <= PRECISION_VIAJE || !gps.ultimo) gps.ultimo = punto;

    // Rumbo: el del equipo si lo da; si no, la dirección entre dos puntos separados 10 m o más
    if (enMovimiento) {
      if (d.rumbo !== null) gps.rumbo = d.rumbo;
      else if (gps.ultimoMovido && distancia(gps.ultimoMovido, punto) >= 10) gps.rumbo = rumboEntre(gps.ultimoMovido, punto);
      if (!gps.ultimoMovido || distancia(gps.ultimoMovido, punto) >= 10) gps.ultimoMovido = punto;
    }
    pintarGPS();
  });

  var CARDINALES = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

  function pintarGPS() {
    panel.classList.toggle('sin-gps', !gps.activo);
    if (!gps.activo) {
      poner('vel', '--'); poner('fuente', 'Activa el GPS');
    } else {
      poner('vel', numero(gps.vel < VEL_MOVIMIENTO ? 0 : gps.vel));
      poner('fuente', (gps.fuente === 'equipo' ? 'GPS del equipo' : 'Calculada') + (gps.precision ? ', ±' + Math.round(gps.precision) + ' m' : ''));
    }
    var promedio = viaje.segundos > 0 ? viaje.metros / viaje.segundos * 3.6 : 0;
    poner('prom', 'Prom. ' + numero(promedio));
    poner('max', 'Máx. ' + numero(viaje.maxima));
    poner('dist', numero(viaje.metros / 1000, 1));
    var min = Math.round(viaje.segundos / 60);
    poner('tiempo', (min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + (min % 60) + ' min') + ' en movimiento');
    var costo = window.jimnyDB ? window.jimnyDB.costoDe(viaje.metros / 1000) : null;
    poner('costo', costo === null ? '' : dinero(costo) + ' en gasolina');
    pintarCarro();

    if (gps.rumbo !== null) {
      poner('cardinal', CARDINALES[Math.round(gps.rumbo / 45) % 8]);
      var f = $('flecha');
      if (f) f.style.transform = 'rotate(' + Math.round(gps.rumbo) + 'deg)';
    } else {
      poner('cardinal', gps.activo ? 'quieto' : '--');
    }
    poner('alt', 'Altura: ' + (gps.altitud !== null ? numero(gps.altitud) + ' m' : 'sin dato'));
  }

  // Reiniciar el viaje: dos toques seguidos (sin ventanas de confirmación)
  var tarjetaViaje = panel.querySelector('.w-viaje');
  var armado = 0;
  tarjetaViaje.addEventListener('click', function () {
    if (Date.now() - armado < 3000) {
      if (window.jimnyDB) window.jimnyDB.guardarViaje(viaje);
      viaje = nuevoViaje(); armado = 0;
      tarjetaViaje.classList.remove('armado');
      guardar('jimny-viaje', viaje); pintarGPS();
    } else {
      armado = Date.now();
      tarjetaViaje.classList.add('armado');
      setTimeout(function () { if (Date.now() - armado >= 3000) tarjetaViaje.classList.remove('armado'); }, 3100);
    }
  });

  // Se guarda cada 5 s y al salir u ocultar la página (por si se apaga la pantalla de golpe)
  setInterval(function () { guardar('jimny-viaje', viaje); }, 5000);
  window.addEventListener('pagehide', function () { guardar('jimny-viaje', viaje); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') guardar('jimny-viaje', viaje); });

  // ---------- Carro: odómetro y mantenimiento ----------
  function pintarCarro() {
    var db = window.jimnyDB;
    var tarjeta = panel.querySelector('.w-carro');
    if (!db || !tarjeta) return;
    var odo = db.odometroKm();
    poner('odometro', odo === null ? '--' : numero(odo));
    var e = db.estadoMantenimiento(ahora());
    tarjeta.dataset.nivel = e.configurado ? e.nivel : 'sin';
    if (!e.configurado) { poner('servicio', 'Configúralo en Ajustes'); return; }
    if (e.nivel === 'vencido') { poner('servicio', 'Ya toca mantenimiento'); return; }
    var partes = ['en ' + e.dias + (e.dias === 1 ? ' día' : ' días')];
    if (e.kmFaltan !== null) partes.push(numero(e.kmFaltan) + ' km');
    poner('servicio', 'Servicio ' + partes.join(' o ')); // p. ej. "Servicio en 12 días o 2,498 km"
  }
  window.addEventListener('jimny-db', pintarGPS);

  // ---------- Hora y sol ----------
  var proximoSol = null;

  function ubicacion() {
    if (gps.ultimo) return gps.ultimo;
    var p = leer('jimny-pos');
    return p && typeof p.lat === 'number' ? p : PANAMA;
  }

  function horaCorta(fecha) {
    return fecha.toLocaleTimeString('es-PA', { hour: 'numeric', minute: '2-digit' });
  }

  // Próxima vez que el sol cruza el horizonte (-0,833 grados por la refracción), en pasos de 10 min
  function calcularSol() {
    if (!window.jimnyLuz) return;
    var u = ubicacion(), elev = window.jimnyLuz.elevacionSol, HORIZONTE = -0.833;
    var t0 = ahora().getTime(), antes = elev(new Date(t0), u.lat, u.lon) - HORIZONTE;
    for (var m = 10; m <= 24 * 60; m += 10) {
      var t = t0 + m * 60000, ahoraV = elev(new Date(t), u.lat, u.lon) - HORIZONTE;
      if ((antes < 0) !== (ahoraV < 0)) {
        var a = t - 600000, b = t;
        for (var i = 0; i < 12; i++) { var mid = (a + b) / 2; if ((elev(new Date(mid), u.lat, u.lon) - HORIZONTE < 0) === (antes < 0)) a = mid; else b = mid; }
        proximoSol = { sale: antes < 0, cuando: new Date(b) };
        return;
      }
      antes = ahoraV;
    }
  }

  function pintarHora() {
    var f = ahora();
    poner('hora', horaCorta(f));
    if (!proximoSol || proximoSol.cuando <= f) calcularSol();
    if (proximoSol) poner('sol', (proximoSol.sale ? 'Sale el sol ' : 'Se pone el sol ') + horaCorta(proximoSol.cuando));
  }

  // ---------- Clima (Open-Meteo) ----------
  var CIELO = {
    0: 'Despejado', 1: 'Casi despejado', 2: 'Parcialmente nublado', 3: 'Nublado',
    45: 'Neblina', 48: 'Neblina', 51: 'Llovizna', 53: 'Llovizna', 55: 'Llovizna fuerte',
    56: 'Llovizna helada', 57: 'Llovizna helada', 61: 'Lluvia débil', 63: 'Lluvia', 65: 'Lluvia fuerte',
    66: 'Lluvia helada', 67: 'Lluvia helada', 71: 'Nieve', 73: 'Nieve', 75: 'Nieve fuerte', 77: 'Nieve',
    80: 'Aguaceros', 81: 'Aguaceros', 82: 'Aguaceros fuertes', 85: 'Nevadas', 86: 'Nevadas',
    95: 'Tormenta', 96: 'Tormenta con granizo', 97: 'Tormenta', 99: 'Tormenta con granizo',
  };
  var clima = leer('jimny-clima');

  function pintarClima() {
    if (!clima) { poner('temp', 'sin dato'); poner('cielo', navigator.onLine === false ? 'Sin internet' : 'Buscando...'); return; }
    poner('temp', numero(clima.temp) + ' °C');
    var hace = Math.round((Date.now() - clima.cuando) / 60000);
    var texto = (CIELO[clima.codigo] || 'Cielo') + ', sensación ' + numero(clima.sensacion) + ' °C';
    if (hace > 30) texto += ' (hace ' + (hace < 120 ? hace + ' min' : Math.round(hace / 60) + ' h') + ')';
    poner('cielo', texto);
  }

  function pedirClima() {
    if (!window.fetch || navigator.onLine === false) { pintarClima(); return; }
    var u = ubicacion();
    if (clima && Date.now() - clima.cuando < CLIMA_CADA_MS - 5000 && distancia(u, clima) < 10000) { pintarClima(); return; }
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + u.lat.toFixed(3) + '&longitude=' + u.lon.toFixed(3) +
      '&current=temperature_2m,apparent_temperature,weather_code&timezone=auto';
    fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.current) return;
      clima = { temp: j.current.temperature_2m, sensacion: j.current.apparent_temperature, codigo: j.current.weather_code, cuando: Date.now(), lat: u.lat, lon: u.lon };
      guardar('jimny-clima', clima);
      pintarClima();
      // Aviso para cielo.js: el cielo de la animación cambia según este dato
      try { window.dispatchEvent(new CustomEvent('jimny-clima', { detail: clima })); } catch (e) { /* navegador viejo */ }
    }).catch(function () { pintarClima(); });
  }

  // ---------- Arranque ----------
  pintarGPS();
  pintarHora();
  pintarClima();
  setInterval(pintarHora, 1000);
  setInterval(pintarGPS, 5000);       // para que el tiempo y el aviso de "sin GPS" se refresquen
  setTimeout(pedirClima, 2000);
  setInterval(pedirClima, CLIMA_CADA_MS);
  window.addEventListener('online', pedirClima);

  window.jimnyWidgets = { viaje: function () { return viaje; }, pintar: pintarGPS, gps: gps, pedirClima: pedirClima, calcularSol: calcularSol };
})();
