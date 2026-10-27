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
   - Zona: en la misma consulta pregunta en qué zonas está el
     punto (is_in: landuse, place) y cuenta edificios a 150 m y
     tiendas a 200 m. Con eso separa ciudad de pueblo.
   - Escena automática, en este orden:
       1. lo aprendido de lo que Nacho elige a mano (zonas.js)
       2. altura de 700 m o más: montaña
       3. camino de tierra: tierra
       4. autopista o troncal: carretera
       5. zona de ciudad, barriada o pueblo según el mapa
       6. tipo de calle y, si no hay datos, la velocidad
     Cambia con calma (el cambio tiene que mantenerse 15 s y
     pasa como mucho uno cada 40 s).

   Sin internet o sin GPS no hace nada y todo sigue igual.
   ========================================================= */
(function () {
  'use strict';

  var SERVIDORES = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
  var RADIO = 500, RECARGAR_A = 300, MIN_ENTRE_PEDIDOS = 20000, ESPERA_ERROR = 60000;
  var TOLERANCIA_EXCESO = 5;   // km/h por encima del límite antes de avisar
  var TIPOS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|road|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
  var CARRETERA = /^(motorway|trunk|primary)(_link)?$/;
  var AUTOPISTA = /^(motorway|trunk)(_link)?$/;
  // Umbrales para separar ciudad y pueblo. Son iniciales: se afinan con el botón
  // "¿Qué dice el mapa aquí?" en recorridos reales (en Panamá no todo está dibujado).
  var CIUDAD_EDIFICIOS = 40, CIUDAD_TIENDAS = 6, PUEBLO_EDIFICIOS = 8;
  // Barriada: zona residencial con muchas casas juntas (en el mapa se parece a un pueblo; la diferencia es la densidad)
  var BARRIADA_EDIFICIOS = 25;
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
    var ll = p.lat.toFixed(5) + ',' + p.lon.toFixed(5);
    var consulta = '[out:json][timeout:20];' +
      'way(around:' + RADIO + ',' + ll + ')["highway"~"^(' + TIPOS + ')$"];out tags geom qt;' +
      // Zonas que contienen el punto (landuse, place, barrio)
      'is_in(' + ll + ')->.zonas;(area.zonas["landuse"];area.zonas["place"];);out tags;' +
      // Edificios y tiendas cerca: solo la cantidad
      'way(around:150,' + ll + ')["building"];out count;' +
      'nwr(around:200,' + ll + ')["shop"];out count;';
    intentar(0);

    function intentar(i) {
      fetch(SERVIDORES[i], { method: 'POST', body: 'data=' + encodeURIComponent(consulta), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
        .then(function (r) {
          if (r.status === 429 || r.status === 504) throw new Error('ocupado ' + r.status);
          if (!r.ok) throw new Error('error ' + r.status);
          return r.json();
        })
        .then(function (j) {
          estado.area = { centro: { lat: p.lat, lon: p.lon }, cuando: Date.now(), calles: convertir(j), zona: leerZona(j) };
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

  // Zona alrededor del punto: landuse, place, y cuántos edificios y tiendas hay
  function leerZona(j) {
    var z = { landuse: [], place: [], edificios: null, tiendas: null };
    var conteos = [];
    (j.elements || []).forEach(function (el) {
      var t = el.tags || {};
      if (el.type === 'area') {
        if (t.landuse && z.landuse.indexOf(t.landuse) < 0) z.landuse.push(t.landuse);
        if (t.place && z.place.indexOf(t.place) < 0) z.place.push(t.place);
      } else if (el.type === 'count') conteos.push(+(t.total || 0));
    });
    if (conteos.length >= 1) z.edificios = conteos[0];
    if (conteos.length >= 2) z.tiendas = conteos[1];
    return z;
  }

  // 'ciudad', 'barriada', 'pueblo' o null, con la razón
  function clasificarZona(z) {
    if (!z) return null;
    var lu = z.landuse || [], pl = z.place || [];
    var ed = z.edificios || 0, ti = z.tiendas || 0;
    var comercial = lu.indexOf('commercial') >= 0 || lu.indexOf('retail') >= 0;
    if (comercial) return { tipo: 'ciudad', razon: 'zona comercial' };
    if (ed >= CIUDAD_EDIFICIOS) return { tipo: 'ciudad', razon: ed + ' edificios cerca' };
    if (ti >= CIUDAD_TIENDAS) return { tipo: 'ciudad', razon: ti + ' tiendas cerca' };
    if (pl.indexOf('city') >= 0 && (ed >= 15 || ti >= 2)) return { tipo: 'ciudad', razon: 'dentro de una ciudad' };
    var barrio = pl.some(function (x) { return /^(suburb|neighbourhood|quarter)$/.test(x); });
    if ((lu.indexOf('residential') >= 0 || barrio) && ed >= BARRIADA_EDIFICIOS) return { tipo: 'barriada', razon: 'zona residencial con ' + ed + ' casas cerca' };
    if (lu.indexOf('residential') >= 0) return { tipo: 'pueblo', razon: 'zona residencial' };
    if (pl.some(function (x) { return /^(town|village|hamlet|suburb|neighbourhood|quarter|city)$/.test(x); })) return { tipo: 'pueblo', razon: 'dentro de un poblado' };
    if (ed >= PUEBLO_EDIFICIOS) return { tipo: 'pueblo', razon: ed + ' edificios cerca' };
    return null;
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
    // 1. Lo aprendido de lo que Nacho elige a mano
    if (window.jimnyZonas && typeof d.latitud === 'number') {
      var ap = window.jimnyZonas.sugerir(d.latitud, d.longitud);
      if (ap && ap.escena) return { escena: ap.escena, razon: ap.razon, fuente: 'aprendido' };
    }
    if (typeof d.altitud === 'number' && d.altitud >= ALTURA_MONTANA) return { escena: 'montana', razon: 'altura ' + Math.round(d.altitud) + ' m' };
    var c = estado.calle && estado.calle.calle;
    if (c && (c.tipo === 'track' || TIERRA.test(c.superficie))) return { escena: 'tierra', razon: 'camino de tierra' };
    if (c && AUTOPISTA.test(c.tipo)) return { escena: 'carretera', razon: 'autopista o troncal' };
    var zona = clasificarZona(estado.area && estado.area.zona);
    if (zona) return { escena: { ciudad: 'ciudad', barriada: 'barriada', pueblo: 'alrededores' }[zona.tipo], razon: zona.razon, fuente: 'mapa' };
    if (c) {
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

  // ---------- "¿Qué dice el mapa aquí?" (Ajustes > Sistema) ----------
  function diagnostico() {
    var W = window.jimnyWidgets, g = W && W.gps.ultimo;
    if (!g) return ['Activa el GPS y espera la primera posición.'];
    var lineas = [];
    var c = estado.calle && estado.calle.calle;
    lineas.push('Calle: ' + (c ? (c.nombre || 'sin nombre') + ' (tipo ' + c.tipo + (c.superficie ? ', superficie ' + c.superficie : '') + ')' : (estado.area ? 'ninguna del mapa cerca' : 'todavía sin datos del mapa')));
    lineas.push('Límite: ' + (estado.limite ? estado.limite + ' km/h' : 'no está en el mapa'));
    var z = estado.area && estado.area.zona;
    if (z) {
      lineas.push('Zona: ' + (z.landuse.length ? 'landuse ' + z.landuse.join(', ') : 'sin landuse') + '; ' + (z.place.length ? 'place ' + z.place.join(', ') : 'sin place'));
      lineas.push('Cerca: ' + (z.edificios === null ? '?' : z.edificios) + ' edificios a 150 m y ' + (z.tiendas === null ? '?' : z.tiendas) + ' tiendas a 200 m');
      var cz = clasificarZona(z);
      lineas.push('Según el mapa: ' + (cz ? { ciudad: 'Ciudad', barriada: 'Barriada', pueblo: 'Pueblo' }[cz.tipo] + ' (' + cz.razon + ')' : 'ni ciudad, ni barriada, ni pueblo'));
      var dist = Math.round(distanciaM(estado.area.centro, g));
      lineas.push('(Datos pedidos a ' + dist + ' m de aquí, ' + Math.round((Date.now() - estado.area.cuando) / 60000) + ' min atrás)');
    }
    if (window.jimnyZonas) {
      var Z = window.jimnyZonas, v = Z.votosDe(g.lat, g.lon), sug = Z.sugerir(g.lat, g.lon);
      lineas.push('Aprendido en este cuadro: ' + (v ? Z.ESCENAS.map(function (e, i) { return v[i] ? Z.NOMBRES[e] + ' ' + v[i] : ''; }).filter(Boolean).join(', ') : 'nada todavía'));
      if (sug && sug.escena) lineas.push('Con los vecinos: ' + Z.NOMBRES[sug.escena] + ' (' + Math.round(sug.parte * 100) + ' %)');
    }
    var e = escenaPara({ latitud: g.lat, longitud: g.lon, altitud: W.gps.altitud }, W.gps.vel);
    lineas.push('En Auto pondría: ' + (e ? (window.jimnyZonas ? window.jimnyZonas.NOMBRES[e.escena] : e.escena) + ' (' + e.razon + ')' : 'la que esté'));
    return lineas;
  }

  window.jimnyMapa = { estado: estado, leerLimite: leerLimite, escenaPara: escenaPara, convertir: convertir, leerZona: leerZona, clasificarZona: clasificarZona, diagnostico: diagnostico };
})();
