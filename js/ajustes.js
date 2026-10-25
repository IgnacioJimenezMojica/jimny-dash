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
      db.guardar(); aviso('Gasolina guardada.');
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
        db.borrarTodo(); try { localStorage.removeItem('jimny-viaje'); } catch (e) { /* nada */ }
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

  casilla.addEventListener('change', function () { if (casilla.checked) { aviso(''); cargarFormulario(); pintarPantalla(); } });
  window.addEventListener('jimny-db', function () { if (casilla.checked) pintar(); });

  window.jimnyAjustes = { pintar: pintar, cargar: cargarFormulario };
})();
