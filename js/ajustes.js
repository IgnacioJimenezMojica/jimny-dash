/* =========================================================
   ajustes.js: panel de Ajustes (odómetro, mantenimiento,
   gasolina, plan de viaje, historial, diagnóstico de la
   pantalla y respaldo).
   Todo se guarda con db.js en el navegador.
   ========================================================= */
(function () {
  'use strict';

  var db = window.jimnyDB;
  var panel = document.querySelector('.ajustes');
  var casilla = document.getElementById('ajustes');
  if (!db || !panel || !casilla) return;

  function $(id) { return document.getElementById(id); }
  function a(n) { return panel.querySelector('[data-a="' + n + '"]'); }
  function poner(n, t) { var e = a(n); if (e) e.textContent = t; }
  function num(n, dec) { return n.toLocaleString('es-PA', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 }); }
  function dinero(n) { return '$' + num(n, 2); }
  function fechaLarga(f) { return f.toLocaleDateString('es-PA', { day: 'numeric', month: 'long', year: 'numeric' }); }
  function hoyISO() {
    var f = window.jimnyLuz ? window.jimnyLuz.ahora() : new Date();
    return f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
  }
  function aviso(t) { poner('msg', t); }

  // ---------- Llenar el formulario con lo guardado ----------
  function cargarFormulario() {
    var d = db.datos();
    $('a-odo').value = '';
    $('a-mant-fecha').value = d.mantenimiento.fecha || '';
    $('a-mant-km').value = d.mantenimiento.km !== null ? Math.round(d.mantenimiento.km) : '';
    $('a-mant-meses').value = d.mantenimiento.meses;
    $('a-mant-kmint').value = d.mantenimiento.kmIntervalo;
    $('a-unidad').value = db.unidad();
    poner('precio-unidad', db.unidad() === 'litro' ? 'litro' : 'galón');
    $('a-precio').value = +db.precioEnUnidad().toFixed(3);
    $('a-tipo').value = d.combustible.tipo;
    $('a-consumo').value = d.combustible.consumoKmL;
    $('a-favoritas').value = (d.combustible.favoritas || []).join(', ');
    $('a-caja').value = d.combustible.caja === 'automatico' ? 'automatico' : 'manual';
    $('a-aire').value = d.combustible.aire === false ? 'no' : 'si';
    $('a-ralenti-aire').value = d.combustible.ralentiConAire;
    $('a-ralenti-sin').value = d.combustible.ralentiSinAire;
    $('a-tranque').value = window.jimnyConsumo ? window.jimnyConsumo.factorTranque() : 1.5;
    $('a-ll-precio').value = +db.precioLitro().toFixed(3);
    $('a-plan-km').value = d.plan.km || '';
    $('a-plan-iv').checked = !!d.plan.idaVuelta;
    pintar();
  }

  // ---------- Mostrar valores calculados ----------
  function pintar() {
    var d = db.datos();
    var odo = db.odometroKm();
    poner('odo', odo === null ? 'sin configurar' : num(odo) + ' km');

    var e = db.estadoMantenimiento(window.jimnyLuz ? window.jimnyLuz.ahora() : new Date());
    if (!e.configurado) poner('mant', 'Sin configurar: pon la fecha del último servicio.');
    else {
      var t = 'Próximo: ' + fechaLarga(e.proximaFecha) + ' (' + (e.dias > 0 ? 'en ' + e.dias + ' días' : 'ya pasó') + ')';
      if (e.kmFaltan !== null) t += ' o a los ' + num(d.mantenimiento.km + d.mantenimiento.kmIntervalo) + ' km (' + (e.kmFaltan > 0 ? 'faltan ' + num(e.kmFaltan) : 'ya pasó') + ')';
      poner('mant', t);
    }
    var lista = a('mant-hist');
    lista.innerHTML = '';
    d.mantenimiento.historial.slice(0, 5).forEach(function (h) {
      var li = document.createElement('li');
      li.textContent = fechaLarga(new Date(h.fecha + 'T12:00:00')) + (h.km !== null && h.km !== undefined ? ', ' + num(h.km) + ' km' : '');
      lista.appendChild(li);
    });

    var ck = db.costoPorKm();
    poner('costo-km', ck === null ? '' : 'Cuesta unos ' + dinero(ck) + ' por km (' + dinero(ck * 100) + ' cada 100 km).');
    var g = d.combustible.precioGalon;
    poner('precio-equiv', db.unidad() === 'litro' ? 'Equivale a ' + dinero(g) + ' el galón.' : 'Equivale a ' + dinero(g / db.GALON_L) + ' el litro.');
    poner('gas-ayuda', 'Valores iniciales: precio máximo de la gasolina de 91 ($1.28 el litro, $4.84 el galón) en Panamá y Colón desde el 16 de octubre de 2026 (cambia cada 15 días). ' +
      'Consumo: unos 12 km/l, lo que reportan dueños de Jimny 1.5 manual con parrilla y llantas AT; el dato de fábrica ronda 14 a 15 km/l.');

    var km = (+d.plan.km || 0) * (d.plan.idaVuelta ? 2 : 1);
    var cant = km > 0 ? db.cantidadDe(km) : null;
    if (km > 0 && ck !== null && cant) poner('plan', num(km) + ' km: ' + num(cant.valor, 1) + ' ' + cant.unidad + ', ' + dinero(db.costoDe(km)));
    else poner('plan', 'Escribe la distancia para calcular el costo.');

    pintarGasolina();

    var mes = db.resumenMes();
    poner('mes', 'Este mes: ' + num(mes.km, 1) + ' km en ' + mes.viajes + (mes.viajes === 1 ? ' viaje' : ' viajes') + ', ' + dinero(mes.costo) + ' en gasolina.');
    var lv = a('viajes');
    lv.innerHTML = '';
    d.viajes.slice(0, 6).forEach(function (v) {
      var li = document.createElement('li');
      var f = new Date(v.inicio);
      li.textContent = f.toLocaleDateString('es-PA', { day: 'numeric', month: 'short' }) + ' ' + f.toLocaleTimeString('es-PA', { hour: 'numeric', minute: '2-digit' }) +
        ': ' + num(v.km, 1) + ' km, ' + v.minutos + ' min' + (v.costo !== null && v.costo !== undefined ? ', ' + dinero(v.costo) : '');
      lv.appendChild(li);
    });
    if (!d.viajes.length) { var li = document.createElement('li'); li.textContent = 'Todavía no hay viajes guardados.'; lv.appendChild(li); }
  }

  // ---------- Tanque, lecturas del odómetro, llenados y consumo real ----------
  function opcionesRayitas(sel, conVacio) {
    if (sel.options.length) return;
    if (conVacio) { var o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'No me fijé'; sel.appendChild(o0); }
    for (var r = 0; r <= 10; r++) { var o = document.createElement('option'); o.value = r; o.textContent = r + (r === 10 ? ' (lleno)' : r === 5 ? ' (medio)' : ''); sel.appendChild(o); }
  }
  opcionesRayitas($('a-rayitas-ahora')); opcionesRayitas($('a-ll-antes'), true); opcionesRayitas($('a-ll-despues'));
  $('a-ll-despues').value = '10';
  function verDespues() { panel.querySelector('.a-ll-despues').hidden = $('a-ll-tope').checked; }
  $('a-ll-tope').addEventListener('change', verDespues); verDespues();

  function kmL(lPorKm) { return lPorKm > 0 ? num(1 / lPorKm, 1) : '?'; }

  function pintarGasolina() {
    var K = window.jimnyConsumo, d = db.datos();
    if (!K) return;
    // Tanque
    var t = K.tanque();
    poner('tanque-nivel', t ? 'Unas ' + num(Math.round(t.rayitas)) + ' de 10 rayitas (' + num(t.litros, 1) + ' L), para unos ' + num(Math.round(t.km / 10) * 10) + ' km' : 'Registra un llenado o corrige las rayitas para empezar.');
    if (t) $('a-rayitas-ahora').value = String(Math.round(t.rayitas));
    // Lecturas del odómetro con lo que la app no vio
    var ul = a('lecturas'), L = d.odometro.lecturas;
    ul.innerHTML = '';
    L.slice(0, 4).forEach(function (l, i) {
      var li = document.createElement('li'), txt = fechaLarga(new Date(l.fecha)) + ': ' + num(l.km) + ' km';
      var cob = L[i + 1] ? db.coberturaEntre(l, L[i + 1]) : null;
      if (cob) txt += '. Desde la anterior la app vio ' + num(cob.parte * 100) + ' % (' + num(cob.kmApp, 0) + ' de ' + num(cob.kmReal) + ' km)';
      li.textContent = txt; ul.appendChild(li);
    });
    // Consumo real
    var r = K.resumen(), cont = a('consumo-real'), lineas = [];
    if (r.kmL) lineas.push('<b>Consumo real: ' + num(r.kmL, 1) + ' km por litro</b> (últimos ' + r.ultimos + (r.ultimos === 1 ? ' tanque' : ' tanques') + ')');
    else lineas.push('Consumo real: hace falta un segundo llenado para calcularlo.');
    if (r.ultimo) lineas.push('Último tramo: ' + num(r.ultimo.kmReal) + ' km, ' + num(r.ultimo.gastado, 1) + ' L. ' + (r.ultimo.parte > 0 ? 'La app vio el ' + num(r.ultimo.parte * 100) + ' % de esos km.' : 'La app no vio esos km (no estaba abierta), así que no sirve para el desglose.'));
    var c = r.coef;
    lineas.push((r.aprendido ? 'Aprendido de ' + r.n + ' tanques' : 'Valores iniciales' + (r.n ? ' (ajustándose con ' + r.n + (r.n === 1 ? ' tanque' : ' tanques') + ')' : '')) + ': carretera ' + kmL(c[0]) + ' km/L, ciudad ' + kmL(c[1]) + ', tranque ' + kmL(c[2]) + ', detenido ' + num(c[3], 2) + ' L/h con aire y ' + num(c[4], 2) + ' sin aire.');
    if (r.rayitas.datos) lineas.push('Rayitas: cada una vale unos ' + num(r.rayitas.beta, 1) + ' L (aprendido de ' + r.rayitas.datos + ' llenados).');
    cont.innerHTML = lineas.map(function (x) { return '<p class="a-dato">' + x + '</p>'; }).join('');
    // Lista de llenados
    var ll = a('llenados');
    ll.innerHTML = '';
    var tr = {};
    K.tramos().forEach(function (f) { tr[f.fecha] = f; });
    d.consumo.llenados.slice().reverse().slice(0, 8).forEach(function (f) {
      var li = document.createElement('li'); li.className = 'a-llenado';
      var span = document.createElement('span');
      var x = tr[f.fecha];
      span.textContent = fechaLarga(new Date(f.fecha)) + ': ' + num(f.litros, 2) + ' L a los ' + num(f.km) + ' km' + (f.aTope ? '' : ' (no a tope)') +
        (typeof f.rayitasAntes === 'number' ? ', tenía ' + f.rayitasAntes + ' rayitas' : '') + (x ? '. ' + num(x.kmReal / x.gastado, 1) + ' km/L' : '');
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'boton chico peligro'; b.textContent = 'Borrar'; b.setAttribute('data-borrar-llenado', f.fecha);
      li.appendChild(span); li.appendChild(b); ll.appendChild(li);
    });
  }

  panel.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-borrar-llenado]');
    if (!b || !window.jimnyConsumo) return;
    if (b.classList.contains('armado')) { window.jimnyConsumo.borrarLlenado(b.getAttribute('data-borrar-llenado')); poner('ll-msg', 'Llenado borrado.'); pintar(); }
    else { b.classList.add('armado'); b.textContent = 'Toca otra vez'; setTimeout(function () { b.classList.remove('armado'); b.textContent = 'Borrar'; }, 3000); }
  });

  // Cambiar la caja: si el consumo era el inicial de la otra caja, pasa al de esta (12 manual, 11 automático)
  $('a-caja').addEventListener('change', function () {
    var c = db.datos().combustible, antes = c.caja === 'automatico' ? 11 : 12;
    c.caja = this.value;
    if (Math.abs(c.consumoKmL - antes) < 0.001) c.consumoKmL = c.caja === 'automatico' ? 11 : 12;
    db.guardar(); cargarFormulario(); aviso('Caja: ' + (c.caja === 'automatico' ? 'automática' : 'manual') + '.');
  });

  // ---------- Acciones ----------
  var borrarArmado = 0;
  panel.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-accion]');
    if (!b) return;
    var accion = b.getAttribute('data-accion');
    if (accion === 'odo') {
      var v = parseFloat($('a-odo').value);
      if (!(v >= 0)) { aviso('Escribe el kilometraje del tablero.'); return; }
      db.fijarOdometro(v); $('a-odo').value = ''; aviso('Odómetro guardado: ' + num(v) + ' km.');
    } else if (accion === 'mant') {
      var d = db.datos().mantenimiento;
      d.fecha = $('a-mant-fecha').value || null;
      d.km = $('a-mant-km').value === '' ? null : +$('a-mant-km').value;
      d.meses = Math.max(1, +$('a-mant-meses').value || 3);
      d.kmIntervalo = Math.max(0, +$('a-mant-kmint').value || 0);
      db.guardar(); aviso('Mantenimiento guardado.');
    } else if (accion === 'mant-hoy') {
      db.registrarMantenimiento(hoyISO(), db.odometroKm(), '');
      cargarFormulario(); aviso('Servicio registrado hoy.');
    } else if (accion === 'gas') {
      var c = db.datos().combustible;
      var precio = parseFloat($('a-precio').value), consumo = parseFloat($('a-consumo').value);
      if (!(precio > 0) || !(consumo > 0)) { aviso('Revisa el precio y el consumo.'); return; }
      c.unidad = $('a-unidad').value; db.fijarPrecio(precio, c.unidad); c.consumoKmL = consumo; c.tipo = $('a-tipo').value; c.precioFecha = hoyISO();
      c.favoritas = $('a-favoritas').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 5);
      c.aire = $('a-aire').value !== 'no';
      var ra = parseFloat($('a-ralenti-aire').value), rs = parseFloat($('a-ralenti-sin').value), ft = parseFloat($('a-tranque').value);
      if (ra > 0) c.ralentiConAire = ra;
      if (rs > 0) c.ralentiSinAire = rs;
      // El factor de tranque solo se guarda si es distinto al de la caja (así sigue a la caja si se cambia)
      var deCaja = c.caja === 'automatico' ? 1.6 : 1.5;
      c.factorTranque = ft >= 1 && Math.abs(ft - deCaja) > 0.001 ? ft : null;
      db.guardar(); aviso('Gasolina guardada.');
    } else if (accion === 'llenado') {
      try {
        var antes = $('a-ll-antes').value, tope = $('a-ll-tope').checked;
        var f = window.jimnyConsumo.agregarLlenado({
          litros: parseFloat($('a-ll-litros').value), km: parseFloat($('a-ll-km').value),
          rayitasAntes: antes === '' ? null : +antes, aTope: tope, rayitasDespues: tope ? null : +$('a-ll-despues').value,
          precioLitro: parseFloat($('a-ll-precio').value),
        });
        $('a-ll-litros').value = ''; $('a-ll-km').value = ''; $('a-ll-antes').value = '';
        poner('ll-msg', 'Llenado guardado: ' + num(f.litros, 2) + ' L. El odómetro quedó en ' + num(f.km) + ' km.');
        cargarFormulario();
      } catch (e) { poner('ll-msg', e.message); }
    } else if (accion === 'rayitas') {
      window.jimnyConsumo.corregirRayitas(+$('a-rayitas-ahora').value);
      poner('ll-msg', '');
    } else if (accion === 'exportar') {
      var texto = db.exportar();
      var url = URL.createObjectURL(new Blob([texto], { type: 'application/json' }));
      var enlace = document.createElement('a');
      enlace.href = url; enlace.download = 'jimny-respaldo-' + hoyISO() + '.json';
      document.body.appendChild(enlace); enlace.click(); enlace.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      aviso('Respaldo descargado.');
    } else if (accion === 'borrar') {
      if (Date.now() - borrarArmado < 3000) {
        db.borrarTodo(); try { localStorage.removeItem('jimny-viaje'); } catch (e) { /* nada */ } if (window.jimnyZonas) window.jimnyZonas.borrarTodo();
        borrarArmado = 0; b.textContent = 'Borrar todo'; cargarFormulario(); aviso('Datos borrados.');
      } else {
        borrarArmado = Date.now(); b.textContent = 'Toca otra vez para borrar';
        setTimeout(function () { if (Date.now() - borrarArmado >= 3000) b.textContent = 'Borrar todo'; }, 3100);
      }
    }
    pintar();
  });

  // ---------- Diagnóstico de la pantalla ----------
  function pintarPantalla() {
    var lista = a('diag-pantalla');
    var items = [
      'Pantalla: ' + innerWidth + ' x ' + innerHeight + ' px, densidad ' + (window.devicePixelRatio || 1),
      'Abierta como: ' + (location.protocol === 'file:' ? 'archivo local' : 'página web'),
      'Página segura (necesario para el GPS): ' + (window.isSecureContext ? 'sí' : 'no'),
      'Movimiento reducido: ' + (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'sí' : 'no'),
      'Internet según el navegador: ' + (navigator.onLine === false ? 'sin conexión' : 'conectado'),
    ];
    lista.innerHTML = '';
    items.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; lista.appendChild(li); });
  }

  function probarSensores() {
    poner('diag-sensores', 'Sensores: escuchando 4 segundos... (mueve un poco la pantalla si se puede)');
    if (!('DeviceOrientationEvent' in window) && !('DeviceMotionEvent' in window)) { poner('diag-sensores', 'Sensores: el navegador no los tiene.'); return; }
    var giro = null, mov = null;
    function alGirar(e) { if (e.beta !== null || e.gamma !== null) giro = e; }
    function alMover(e) { var g = e.accelerationIncludingGravity; if (g && (g.x !== null || g.y !== null)) mov = g; }
    function empezar() {
      window.addEventListener('deviceorientation', alGirar);
      window.addEventListener('devicemotion', alMover);
      setTimeout(function () {
        window.removeEventListener('deviceorientation', alGirar);
        window.removeEventListener('devicemotion', alMover);
        if (!giro && !mov) { poner('diag-sensores', 'Sensores: no hay datos. Esta pantalla no tiene sensores de movimiento (o el navegador no los entrega), así que el inclinómetro no se puede hacer.'); return; }
        poner('diag-sensores', 'Sensores: sí. ' + (giro ? 'Inclinación hacia adelante ' + Math.round(giro.beta) + ' grados, de lado ' + Math.round(giro.gamma) + ' grados. ' : '') + (mov ? 'Acelerómetro con datos. ' : '') + 'Se puede hacer el inclinómetro.');
      }, 4000);
    }
    if (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') {
      DeviceOrientationEvent.requestPermission().then(empezar).catch(function () { poner('diag-sensores', 'Sensores: permiso negado.'); });
    } else empezar();
  }

  function probarGPS() {
    if (!('geolocation' in navigator)) { poner('diag-gps', 'GPS: el navegador no lo tiene.'); return; }
    if (!window.isSecureContext) { poner('diag-gps', 'GPS: la página no es segura, el navegador no lo va a permitir.'); return; }
    poner('diag-gps', 'GPS: esperando posición (puede pedir permiso)...');
    navigator.geolocation.getCurrentPosition(function (p) {
      var c = p.coords, partes = ['GPS: sí', 'precisión ' + Math.round(c.accuracy) + ' m'];
      partes.push(typeof c.speed === 'number' && !isNaN(c.speed) ? 'da la velocidad (' + Math.round(c.speed * 3.6) + ' km/h), la más precisa' : 'no da la velocidad quieto; se ve mejor manejando o se calcula');
      partes.push(typeof c.altitude === 'number' ? 'altura ' + Math.round(c.altitude) + ' m' : 'sin altura');
      poner('diag-gps', partes.join(', ') + '.');
    }, function (e) {
      poner('diag-gps', 'GPS: ' + ({ 1: 'permiso negado', 2: 'sin posición (¿techo o túnel?)', 3: 'tardó demasiado' }[e.code] || e.message) + '.');
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }

  function probarInternet() {
    poner('diag-internet', 'Internet: probando clima y mapa...');
    var resultado = { clima: '...', mapa: '...' };
    function mostrar() { poner('diag-internet', 'Clima (Open-Meteo): ' + resultado.clima + '. Mapa de calles (OpenStreetMap): ' + resultado.mapa + '.'); }
    fetch('https://api.open-meteo.com/v1/forecast?latitude=8.98&longitude=-79.52&current=temperature_2m', { cache: 'no-store' })
      .then(function (r) { resultado.clima = r.ok ? 'responde' : 'error ' + r.status; }).catch(function () { resultado.clima = 'no responde'; }).then(mostrar);
    fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent('[out:json][timeout:5];node(1);out ids;'), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
      .then(function (r) { resultado.mapa = r.ok ? 'responde' : (r.status === 429 ? 'ocupado, probar luego' : 'error ' + r.status); }).catch(function () { resultado.mapa = 'no responde'; }).then(mostrar);
  }

  panel.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-accion]');
    if (!b) return;
    var accion = b.getAttribute('data-accion');
    if (accion === 'diag-sensores') probarSensores();
    else if (accion === 'diag-gps') probarGPS();
    else if (accion === 'diag-internet') probarInternet();
    else if (accion === 'diag-mapa') {
      var ul = a('diag-mapa'), lineas = window.jimnyMapa ? window.jimnyMapa.diagnostico() : ['El mapa no está disponible.'];
      ul.innerHTML = '';
      lineas.forEach(function (t) { var li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
    }
  });

  // Plan de viaje: se calcula mientras se escribe
  function guardarPlan() {
    var p = db.datos().plan;
    p.km = parseFloat($('a-plan-km').value) || 0;
    p.idaVuelta = $('a-plan-iv').checked;
    db.guardar(); pintar();
  }
  $('a-plan-km').addEventListener('input', guardarPlan);

  // Cambiar litros/galones: convierte el precio que se ve y lo guarda de una vez
  $('a-unidad').addEventListener('change', function () {
    var c = db.datos().combustible;
    var escrito = parseFloat($('a-precio').value);
    // Si cambió el número sin guardar, se toma; si no, se deja el precio exacto (sin arrastrar el redondeo)
    if (escrito > 0 && escrito !== +db.precioEnUnidad().toFixed(3)) db.fijarPrecio(escrito, c.unidad);
    c.unidad = this.value;
    db.guardar();
    poner('precio-unidad', c.unidad === 'litro' ? 'litro' : 'galón');
    $('a-precio').value = +db.precioEnUnidad().toFixed(3);
    pintar();
  });
  $('a-plan-iv').addEventListener('change', guardarPlan);

  $('a-importar').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    var lector = new FileReader();
    lector.onload = function () {
      try { db.importar(String(lector.result)); cargarFormulario(); aviso('Respaldo importado.'); }
      catch (e) { aviso('No se pudo importar: ' + e.message); }
    };
    lector.readAsText(f);
    this.value = '';
  });

  // ---------- Escenas aprendidas (zonas.js) ----------
  var zonaArmada = 0;
  function pintarZonas() {
    var Z = window.jimnyZonas;
    $('a-aprender').checked = db.datos().escenas.aprender !== false;
    poner('zonas', Z ? 'Zonas aprendidas: ' + Z.cantidad() : '');
  }
  $('a-aprender').addEventListener('change', function () { db.datos().escenas.aprender = this.checked; db.guardar(); });
  panel.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-accion]');
    if (!b || !window.jimnyZonas) return;
    var accion = b.getAttribute('data-accion'), Z = window.jimnyZonas;
    if (accion === 'zona-olvidar') {
      var g = window.jimnyWidgets && window.jimnyWidgets.gps.ultimo;
      if (!g) { poner('zonas', 'Activa el GPS para saber en qué zona estás.'); return; }
      var n = Z.olvidar(g.lat, g.lon);
      poner('zonas', n ? 'Listo: se olvidó esta zona y sus vecinas (' + n + ' cuadros). Quedan ' + Z.cantidad() + '.' : 'No había nada aprendido aquí.');
    } else if (accion === 'zonas-borrar') {
      if (Date.now() - zonaArmada < 3000) { Z.borrarTodo(); zonaArmada = 0; b.textContent = 'Borrar lo aprendido'; pintarZonas(); }
      else { zonaArmada = Date.now(); b.textContent = 'Toca otra vez para borrar'; setTimeout(function () { if (Date.now() - zonaArmada >= 3000) b.textContent = 'Borrar lo aprendido'; }, 3100); }
    }
  });

  // ---------- Pestañas (se recuerda la última) ----------
  var TABS = ['controles', 'pantalla', 'carro', 'gasolina', 'destinos', 'viajes', 'sistema'];
  function abrirTab(nombre) {
    if (TABS.indexOf(nombre) < 0) nombre = 'controles';
    var primero = true;
    panel.querySelectorAll('[data-tab]').forEach(function (sec) {
      sec.hidden = sec.getAttribute('data-tab') !== nombre;
      sec.classList.toggle('primero', !sec.hidden && primero);
      if (!sec.hidden) primero = false;
    });
    panel.querySelectorAll('[data-ir-tab]').forEach(function (b) {
      var activa = b.getAttribute('data-ir-tab') === nombre;
      b.classList.toggle('activa', activa);
      b.setAttribute('aria-selected', activa ? 'true' : 'false');
    });
    panel.scrollTop = 0;
    try { localStorage.setItem('jimny-ajustes-tab', nombre); } catch (e) { /* sin almacenamiento */ }
  }
  panel.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-ir-tab]');
    if (b) abrirTab(b.getAttribute('data-ir-tab'));
  });
  var tabGuardada = null;
  try { tabGuardada = localStorage.getItem('jimny-ajustes-tab'); } catch (e) { /* nada */ }
  abrirTab(tabGuardada);

  // ---------- Tarjetas que se ven ----------
  function pintarTarjetas() {
    var cont = a('tarjetas'), W = window.jimnyWidgets;
    if (!cont || !W) return;
    cont.innerHTML = '';
    Object.keys(W.NOMBRES_TARJETAS).forEach(function (clave) {
      var etiqueta = document.createElement('label');
      etiqueta.className = 'a-check a-tarjeta';
      var c = document.createElement('input');
      c.type = 'checkbox'; c.checked = W.tarjetaVisible(clave); c.setAttribute('data-tarjeta-ver', clave);
      etiqueta.appendChild(c);
      etiqueta.appendChild(document.createTextNode(' ' + W.NOMBRES_TARJETAS[clave]));
      cont.appendChild(etiqueta);
    });
  }
  panel.addEventListener('change', function (ev) {
    var c = ev.target.closest('[data-tarjeta-ver]');
    if (c && window.jimnyWidgets) window.jimnyWidgets.fijarTarjeta(c.getAttribute('data-tarjeta-ver'), c.checked);
  });

  casilla.addEventListener('change', function () { if (casilla.checked) { aviso(''); cargarFormulario(); pintarPantalla(); pintarTarjetas(); pintarZonas(); } });
  window.addEventListener('jimny-db', function () { if (casilla.checked) pintar(); });

  window.jimnyAjustes = { pintar: pintar, cargar: cargarFormulario, abrirTab: abrirTab };
})();
