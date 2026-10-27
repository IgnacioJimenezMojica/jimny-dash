/* =========================================================
   zonas.js: la escena aprende de lo que Nacho elige a mano.

   - El mapa se divide en cuadros de 0,002 grados (unos 220 m
     en Panamá), solo con las coordenadas: no necesita internet.
   - Mientras maneja con una escena puesta A MANO (no en Auto),
     cada cuadro por donde pasa suma un voto para esa escena.
     Solo en movimiento y si la escena lleva 30 s o más puesta,
     para no aprender cambios de prueba. Un voto por cuadro cada
     10 s como mucho.
   - En Auto, mapa.js pregunta primero aquí: si el cuadro y sus
     vecinos tienen suficientes votos de una escena, se usa esa.
   - Los votos se topan: al llegar a 40 se reducen a la mitad,
     así una corrección se aprende sin tener que pasar mil veces.
   - Se guarda en localStorage ("jimny-zonas") y entra en el
     respaldo. Unos 30 bytes por cuadro.
   ========================================================= */
(function () {
  'use strict';

  var CLAVE = 'jimny-zonas';
  var TAM = 0.002;                 // grados por cuadro
  var ESCENAS = ['carretera', 'tierra', 'montana', 'alrededores', 'ciudad'];
  var NOMBRES = { carretera: 'Carretera', tierra: 'Tierra', montana: 'Montaña', alrededores: 'Pueblo', ciudad: 'Ciudad' };
  var VEL_MIN = 8;                 // km/h para aprender
  var ESCENA_FIRME_MS = 30000;     // la escena tiene que llevar 30 s puesta
  var ENTRE_VOTOS_MS = 10000;      // un voto por cuadro cada 10 s
  var TOPE = 40;
  var MIN_VOTOS = 3, MIN_PARTE = 0.6;

  var datos = leer();
  var ultimoVoto = {};             // cuadro -> hora del último voto (solo en memoria)
  var escenaDesde = Date.now();
  var pendiente = false;

  function leer() {
    try {
      var d = JSON.parse(localStorage.getItem(CLAVE) || 'null');
      if (d && d.v === 1 && d.z && typeof d.z === 'object') return d;
    } catch (e) { /* nada */ }
    return { v: 1, z: {} };
  }

  function guardarPronto() {
    if (pendiente) return;
    pendiente = true;
    setTimeout(function () { pendiente = false; guardar(); }, 5000);
  }
  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(datos)); } catch (e) { /* lleno o sin almacenamiento */ }
  }
  window.addEventListener('pagehide', guardar);

  function cuadro(lat, lon) { return Math.floor(lat / TAM) + ',' + Math.floor(lon / TAM); }

  function aprendiendo() {
    var db = window.jimnyDB;
    var e = db && db.datos().escenas;
    return !e || e.aprender !== false;
  }

  function escenaActual() {
    var r = document.querySelector('input[name="escena"]:checked');
    return r ? r.id.replace('esc-', '') : null;
  }

  // Cambio de escena: empieza a contar los 30 s
  document.addEventListener('change', function (ev) {
    if (ev.target && ev.target.name === 'escena') escenaDesde = Date.now();
  });

  function votar(lat, lon, escena, ahora) {
    var i = ESCENAS.indexOf(escena);
    if (i < 0) return;
    var k = cuadro(lat, lon);
    if (ultimoVoto[k] && ahora - ultimoVoto[k] < ENTRE_VOTOS_MS) return;
    ultimoVoto[k] = ahora;
    var v = datos.z[k] || (datos.z[k] = [0, 0, 0, 0, 0]);
    v[i]++;
    if (v[i] >= TOPE) for (var j = 0; j < v.length; j++) v[j] = Math.floor(v[j] / 2);
    guardarPronto();
  }

  // Escena aprendida para un punto: el cuadro pesa doble y sus 8 vecinos uno
  function sugerir(lat, lon) {
    var fi = Math.floor(lat / TAM), co = Math.floor(lon / TAM);
    var suma = [0, 0, 0, 0, 0], total = 0;
    for (var a = -1; a <= 1; a++) {
      for (var b = -1; b <= 1; b++) {
        var v = datos.z[(fi + a) + ',' + (co + b)];
        if (!v) continue;
        var peso = a === 0 && b === 0 ? 2 : 1;
        for (var j = 0; j < 5; j++) { suma[j] += v[j] * peso; total += v[j] * peso; }
      }
    }
    if (!total) return null;
    var mejor = 0;
    for (var m = 1; m < 5; m++) if (suma[m] > suma[mejor]) mejor = m;
    var parte = suma[mejor] / total;
    if (suma[mejor] < MIN_VOTOS || parte < MIN_PARTE) return { escena: null, votos: suma, parte: parte };
    return { escena: ESCENAS[mejor], votos: suma, parte: parte, razon: 'aprendido aquí (' + Math.round(parte * 100) + ' % de ' + total + ' votos)' };
  }

  function votosDe(lat, lon) { return datos.z[cuadro(lat, lon)] || null; }

  function olvidar(lat, lon) {
    var fi = Math.floor(lat / TAM), co = Math.floor(lon / TAM), n = 0;
    for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) {
      var k = (fi + a) + ',' + (co + b);
      if (datos.z[k]) { delete datos.z[k]; n++; }
    }
    guardar();
    return n;
  }

  function borrarTodo() { datos = { v: 1, z: {} }; ultimoVoto = {}; guardar(); }
  function cantidad() { return Object.keys(datos.z).length; }

  window.addEventListener('jimny-gps', function (ev) {
    var d = ev.detail || {};
    if (d.apagado || typeof d.latitud !== 'number') return;
    if (!aprendiendo()) return;
    var auto = document.getElementById('escena-auto');
    if (auto && auto.checked) return;                 // en Auto no aprende de sí mismo
    var kmh = d.fuente === 'equipo' ? d.kmh : d.kmhSuave;
    if (typeof kmh !== 'number' || kmh < VEL_MIN) return;
    if (typeof d.precision === 'number' && d.precision > 50) return;
    var ahora = typeof d.t === 'number' ? d.t : Date.now();
    if (Date.now() - escenaDesde < ESCENA_FIRME_MS) return;
    votar(d.latitud, d.longitud, escenaActual(), ahora);
  });

  window.jimnyZonas = {
    sugerir: sugerir, votosDe: votosDe, olvidar: olvidar, borrarTodo: borrarTodo, cantidad: cantidad,
    cuadro: cuadro, guardar: guardar, ESCENAS: ESCENAS, NOMBRES: NOMBRES,
    exportar: function () { return datos; },
    importar: function (d) { if (d && d.v === 1 && d.z) { datos = d; guardar(); } },
  };
})();
