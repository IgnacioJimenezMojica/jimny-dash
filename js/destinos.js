/* =========================================================
   destinos.js: tarjeta "Destino" y Ajustes > Destinos.

   - Lugares guardados (Mi casa, Casa de papá, Trabajo...) en
     db.js. Tocando la tarjeta se pasa al siguiente y, después
     del último, a ninguno.
   - Distancia y tiempo por carretera con OSRM (servidor público
     y gratis basado en OpenStreetMap, sin tráfico en vivo). Se
     pide al elegir el destino y luego cada tanto; entre pedidos
     se estima con lo que se ha avanzado.
   - Sin internet: distancia en línea recta x 1,3 a 40 km/h,
     marcada como aproximada.
   - A menos de 150 m dice "Llegaste" y al minuto se apaga.

   Para guardar un lugar: "Guardar donde estoy" (GPS), pegar
   coordenadas o un enlace largo de Google Maps, o buscar la
   dirección en OpenStreetMap (Nominatim).
   ========================================================= */
(function () {
  'use strict';

  var tarjeta = document.querySelector('.w-destino');
  var W = window.jimnyWidgets;
  var db = window.jimnyDB;
  if (!tarjeta || !W || !db) return;

  var OSRM = 'https://router.project-osrm.org/route/v1/driving/';
  var NOMINATIM = 'https://nominatim.openstreetmap.org/search';
  var LLEGADA_M = 150, APAGAR_LLEGADA_MS = 60000;
  var MIN_ENTRE_RUTAS = 30000, ESPERA_ERROR = 60000;
  var RECALCULAR_MOVIDO = 1000, RECALCULAR_MS = 3 * 60000;
  var FACTOR_SIN_RUTA = 1.3, VEL_SIN_RUTA = 40; // km/h

  var estado = { ruta: null, pidiendo: false, ultimoPedido: 0, esperarHasta: 0, llegada: null };

  function $(n) { return tarjeta.querySelector('[data-w="' + n + '"]'); }
  function poner(n, t) { var e = $(n); if (e && e.textContent !== t) e.textContent = t; }

  function posicion() {
    if (W.gps.ultimo) return W.gps.ultimo;
    try { var p = JSON.parse(localStorage.getItem('jimny-pos') || 'null'); if (p && typeof p.lat === 'number') return p; } catch (e) { /* nada */ }
    return null;
  }

  // ---------- Ruta (OSRM) ----------
  function pedirRuta(pos, dest) {
    var ahora = Date.now();
    if (estado.pidiendo || ahora - estado.ultimoPedido < MIN_ENTRE_RUTAS || ahora < estado.esperarHasta) return;
    if (!window.fetch || navigator.onLine === false) return;
    estado.pidiendo = true; estado.ultimoPedido = ahora;
    var url = OSRM + pos.lon.toFixed(5) + ',' + pos.lat.toFixed(5) + ';' + dest.lon.toFixed(5) + ',' + dest.lat.toFixed(5) + '?overview=false&alternatives=false&steps=false';
    fetch(url).then(function (r) { if (!r.ok) throw new Error('error ' + r.status); return r.json(); }).then(function (j) {
      estado.pidiendo = false;
      if (!j || j.code !== 'Ok' || !j.routes || !j.routes[0]) throw new Error(j && j.code || 'sin ruta');
      estado.ruta = { destId: dest.id, desde: { lat: pos.lat, lon: pos.lon }, metros: j.routes[0].distance, segundos: j.routes[0].duration, cuando: Date.now() };
      pintar();
    }).catch(function () {
      estado.pidiendo = false; estado.esperarHasta = Date.now() + ESPERA_ERROR;
      pintar();
    });
  }

  // Lo que falta: con la ruta, se escala por lo que se ha acercado en línea recta
  function calcular(pos, dest) {
    var recta = W.distancia(pos, dest);
    var r = estado.ruta && estado.ruta.destId === dest.id ? estado.ruta : null;
    if (r && r.metros > 0) {
      var rectaAntes = Math.max(50, W.distancia(r.desde, dest));
      var metros = Math.max(recta, r.metros * Math.min(1.2, recta / rectaAntes));
      return { recta: recta, metros: metros, segundos: metros / r.metros * r.segundos, aprox: false };
    }
    var m = recta * FACTOR_SIN_RUTA;
    return { recta: recta, metros: m, segundos: m / (VEL_SIN_RUTA / 3.6), aprox: true };
  }

  function necesitaRuta(pos, dest) {
    var r = estado.ruta;
    if (!r || r.destId !== dest.id) return true;
    var movido = W.distancia(r.desde, pos);
    return movido > RECALCULAR_MOVIDO || (Date.now() - r.cuando > RECALCULAR_MS && movido > 300);
  }

  // ---------- Pintar ----------
  function textoKm(m) { return m < 1000 ? Math.max(10, Math.round(m / 10) * 10) + ' m' : W.numero(m / 1000, m < 10000 ? 1 : 0) + ' km'; }
  function textoTiempo(s) {
    var min = Math.max(1, Math.round(s / 60));
    if (min < 60) return min + ' min';
    var h = Math.floor(min / 60), r = min % 60;
    return h + ' h' + (r ? ' ' + r + ' min' : '');
  }

  function pintar() {
    var lista = db.datos().destinos.lista;
    var dest = db.destinoActivo();
    tarjeta.classList.toggle('sin-dato', !dest);
    tarjeta.classList.remove('llegaste');
    if (!lista.length) { poner('dest-nombre', 'Sin destinos'); poner('dest-dist', ''); poner('dest-nota', 'Agrégalos en Ajustes'); return; }
    if (!dest) { estado.llegada = null; poner('dest-nombre', 'Ninguno'); poner('dest-dist', ''); poner('dest-nota', 'Toca para elegir'); return; }
    poner('dest-nombre', dest.nombre);
    var pos = posicion();
    if (!pos) { poner('dest-dist', 'Activa el GPS'); poner('dest-nota', 'Toca para cambiar'); return; }
    var c = calcular(pos, dest);
    if (c.recta <= LLEGADA_M || (estado.llegada && estado.llegada.id === dest.id)) {
      if (!estado.llegada || estado.llegada.id !== dest.id) estado.llegada = { id: dest.id, cuando: Date.now() };
      tarjeta.classList.add('llegaste');
      poner('dest-dist', 'Llegaste');
      poner('dest-nota', 'Toca para elegir otro');
      if (Date.now() - estado.llegada.cuando > APAGAR_LLEGADA_MS) { estado.llegada = null; db.activarDestino(null); }
      return;
    }
    poner('dest-dist', textoKm(c.metros) + ', ' + textoTiempo(c.segundos));
    var llega = new Date(W.ahora().getTime() + c.segundos * 1000);
    poner('dest-nota', 'Llegas ' + W.horaCorta(llega) + (c.aprox ? ' (aprox.)' : ''));
  }

  function actualizar() {
    var dest = db.destinoActivo(), pos = posicion();
    if (dest && pos && W.tarjetaVisible('destino') && W.distancia(pos, dest) > LLEGADA_M && necesitaRuta(pos, dest)) pedirRuta(pos, dest);
    pintar();
  }

  window.addEventListener('jimny-gps', actualizar);
  window.addEventListener('jimny-db', pintar);
  window.addEventListener('online', function () { estado.esperarHasta = 0; actualizar(); });
  setInterval(pintar, 30000); // la hora de llegada avanza aunque el carro esté quieto

  function cambiar() {
    estado.llegada = null;
    estado.ultimoPedido = 0; estado.esperarHasta = 0; // un destino nuevo pide la ruta de una vez
    db.siguienteDestino();
    actualizar();
  }
  tarjeta.addEventListener('click', cambiar);
  tarjeta.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cambiar(); } });

  // ---------- Ajustes > Destinos ----------
  var panel = document.querySelector('.ajustes');
  function a(n) { return panel && panel.querySelector('[data-a="' + n + '"]'); }
  function mensaje(t) { var e = a('dest-msg'); if (e) e.textContent = t; }
  function campo(id) { return document.getElementById(id); }

  // Coordenadas escritas o dentro de un enlace largo de Google Maps
  function leerCoordenadas(texto) {
    texto = String(texto || '').trim();
    if (!texto) return null;
    var patrones = [
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,          // datos del lugar en el enlace
      /[?&](?:q|query|ll|destination|center)=(-?\d+(?:\.\d+)?)(?:,|%2C)\s*(-?\d+(?:\.\d+)?)/i,
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,              // centro del mapa
      /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/, // 8.9824, -79.5199
    ];
    for (var i = 0; i < patrones.length; i++) {
      var m = patrones[i].exec(texto);
      if (m) {
        var lat = parseFloat(m[1]), lon = parseFloat(m[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat: lat, lon: lon };
      }
    }
    return null;
  }

  function nombreEscrito() { var e = campo('a-dest-nombre'); return e ? e.value.trim() : ''; }

  function guardarLugar(nombre, lat, lon, origen) {
    if (!nombre) { mensaje('Primero escribe el nombre (por ejemplo: Mi casa).'); return false; }
    var d = db.agregarDestino(nombre, lat, lon);
    if (!d) { mensaje('No se pudo guardar, revisa los datos.'); return false; }
    mensaje('Guardado: ' + d.nombre + ' (' + origen + ').');
    campo('a-dest-nombre').value = '';
    pintarLista();
    return true;
  }

  function pintarLista() {
    var ul = a('destinos');
    if (!ul) return;
    var d = db.datos().destinos;
    ul.innerHTML = '';
    if (!d.lista.length) { var vacio = document.createElement('li'); vacio.textContent = 'Todavía no hay destinos guardados.'; ul.appendChild(vacio); return; }
    d.lista.forEach(function (x) {
      var li = document.createElement('li');
      li.className = 'a-destino' + (x.id === d.activo ? ' activo' : '');
      var txt = document.createElement('span');
      txt.textContent = x.nombre + (x.id === d.activo ? ' (elegido)' : '');
      var pos = posicion();
      if (pos) {
        var km = document.createElement('small');
        km.textContent = ' ' + textoKm(W.distancia(pos, x)) + ' en línea recta';
        txt.appendChild(km);
      }
      var ir = document.createElement('button');
      ir.type = 'button'; ir.className = 'boton chico'; ir.textContent = x.id === d.activo ? 'Quitar' : 'Ir';
      ir.setAttribute('data-dest-ir', x.id);
      var borrar = document.createElement('button');
      borrar.type = 'button'; borrar.className = 'boton chico peligro'; borrar.textContent = 'Borrar';
      borrar.setAttribute('data-dest-borrar', x.id);
      li.appendChild(txt); li.appendChild(ir); li.appendChild(borrar);
      ul.appendChild(li);
    });
  }

  function guardarAqui() {
    var nombre = nombreEscrito();
    if (!nombre) { mensaje('Primero escribe el nombre (por ejemplo: Mi casa).'); return; }
    var u = W.gps.ultimo;
    if (u && Date.now() - u.t < 60000 && W.gps.precision !== null && W.gps.precision <= 50) { guardarLugar(nombre, u.lat, u.lon, 'GPS, ±' + Math.round(W.gps.precision) + ' m'); return; }
    if (!('geolocation' in navigator)) { mensaje('Este navegador no tiene GPS.'); return; }
    mensaje('Buscando la posición...');
    navigator.geolocation.getCurrentPosition(function (p) {
      guardarLugar(nombre, p.coords.latitude, p.coords.longitude, 'GPS, ±' + Math.round(p.coords.accuracy) + ' m');
    }, function (e) {
      mensaje('No se pudo leer el GPS: ' + ({ 1: 'permiso negado', 2: 'sin posición', 3: 'tardó demasiado' }[e.code] || e.message) + '.');
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
  }

  function agregarCoordenadas() {
    var texto = campo('a-dest-coord').value;
    if (/goo\.gl|maps\.app/i.test(texto)) { mensaje('Ese es un enlace corto y no se puede leer desde aquí. En Google Maps deja el dedo sobre el lugar y copia los números (coordenadas).'); return; }
    var c = leerCoordenadas(texto);
    if (!c) { mensaje('No encontré coordenadas. Escríbelas así: 8.98240, -79.51990'); return; }
    if (guardarLugar(nombreEscrito(), c.lat, c.lon, 'coordenadas')) campo('a-dest-coord').value = '';
  }

  var resultados = [];
  function buscar() {
    var q = campo('a-dest-buscar').value.trim();
    var ul = a('dest-resultados');
    if (!q) { mensaje('Escribe qué buscar.'); return; }
    if (!window.fetch || navigator.onLine === false) { mensaje('Sin internet para buscar.'); return; }
    mensaje('Buscando...'); ul.innerHTML = '';
    var url = NOMINATIM + '?format=jsonv2&limit=5&countrycodes=pa&accept-language=es&q=' + encodeURIComponent(q);
    fetch(url).then(function (r) { if (!r.ok) throw new Error('error ' + r.status); return r.json(); }).then(function (lista) {
      resultados = (lista || []).map(function (x) { return { nombre: x.name || '', detalle: x.display_name || '', lat: parseFloat(x.lat), lon: parseFloat(x.lon) }; })
        .filter(function (x) { return !isNaN(x.lat) && !isNaN(x.lon); });
      if (!resultados.length) { mensaje('No encontré nada. Prueba con otro nombre o usa las coordenadas.'); return; }
      mensaje('Toca el resultado correcto para guardarlo:');
      resultados.forEach(function (x, i) {
        var li = document.createElement('li');
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'a-resultado'; b.setAttribute('data-dest-resultado', i);
        b.textContent = x.detalle;
        li.appendChild(b); ul.appendChild(li);
      });
    }).catch(function () { mensaje('El buscador no respondió. Intenta otra vez o usa las coordenadas.'); });
  }

  if (panel) {
    panel.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-accion], [data-dest-ir], [data-dest-borrar], [data-dest-resultado]');
      if (!b) return;
      var accion = b.getAttribute('data-accion');
      if (accion === 'dest-aqui') guardarAqui();
      else if (accion === 'dest-coord') agregarCoordenadas();
      else if (accion === 'dest-buscar') buscar();
      else if (b.hasAttribute('data-dest-ir')) {
        var id = b.getAttribute('data-dest-ir');
        estado.llegada = null; estado.ultimoPedido = 0; estado.esperarHasta = 0;
        db.activarDestino(db.datos().destinos.activo === id ? null : id);
        actualizar(); pintarLista();
      } else if (b.hasAttribute('data-dest-borrar')) {
        var idb = b.getAttribute('data-dest-borrar');
        if (b.classList.contains('armado')) { db.borrarDestino(idb); pintarLista(); mensaje('Destino borrado.'); }
        else { b.classList.add('armado'); b.textContent = 'Toca otra vez'; setTimeout(function () { b.classList.remove('armado'); b.textContent = 'Borrar'; }, 3000); }
      } else if (b.hasAttribute('data-dest-resultado')) {
        var x = resultados[+b.getAttribute('data-dest-resultado')];
        if (x && guardarLugar(nombreEscrito() || x.nombre, x.lat, x.lon, 'búsqueda')) { a('dest-resultados').innerHTML = ''; campo('a-dest-buscar').value = ''; }
      }
    });
    var casilla = document.getElementById('ajustes');
    if (casilla) casilla.addEventListener('change', function () { if (casilla.checked) { mensaje(''); pintarLista(); } });
    window.addEventListener('jimny-db', function () { if (casilla && casilla.checked) pintarLista(); });
  }

  pintar();
  pintarLista();
  window.jimnyDestinos = { leerCoordenadas: leerCoordenadas, calcular: calcular, estado: estado, pintar: pintar, actualizar: actualizar };
})();
