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
   - Lluvia en camino: en la misma consulta del clima viene el
     pronóstico de lluvia cada 15 min (2 h) y la probabilidad
     por hora (6 h). Dice si va a llover pronto o cuándo para.
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
    pintarLluvia();
  }

  // Convierte las columnas de Open-Meteo en filas [hora en ms, valor1, valor2...]
  function serie(bloque, campos) {
    if (!bloque || !bloque.time) return [];
    return bloque.time.map(function (t, i) {
      return [t * 1000].concat(campos.map(function (c) { var v = bloque[c] && bloque[c][i]; return typeof v === 'number' ? v : 0; }));
    });
  }

  // ---------- Lluvia en camino ----------
  var LLUEVE_MM = 0.1;           // mm en 15 min para contar como lluvia
  var CODIGOS_LLUVIA = /^(5[1-7]|6[1-7]|8[0-2]|9[5-9])$/;

  function minutosHasta(t, ref) { return Math.max(0, Math.round((t - ref) / 60000)); }
  function redondear5(m) { return m <= 7 ? null : Math.round(m / 5) * 5; }

  // Texto corto sobre la lluvia de las próximas horas; '' si no hay dato útil
  function textoLluvia(c, ref) {
    if (!c || !c.m15 || !c.horas || ref - c.cuando > 3 * 3600000) return '';
    var m15 = c.m15.filter(function (f) { return f[0] + 15 * 60000 > ref; }).slice(0, 8);
    var horas = c.horas.filter(function (f) { return f[0] + 3600000 > ref; }).slice(0, 6);
    if (!m15.length && !horas.length) return '';
    var lloviendo = CODIGOS_LLUVIA.test(String(c.codigo)) || (m15[0] && m15[0][1] >= LLUEVE_MM);
    var i;
    if (lloviendo) {
      // Para cuando vienen dos ratos de 15 min seguidos sin lluvia
      for (i = 1; i < m15.length; i++) {
        if (m15[i][1] < LLUEVE_MM && (!m15[i + 1] || m15[i + 1][1] < LLUEVE_MM)) {
          var mp = redondear5(minutosHasta(m15[i][0], ref));
          return mp ? 'Para de llover en ~' + mp + ' min' : 'Ya casi para de llover';
        }
      }
      return 'Lluvia por un buen rato';
    }
    for (i = 0; i < m15.length; i++) {
      if (m15[i][1] >= LLUEVE_MM) {
        var ml = redondear5(minutosHasta(m15[i][0], ref));
        return ml ? 'Lluvia en ~' + ml + ' min' : 'Empieza a llover pronto';
      }
    }
    var mayor = null;
    for (i = 0; i < horas.length; i++) {
      if (horas[i][1] >= 50 && horas[i][0] > ref) return 'Posible lluvia a las ' + horaCorta(new Date(horas[i][0])).replace(':00', '') + ' (' + Math.round(horas[i][1]) + ' %)';
      if (!mayor || horas[i][1] > mayor[1]) mayor = horas[i];
    }
    if (mayor && mayor[1] >= 25) return 'Poca probabilidad de lluvia (' + Math.round(mayor[1]) + ' %)';
    return 'Sin lluvia las próximas horas';
  }

  // Barritas con la probabilidad de lluvia de las próximas 6 horas
  function pintarBarras(c, ref) {
    var cont = $('barras');
    if (!cont) return;
    var horas = c && c.horas && ref - c.cuando <= 3 * 3600000 ? c.horas.filter(function (f) { return f[0] + 3600000 > ref; }).slice(0, 6) : [];
    cont.hidden = !horas.length;
    var html = horas.map(function (f) {
      var p = Math.max(0, Math.min(100, f[1]));
      return '<i style="height:' + Math.max(8, p) + '%" class="' + (p >= 50 ? 'alta' : p >= 25 ? 'media' : '') + '" title="' + horaCorta(new Date(f[0])) + ': ' + Math.round(p) + ' %"></i>';
    }).join('');
    if (cont.innerHTML !== html) cont.innerHTML = html;
  }

  function pintarLluvia() {
    var ref = ahora().getTime();
    var t = textoLluvia(clima, ref);
    poner('lluvia', t);
    var tarjeta = panel.querySelector('.w-clima');
    if (tarjeta) tarjeta.classList.toggle('llueve-pronto', /^(Lluvia en|Empieza|Lluvia por|Para de)/.test(t));
    pintarBarras(clima, ref);
  }

  function pedirClima() {
    if (!window.fetch || navigator.onLine === false) { pintarClima(); return; }
    var u = ubicacion();
    if (clima && Date.now() - clima.cuando < CLIMA_CADA_MS - 5000 && distancia(u, clima) < 10000) { pintarClima(); return; }
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + u.lat.toFixed(3) + '&longitude=' + u.lon.toFixed(3) +
      '&current=temperature_2m,apparent_temperature,weather_code' +
      '&minutely_15=precipitation&forecast_minutely_15=9' +
      '&hourly=precipitation_probability,precipitation&forecast_hours=7&timeformat=unixtime&timezone=auto';
    fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.current) return;
      clima = { temp: j.current.temperature_2m, sensacion: j.current.apparent_temperature, codigo: j.current.weather_code, cuando: Date.now(), lat: u.lat, lon: u.lon,
        m15: serie(j.minutely_15, ['precipitation']), horas: serie(j.hourly, ['precipitation_probability', 'precipitation']) };
      guardar('jimny-clima', clima);
      pintarClima();
      // Aviso para cielo.js: el cielo de la animación cambia según este dato
      try { window.dispatchEvent(new CustomEvent('jimny-clima', { detail: clima })); } catch (e) { /* navegador viejo */ }
    }).catch(function () { pintarClima(); });
  }

  // ---------- Tarjetas que se ven (Ajustes > Pantalla) ----------
  var NOMBRES_TARJETAS = { vel: 'Velocidad', viaje: 'Viaje', rumbo: 'Rumbo', hora: 'Hora', clima: 'Clima', carro: 'Carro', gas: 'Gasolinera', destino: 'Destino' };

  function ocultas() {
    var db = window.jimnyDB;
    var o = db && db.datos().pantalla && db.datos().pantalla.ocultas;
    return Array.isArray(o) ? o : [];
  }

  function aplicarTarjetas() {
    var o = ocultas(), visibles = 0;
    panel.querySelectorAll('[data-tarjeta]').forEach(function (t) {
      var esconder = o.indexOf(t.getAttribute('data-tarjeta')) >= 0;
      t.classList.toggle('oculta', esconder);
      if (!esconder) visibles++;
    });
    panel.classList.toggle('vacio', visibles === 0);
  }

  function tarjetaVisible(clave) { return ocultas().indexOf(clave) < 0; }

  function fijarTarjeta(clave, ver) {
    var db = window.jimnyDB;
    if (!db) return;
    var o = ocultas().filter(function (x) { return x !== clave; });
    if (!ver) o.push(clave);
    db.datos().pantalla.ocultas = o;
    db.guardar(); // avisa con "jimny-db" y se vuelve a aplicar
  }
  window.addEventListener('jimny-db', aplicarTarjetas);
  aplicarTarjetas();

  // ---------- Arranque ----------
  pintarGPS();
  pintarHora();
  pintarClima();
  setInterval(pintarHora, 1000);
  setInterval(pintarLluvia, 60000);  // los minutos que faltan para la lluvia
  setInterval(pintarGPS, 5000);       // para que el tiempo y el aviso de "sin GPS" se refresquen
  setTimeout(pedirClima, 2000);
  setInterval(pedirClima, CLIMA_CADA_MS);
  window.addEventListener('online', pedirClima);

  window.jimnyWidgets = {
    viaje: function () { return viaje; }, pintar: pintarGPS, gps: gps, pedirClima: pedirClima, calcularSol: calcularSol,
    textoLluvia: textoLluvia, pintarLluvia: pintarLluvia,
    NOMBRES_TARJETAS: NOMBRES_TARJETAS, tarjetaVisible: tarjetaVisible, fijarTarjeta: fijarTarjeta,
    // Herramientas para gasolineras.js y destinos.js
    distancia: distancia, rumboEntre: rumboEntre, ubicacion: ubicacion, numero: numero, horaCorta: horaCorta, ahora: ahora,
  };
})();
