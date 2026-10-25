/* =========================================================
   gasolineras.js: tarjeta "Gasolinera" con las favoritas.

   - Descarga las gasolineras a unos 8 km del carro desde
     OpenStreetMap (API Overpass, la misma del límite de
     velocidad). Se guardan y solo se pide de nuevo al alejarse
     3 km, o si lo guardado tiene más de una semana.
   - Muestra la más cercana de cada favorita (por defecto Puma
     y después Texaco, se cambian en Ajustes > Gasolina), con
     la distancia en línea recta y una flecha hacia dónde queda.
   - Si otra marca queda más cerca, lo dice abajo.

   Sin internet usa lo último descargado. Sin GPS no muestra nada.
   ========================================================= */
(function () {
  'use strict';

  var tarjeta = document.querySelector('.w-gas');
  var W = window.jimnyWidgets;
  if (!tarjeta || !W) return;

  var SERVIDORES = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  var RADIO = 8000, RECARGAR_A = 3000, VIEJO_MS = 7 * 86400000;
  var MIN_ENTRE_PEDIDOS = 90000, ESPERA_ERROR = 120000, ESPERA_INICIAL = 8000;

  var estado = { area: null, pidiendo: false, ultimoPedido: 0, esperarHasta: 0, primeraVez: 0, error: null };
  try { estado.area = JSON.parse(localStorage.getItem('jimny-gasolineras') || 'null'); } catch (e) { estado.area = null; }

  function $(n) { return tarjeta.querySelector('[data-w="' + n + '"]'); }
  function poner(n, t) { var e = $(n); if (e && e.textContent !== t) e.textContent = t; }

  // Sin tildes y en minúsculas, para comparar marcas
  function normal(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }

  function favoritas() {
    var db = window.jimnyDB;
    var f = db && db.datos().combustible.favoritas;
    return Array.isArray(f) ? f.filter(function (x) { return String(x).trim(); }) : [];
  }

  // ---------- Descarga ----------
  function pedir(p) {
    var ahora = Date.now();
    if (estado.pidiendo || ahora - estado.ultimoPedido < MIN_ENTRE_PEDIDOS || ahora < estado.esperarHasta) return;
    if (!window.fetch || navigator.onLine === false) return;
    estado.pidiendo = true; estado.ultimoPedido = ahora;
    var consulta = '[out:json][timeout:25];nwr["amenity"="fuel"](around:' + RADIO + ',' + p.lat.toFixed(4) + ',' + p.lon.toFixed(4) + ');out tags center qt;';
    intentar(0);

    function intentar(i) {
      fetch(SERVIDORES[i], { method: 'POST', body: 'data=' + encodeURIComponent(consulta), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
        .then(function (r) {
          if (!r.ok) throw new Error('error ' + r.status);
          return r.json();
        })
        .then(function (j) {
          estado.area = { centro: { lat: p.lat, lon: p.lon }, cuando: Date.now(), lista: convertir(j) };
          estado.error = null; estado.pidiendo = false;
          try { localStorage.setItem('jimny-gasolineras', JSON.stringify(estado.area)); } catch (e) { /* sin almacenamiento */ }
          pintar();
        })
        .catch(function (e) {
          if (i + 1 < SERVIDORES.length) { intentar(i + 1); return; }
          estado.error = e.message; estado.pidiendo = false; estado.esperarHasta = Date.now() + ESPERA_ERROR;
          pintar();
        });
    }
  }

  function convertir(j) {
    return (j.elements || []).map(function (el) {
      var t = el.tags || {};
      var lat = el.lat !== undefined ? el.lat : el.center && el.center.lat;
      var lon = el.lon !== undefined ? el.lon : el.center && el.center.lon;
      if (typeof lat !== 'number' || typeof lon !== 'number') return null;
      return { nombre: t.name || '', marca: t.brand || '', operador: t.operator || '', lat: lat, lon: lon };
    }).filter(Boolean);
  }

  // ---------- Elegir qué mostrar ----------
  function esDeMarca(g, marca) {
    var m = normal(marca);
    return m && (normal(g.marca).indexOf(m) >= 0 || normal(g.nombre).indexOf(m) >= 0 || normal(g.operador).indexOf(m) >= 0);
  }

  function etiqueta(g, marca) {
    var nombre = g.nombre || g.marca || g.operador || 'Gasolinera';
    if (marca && normal(nombre).indexOf(normal(marca)) < 0) nombre = marca + ' ' + nombre;
    return nombre;
  }

  // Devuelve { filas: [{g, nombre, dist, rumbo}], otra: {...} } con la más cercana de cada favorita
  function elegir(pos, lista, favs) {
    var conDist = lista.map(function (g) { return { g: g, dist: W.distancia(pos, g) }; }).sort(function (a, b) { return a.dist - b.dist; });
    var filas = [];
    favs.forEach(function (marca) {
      for (var i = 0; i < conDist.length; i++) {
        if (esDeMarca(conDist[i].g, marca)) { filas.push({ g: conDist[i].g, dist: conDist[i].dist, nombre: etiqueta(conDist[i].g, marca), marca: marca }); return; }
      }
    });
    var cercana = conDist[0] || null, otra = null;
    var masCercanaFav = filas.reduce(function (m, f) { return Math.min(m, f.dist); }, Infinity);
    if (cercana && !filas.some(function (f) { return f.g === cercana.g; }) && cercana.dist < masCercanaFav) {
      otra = { g: cercana.g, dist: cercana.dist, nombre: etiqueta(cercana.g, '') };
    }
    // Sin favoritas cerca: la más cercana pasa a ser la principal
    if (!filas.length && otra) { filas.push(otra); otra = null; }
    return { filas: filas.slice(0, 2), otra: otra };
  }

  function textoDist(m) {
    if (m < 1000) return Math.max(10, Math.round(m / 10) * 10) + ' m';
    return W.numero(m / 1000, m < 10000 ? 1 : 0) + ' km';
  }

  // ---------- Pintar ----------
  var flecha = $('gas-flecha');

  function pintar() {
    var pos = W.gps.ultimo;
    if (!pos) {
      tarjeta.classList.add('sin-dato');
      poner('gas1', W.gps.activo ? 'Buscando posición...' : 'Activa el GPS');
      poner('gas2', ''); poner('gas-nota', '');
      if (flecha) flecha.style.visibility = 'hidden';
      return;
    }
    if (!estado.area) {
      tarjeta.classList.add('sin-dato');
      poner('gas1', navigator.onLine === false ? 'Sin internet' : 'Buscando...');
      poner('gas2', ''); poner('gas-nota', estado.error ? 'El mapa no responde, reintenta solo' : '');
      if (flecha) flecha.style.visibility = 'hidden';
      return;
    }
    var r = elegir(pos, estado.area.lista, favoritas());
    tarjeta.classList.toggle('sin-dato', !r.filas.length);
    if (!r.filas.length) {
      poner('gas1', 'Ninguna cerca'); poner('gas2', ''); poner('gas-nota', 'A menos de ' + RADIO / 1000 + ' km');
      if (flecha) flecha.style.visibility = 'hidden';
      return;
    }
    var f1 = r.filas[0];
    poner('gas1', f1.nombre);
    poner('gas1-dist', textoDist(f1.dist));
    var f2 = r.filas[1];
    poner('gas2', f2 ? f2.nombre + ', ' + textoDist(f2.dist) : '');
    poner('gas-nota', r.otra ? 'Más cerca: ' + r.otra.nombre + ', ' + textoDist(r.otra.dist) : '');
    // Flecha: hacia dónde queda respecto al frente del carro (o al norte si no hay rumbo)
    if (flecha) {
      var hacia = W.rumboEntre(pos, f1.g) - (W.gps.rumbo !== null ? W.gps.rumbo : 0);
      flecha.style.visibility = f1.dist < 30 ? 'hidden' : 'visible';
      flecha.style.transform = 'rotate(' + Math.round(hacia) + 'deg)';
      flecha.classList.toggle('norte', W.gps.rumbo === null);
    }
  }

  window.addEventListener('jimny-gps', function (ev) {
    var d = ev.detail || {};
    if (d.apagado) { pintar(); return; }
    var p = W.gps.ultimo;
    if (p) {
      if (!estado.primeraVez) estado.primeraVez = Date.now();
      var lejos = !estado.area || W.distancia(estado.area.centro, p) > RECARGAR_A || Date.now() - estado.area.cuando > VIEJO_MS;
      // Espera unos segundos al arrancar para no pedir al mismo tiempo que las calles (mapa.js)
      if (lejos && Date.now() - estado.primeraVez >= ESPERA_INICIAL && W.tarjetaVisible('gas')) pedir(p);
    }
    pintar();
  });
  window.addEventListener('jimny-db', pintar);
  window.addEventListener('online', function () { estado.esperarHasta = 0; });

  pintar();
  window.jimnyGasolineras = { elegir: elegir, convertir: convertir, estado: estado, pintar: pintar };
})();
