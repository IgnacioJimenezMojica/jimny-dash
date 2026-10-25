/* =========================================================
   mapa.js: datos de la calle desde OpenStreetMap.

   - Descarga las calles alrededor del carro (unos 500 m) con la
     API Overpass. Solo pide de nuevo cuando el carro se aleja
     300 m del centro de lo descargado, y nunca más de una vez
     cada 20 s (reglas de uso del servidor público).
   - Busca la calle por la que va el carro (la más cercana que
     además vaya en la misma dirección que el rumbo).
   - Límite de velocidad: etiqueta maxspeed de esa calle. Si la
     calle no lo tiene cargado en el mapa, lo dice.
   - Escena automática: elige carretera, alrededores, tierra o
     montaña según el tipo de calle, si es de tierra, la altura
     y la velocidad. Cambia con calma (el cambio tiene que
     mantenerse 15 s y pasa como mucho uno cada 40 s).

   Sin internet o sin GPS no hace nada y todo sigue igual.
   ========================================================= */
(function () {
  'use strict';

  var SERVIDORES = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  var RADIO = 500, RECARGAR_A = 300, MIN_ENTRE_PEDIDOS = 20000, ESPERA_ERROR = 60000;
  var TOLERANCIA_EXCESO = 5;   // km/h por encima del límite antes de avisar
  var TIPOS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|road|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
  var CARRETERA = /^(motorway|trunk|primary)(_link)?$/;
  var BARRIO = /^(residential|living_street|service)$/;
  var TIERRA = /^(unpaved|dirt|gravel|fine_gravel|ground|compacted|sand|earth|mud|grass|pebblestone|rock)$/;
  var ALTURA_MONTANA = 700;    // metros sobre el nivel del mar

  var estado = {
    area: null, pidiendo: false, ultimoPedido: 0, esperarHasta: 0, error: null,
    calle: null, limite: null, excesoDesde: 0, exceso: false,
    escenaCandidata: null, candidataDesde: 0, ultimoCambio: 0, razon: '',
  };

  var casillaAuto = document.getElementById('escena-auto');
  var tarjetaVel = document.querySelector('.w-vel');
  function $(n) { return document.querySelector('[data-w="' + n + '"]'); }
  function poner(n, t) { var e = $(n); if (e && e.textContent !== t) e.textContent = t; }

  try { estado.area = JSON.parse(localStorage.getItem('jimny-calles') || 'null'); } catch (e) { estado.area = null; }

  // ---------- Geometría (plano local en metros, suficiente para 1 km) ----------
  function aMetros(lat0, lon0) {
    var kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
    return function (lat, lon) { return [(lon - lon0) * kx, (lat - lat0) * ky]; };
  }

  function distanciaM(a, b) { var p = aMetros(a.lat, a.lon)(b.lat, b.lon); return Math.sqrt(p[0] * p[0] + p[1] * p[1]); }

  // ---------- Descarga de calles ----------
  function necesitaArea(p) {
    return !estado.area || distanciaM(estado.area.centro, p) > RECARGAR_A;
  }

  function pedirArea(p) {
    var ahora = Date.now();
    if (estado.pidiendo || ahora - estado.ultimoPedido < MIN_ENTRE_PEDIDOS || ahora < estado.esperarHasta) return;
    if (!window.fetch || navigator.onLine === false) return;
    estado.pidiendo = true; estado.ultimoPedido = ahora;
    var consulta = '[out:json][timeout:20];way(around:' + RADIO + ',' + p.lat.toFixed(5) + ',' + p.lon.toFixed(5) + ')["highway"~"^(' + TIPOS + ')$"];out tags geom qt;';
    intentar(0);

    function intentar(i) {
      fetch(SERVIDORES[i], { method: 'POST', body: 'data=' + encodeURIComponent(consulta), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
        .then(function (r) {
          if (r.status === 429 || r.status === 504) throw new Error('ocupado ' + r.status);
          if (!r.ok) throw new Error('error ' + r.status);
          return r.json();
        })
        .then(function (j) {
          estado.area = { centro: { lat: p.lat, lon: p.lon }, cuando: Date.now(), calles: convertir(j) };
          estado.error = null;
          try { localStorage.setItem('jimny-calles', JSON.stringify(estado.area)); } catch (e) { /* muy grande o sin almacenamiento */ }
          estado.pidiendo = false;
        })
        .catch(function (e) {
          if (i + 1 < SERVIDORES.length) { intentar(i + 1); return; }
          estado.error = e.message; estado.pidiendo = false; estado.esperarHasta = Date.now() + ESPERA_ERROR;
        });
    }
  }

  function convertir(j) {
    return (j.elements || []).filter(function (el) { return el.type === 'way' && el.geometry && el.geometry.length > 1; }).map(function (el) {
      var t = el.tags || {};
      return {
        id: el.id, nombre: t.name || t.ref || '', tipo: t.highway, superficie: t.surface || '',
        max: t.maxspeed || '', maxAdelante: t['maxspeed:forward'] || '', maxAtras: t['maxspeed:backward'] || '',
        unaVia: t.oneway === 'yes' || t.oneway === '1' || t.highway === 'motorway' || t.junction === 'roundabout',
        alReves: t.oneway === '-1',
        puntos: el.geometry.map(function (g) { return [g.lat, g.lon]; }),
      };
    });
  }

  // "60" -> 60, "40 mph" -> 64, "none" o "PA:urban" -> null
  function leerLimite(texto) {
    if (!texto) return null;
    var m = /^\s*(\d+(?:\.\d+)?)\s*(mph)?\s*$/.exec(texto);
    if (!m) return texto === 'walk' ? 5 : null;
    var v = parseFloat(m[1]);
    return m[2] ? Math.round(v * 1.609) : v;
  }

  // ---------- Calle más cercana ----------
  // Puntaje de una calle: distancia al carro en metros, más una penalidad si la calle
  // no va en la dirección del rumbo (hasta 40 m en calles de una vía, 20 m en las demás)
  function puntuar(c, proy, rumbo, maxDist) {
    var mejor = null;
    for (var i = 0; i < c.puntos.length - 1; i++) {
      var a = proy(c.puntos[i][0], c.puntos[i][1]), b = proy(c.puntos[i + 1][0], c.puntos[i + 1][1]);
      var dx = b[0] - a[0], dy = b[1] - a[1], largo2 = dx * dx + dy * dy;
      var t = largo2 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / largo2)) : 0;
      var dist = Math.sqrt(Math.pow(a[0] + t * dx, 2) + Math.pow(a[1] + t * dy, 2));
      if (dist > maxDist) continue;
      var puntaje = dist, adelante = true;
      if (rumbo !== null && largo2 > 1) {
        var rSeg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
        var dif = Math.abs(((rumbo - rSeg) + 540) % 360 - 180); // 0 = mismo sentido del dibujo, 180 = contrario
        adelante = dif <= 90;
        if (c.unaVia || c.alReves) puntaje += (c.alReves ? 180 - dif : dif) / 180 * 40;
        else puntaje += Math.min(dif, 180 - dif) / 90 * 20;
      }
      if (!mejor || puntaje < mejor.puntaje) mejor = { calle: c, puntaje: puntaje, adelante: adelante, dist: dist };
    }
    return mejor;
  }

  function buscarCalle(p, rumbo, precision) {
    if (!estado.area || !estado.area.calles.length) return null;
    var proy = aMetros(p.lat, p.lon), mejor = null, actual = null;
    var maxDist = Math.max(25, (precision || 10) + 10);
    var idActual = estado.calle ? estado.calle.calle.id : null;
    estado.area.calles.forEach(function (c) {
      var r = puntuar(c, proy, rumbo, maxDist);
      if (!r) return;
      if (c.id === idActual) actual = r;
      if (!mejor || r.puntaje < mejor.puntaje) mejor = r;
    });
    // Histéresis: no saltar a otra calle por pocos metros (cruces, calles paralelas)
    if (actual && mejor && actual !== mejor && actual.puntaje <= mejor.puntaje + 6) return actual;
    return mejor;
  }

  function limiteDe(m) {
    var c = m.calle;
    var porSentido = m.adelante !== c.alReves ? c.maxAdelante : c.maxAtras;
    return leerLimite(porSentido) || leerLimite(c.max);
  }

  // ---------- Escena automática ----------
  function escenaPara(d, kmh) {
    if (typeof d.altitud === 'number' && d.altitud >= ALTURA_MONTANA) return { escena: 'montana', razon: 'altura ' + Math.round(d.altitud) + ' m' };
    var c = estado.calle && estado.calle.calle;
    if (c) {
      if (c.tipo === 'track' || TIERRA.test(c.superficie)) return { escena: 'tierra', razon: 'camino de tierra' };
      if (CARRETERA.test(c.tipo)) return { escena: 'carretera', razon: 'vía principal' };
      if (BARRIO.test(c.tipo)) return { escena: 'alrededores', razon: 'calle de barrio' };
    }
    if (kmh === null || kmh < 3) return null; // detenido: se queda como está
    return kmh >= 60 ? { escena: 'carretera', razon: 'más de 60 km/h' } : { escena: 'alrededores', razon: 'menos de 60 km/h' };
  }

  function escenaActual() {
    var r = document.querySelector('input[name="escena"]:checked');
    return r ? r.id.replace('esc-', '') : 'carretera';
  }

  function decidirEscena(d, kmh, ahora) {
    if (!casillaAuto || !casillaAuto.checked) return;
    var obj = escenaPara(d, kmh);
    if (!obj) return;
    estado.razon = obj.razon;
    if (obj.escena === escenaActual()) { estado.escenaCandidata = null; return; }
    if (estado.escenaCandidata !== obj.escena) { estado.escenaCandidata = obj.escena; estado.candidataDesde = ahora; return; }
    if (ahora - estado.candidataDesde >= 15000 && ahora - estado.ultimoCambio >= 40000) {
      var radio = document.getElementById('esc-' + obj.escena);
      if (radio) { radio.checked = true; estado.ultimoCambio = ahora; estado.escenaCandidata = null; }
    }
  }

  // Elegir una escena a mano apaga el modo automático
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t && t.name === 'escena' && casillaAuto && casillaAuto.checked) casillaAuto.checked = false;
    if (t === casillaAuto || (t && t.name === 'escena')) {
      try { localStorage.setItem('jimny-escena-auto', casillaAuto.checked ? '1' : '0'); } catch (e) { /* nada */ }
    }
  });
  try { if (casillaAuto && localStorage.getItem('jimny-escena-auto') === '1') casillaAuto.checked = true; } catch (e) { /* nada */ }

  // ---------- Cada posición del GPS ----------
  window.addEventListener('jimny-gps', function (ev) {
    var d = ev.detail || {};
    if (d.apagado) { estado.calle = null; estado.limite = null; pintar(null); return; }
    var p = { lat: d.latitud, lon: d.longitud };
    var kmh = d.fuente === 'equipo' ? d.kmh : d.kmhSuave;
    var t = typeof d.t === 'number' ? d.t : Date.now();
    if (necesitaArea(p)) pedirArea(p);
    var rumbo = d.rumbo !== null && d.rumbo !== undefined ? d.rumbo : (window.jimnyWidgets && window.jimnyWidgets.gps.rumbo !== null ? window.jimnyWidgets.gps.rumbo : null);
    estado.calle = buscarCalle(p, kmh >= 3 ? rumbo : null, d.precision);
    estado.limite = estado.calle ? limiteDe(estado.calle) : null;

    // Exceso: más de 5 km/h por encima del límite durante 3 s seguidos
    if (estado.limite && typeof kmh === 'number' && kmh > estado.limite + TOLERANCIA_EXCESO) {
      if (!estado.excesoDesde) estado.excesoDesde = t;
      estado.exceso = t - estado.excesoDesde >= 3000;
    } else { estado.excesoDesde = 0; estado.exceso = false; }

    decidirEscena(d, kmh, t);
    pintar(kmh);
  });

  function pintar() {
    var senal = $('limite');
    if (senal) {
      senal.textContent = estado.limite ? String(Math.round(estado.limite)) : '';
      senal.parentNode.classList.toggle('con-limite', !!estado.limite);
    }
    if (tarjetaVel) tarjetaVel.classList.toggle('exceso', estado.exceso);
    var c = estado.calle && estado.calle.calle;
    var texto = '';
    if (c) texto = (c.nombre || 'Calle sin nombre') + (estado.limite ? '' : ', sin límite en el mapa');
    else if (estado.area && window.jimnyWidgets && window.jimnyWidgets.gps.activo) texto = 'Fuera de las calles del mapa';
    poner('calle', texto);
  }

  window.jimnyMapa = { estado: estado, leerLimite: leerLimite, escenaPara: escenaPara, convertir: convertir };
})();
