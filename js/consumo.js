/* =========================================================
   consumo.js: gasolina real del Jimny.

   Lo que se va anotando mientras se maneja (con el GPS):
   - km en carretera (fluido a 60 km/h o más)
   - km en ciudad (fluido a menos de 60 km/h)
   - km en tranque: si el último kilómetro se hizo a menos de
     15 km/h de promedio (contando las paradas cortas), se marca
     tranque; se quita cuando los últimos 300 m van a más de 25.
   - tiempo detenido con el motor encendido, con o sin aire.

   Con eso se calcula lo gastado:
     litros = km carretera x a + km ciudad x b + km tranque x c
            + horas detenido con aire x d + horas sin aire x e

   Valores iniciales (investigados, ver contexto/Próxima actualización.md):
   - km por litro del usuario (12 en el manual con parrilla y AT),
     un 8 % mejor en movimiento (el promedio ya traía semáforos);
     carretera un 10 % mejor y ciudad un 5 % peor que eso.
   - tranque: 1,5 veces lo de ciudad en manual, 1,6 en automático.
   - detenido: 0,8 L/h con aire y 0,5 sin aire.

   Consumo aprendido: con los llenados (litros, km del tablero y
   rayitas) se ajustan a, b, c, d y e con una regresión lineal
   sin intercepto, regularizada hacia los valores iniciales
   (tipo ridge): con pocos llenados mandan los iniciales y con
   más llenados mandan los datos. Los coeficientes no bajan de
   cero. Los km que la app no vio (pantalla sin abrir) se
   reparten en proporción y ese tramo pesa menos.

   También lleva el nivel del tanque en vivo y aprende cuántos
   litros vale cada rayita del tablero (10 rayitas, tanque de 40 L).
   ========================================================= */
(function () {
  'use strict';

  var db = window.jimnyDB;
  if (!db) return;

  var VEL_CARRETERA = 60, TRANQUE_ENTRA = 15, TRANQUE_SALE = 25;
  var VENTANA_TRANQUE = 1000, VENTANA_SALIDA = 300, PARADA_MAX_S = 180;
  var RAYITAS = 10;

  function C() { return db.datos().combustible; }
  function M() { return db.datos().consumo; }

  // ---------- Coeficientes ----------
  function factorTranque() {
    var c = C();
    return c.factorTranque > 0 ? c.factorTranque : (c.caja === 'automatico' ? 1.6 : 1.5);
  }

  // Valores iniciales en litros por km (a, b, c) y litros por hora (d, e)
  function iniciales() {
    var c = C(), kmL = c.consumoKmL > 0 ? c.consumoKmL : 12;
    var mov = kmL * 1.08;
    var ciudad = 1 / (mov * 0.95);
    return [1 / (mov * 1.1), ciudad, ciudad * factorTranque(), c.ralentiConAire > 0 ? c.ralentiConAire : 0.8, c.ralentiSinAire > 0 ? c.ralentiSinAire : 0.5];
  }

  // ---------- Llenados y regresión ----------
  function porRayita() { return calibrarRayitas(); }

  // Nivel del tanque (litros) a partir de las rayitas, con la calibración aprendida
  function litrosDeRayitas(r) { var k = porRayita(); return Math.max(0, Math.min(tanqueL(), k.alfa + k.beta * r)); }
  function rayitasDeLitros(l) { var k = porRayita(); return Math.max(0, Math.min(RAYITAS, (l - k.alfa) / k.beta)); }
  function tanqueL() { return C().tanqueL > 0 ? C().tanqueL : 40; }

  // nivel = alfa + beta x rayitas. Con los llenados a tope se sabe el nivel antes de llenar
  // (tanque - litros cargados). Se agregan dos puntos "de fábrica" (0 rayitas = 0 L,
  // 10 rayitas = tanque lleno) para que con pocos datos no dé cualquier cosa.
  function calibrarRayitas() {
    var pts = [[0, 0], [RAYITAS, tanqueL()]];
    M().llenados.forEach(function (f) {
      if (f.aTope && typeof f.rayitasAntes === 'number') pts.push([f.rayitasAntes, Math.max(0, tanqueL() - f.litros)]);
    });
    var n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
    pts.forEach(function (p) { sx += p[0]; sy += p[1]; sxx += p[0] * p[0]; sxy += p[0] * p[1]; });
    var den = n * sxx - sx * sx;
    var beta = den ? (n * sxy - sx * sy) / den : tanqueL() / RAYITAS;
    beta = Math.max(tanqueL() / RAYITAS * 0.5, Math.min(tanqueL() / RAYITAS * 1.5, beta));
    var alfa = (sy - beta * sx) / n;
    return { alfa: alfa, beta: beta, datos: n - 2 };
  }

  // Filas para la regresión: una por tramo entre dos llenados
  function tramos() {
    var L = M().llenados.slice().sort(function (a, b) { return a.km - b.km; });
    var filas = [];
    for (var i = 1; i < L.length; i++) {
      var prev = L[i - 1], f = L[i];
      var kmReal = f.km - prev.km;
      if (!(kmReal > 0) || !f.acum) continue;
      // Litros gastados = nivel después del llenado anterior - nivel antes de este
      var despuesPrev = prev.aTope ? tanqueL() : (typeof prev.rayitasDespues === 'number' ? litrosDeRayitas(prev.rayitasDespues) : null);
      var antesEste = f.aTope ? tanqueL() - f.litros : (typeof f.rayitasAntes === 'number' ? litrosDeRayitas(f.rayitasAntes) : null);
      if (despuesPrev === null || antesEste === null) continue;
      var gastado = despuesPrev - antesEste;
      if (!(gastado > 0)) continue;
      var kmPorL = kmReal / gastado;
      if (kmPorL < 3 || kmPorL > 30) continue; // imposible para un Jimny: km o litros mal escritos
      var a = f.acum, kmApp = (a.c + a.u + a.t) / 1000;
      var parte = kmApp > 0 ? Math.min(1, kmApp / kmReal) : 0;
      var escala = parte > 0 ? Math.min(4, Math.max(1, kmReal / kmApp)) : 0;
      filas.push({
        fecha: f.fecha, kmReal: kmReal, kmApp: kmApp, parte: parte, gastado: gastado, exacto: prev.aTope && f.aTope,
        x: [a.c / 1000 * escala, a.u / 1000 * escala, a.t / 1000 * escala, a.hc / 3600 * escala, a.hs / 3600 * escala],
      });
    }
    return filas;
  }

  // Resuelve A x = b (5x5) por eliminación de Gauss
  function resolver(A, b) {
    var n = b.length, M2 = A.map(function (fila, i) { return fila.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(M2[r][c]) > Math.abs(M2[piv][c])) piv = r;
      var t = M2[c]; M2[c] = M2[piv]; M2[piv] = t;
      if (Math.abs(M2[c][c]) < 1e-12) return null;
      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === c) continue;
        var k = M2[r2][c] / M2[c][c];
        for (var j = c; j <= n; j++) M2[r2][j] -= k * M2[c][j];
      }
    }
    return M2.map(function (fila, i) { return fila[n] / fila[i]; });
  }

  // Regresión ridge hacia los valores iniciales, con pesos por exactitud, cobertura y antigüedad
  function aprender() {
    var t0 = iniciales();
    var filas = tramos().filter(function (f) { return f.parte > 0; }).slice(-12);
    var n = filas.length;
    if (!n) return { coef: t0, n: 0, aprendido: false };
    var k = 5, XtX = [], Xty = [], i, j, r;
    for (i = 0; i < k; i++) { XtX.push([0, 0, 0, 0, 0]); Xty.push(0); }
    var media2 = [0, 0, 0, 0, 0];
    filas.forEach(function (f, idx) {
      var peso = (f.exacto ? 1 : 0.3) * Math.max(0.1, f.parte) * Math.pow(0.9, n - 1 - idx);
      for (i = 0; i < k; i++) {
        media2[i] += f.x[i] * f.x[i] / n;
        Xty[i] += peso * f.x[i] * f.gastado;
        for (j = 0; j < k; j++) XtX[i][j] += peso * f.x[i] * f.x[j];
      }
    });
    // Fuerza del valor inicial: como unos 2 tanques típicos de cada cosa
    for (i = 0; i < k; i++) {
      var lam = 2 * media2[i] + 1e-6;
      XtX[i][i] += lam;
      Xty[i] += lam * t0[i];
    }
    var coef = resolver(XtX, Xty) || t0;
    for (r = 0; r < k; r++) if (!(coef[r] > 0)) coef[r] = t0[r] * 0.2; // nunca negativo ni cero
    return { coef: coef, n: n, aprendido: n >= 3 };
  }

  var cache = null;
  function coeficientes() { if (!cache) cache = aprender(); return cache; }
  window.addEventListener('jimny-db', function () { cache = null; });

  // ---------- Lo que se va gastando ----------
  var tranque = { activo: false, buffer: [], parada: 0 };

  function enTranque() { return tranque.activo; }

  function revisarTranque() {
    var b = tranque.buffer, m = 0, s = 0, i;
    for (i = 0; i < b.length; i++) { m += b[i].m; s += b[i].s; }
    while (b.length > 1 && m - b[0].m >= VENTANA_TRANQUE) { m -= b[0].m; s -= b[0].s; b.shift(); }
    if (!tranque.activo) {
      if (m >= VENTANA_TRANQUE && s > 0 && m / s * 3.6 < TRANQUE_ENTRA) tranque.activo = true;
    } else {
      // Salida: los últimos 300 m a más de 25 km/h
      var mm = 0, ss = 0;
      for (i = b.length - 1; i >= 0 && mm < VENTANA_SALIDA; i--) { mm += b[i].m; ss += b[i].s; }
      // Al salir se empieza de cero: si no, el último km todavía trae la parte lenta y vuelve a entrar
      if (mm >= VENTANA_SALIDA && ss > 0 && mm / ss * 3.6 > TRANQUE_SALE) { tranque.activo = false; tranque.buffer = []; }
    }
  }

  function gastar(litros) {
    var t = M().tanque;
    if (typeof t.nivel === 'number') t.nivel = Math.max(0, t.nivel - litros);
  }

  // Un tramo en movimiento: metros, segundos y velocidad (km/h). Devuelve lo gastado.
  function movimiento(metros, segundos, kmh) {
    if (!(metros > 0)) return null;
    tranque.parada = 0;
    tranque.buffer.push({ m: metros, s: segundos > 0 ? segundos : 0 });
    revisarTranque();
    var tipo = tranque.activo ? 't' : (kmh >= VEL_CARRETERA ? 'c' : 'u');
    var coef = coeficientes().coef;
    var litros = metros / 1000 * coef[{ c: 0, u: 1, t: 2 }[tipo]];
    M().acum[tipo] += metros;
    gastar(litros);
    return { tipo: tipo, litros: litros, tranque: tranque.activo };
  }

  // Tiempo detenido con el motor encendido
  function detenido(segundos) {
    if (!(segundos > 0)) return null;
    tranque.parada += segundos;
    // Las paradas cortas cuentan para el promedio del tranque; una larga (estacionado) no
    if (tranque.parada <= PARADA_MAX_S) { tranque.buffer.push({ m: 0, s: segundos }); revisarTranque(); }
    else { tranque.buffer = []; tranque.activo = false; } // estacionado: al arrancar se empieza de cero
    var conAire = C().aire !== false;
    var coef = coeficientes().coef;
    var litros = segundos / 3600 * coef[conAire ? 3 : 4];
    M().acum[conAire ? 'hc' : 'hs'] += segundos;
    gastar(litros);
    return { litros: litros, tranque: tranque.activo };
  }

  // ---------- Llenados ----------
  // datos: { litros, km, rayitasAntes (0-10 o null), aTope, rayitasDespues, precioLitro, fecha }
  function agregarLlenado(d) {
    var litros = +d.litros, km = +d.km;
    if (!(litros > 0) || !(km > 0)) throw new Error('Escribe los litros y el kilometraje del tablero');
    var L = M().llenados;
    var ultimo = L.length ? L.reduce(function (a, b) { return b.km > a.km ? b : a; }) : null;
    if (ultimo && km <= ultimo.km) throw new Error('El kilometraje tiene que ser mayor que el del último llenado (' + Math.round(ultimo.km) + ' km)');
    if (litros > tanqueL() + 2) throw new Error('Son más litros de los que caben en el tanque (' + tanqueL() + ' L)');
    var f = {
      fecha: d.fecha || new Date().toISOString(), litros: litros, km: km,
      rayitasAntes: typeof d.rayitasAntes === 'number' ? d.rayitasAntes : null,
      aTope: d.aTope !== false, rayitasDespues: d.aTope === false && typeof d.rayitasDespues === 'number' ? d.rayitasDespues : null,
      precioLitro: d.precioLitro > 0 ? +d.precioLitro : null,
      // Lo que vio la app desde el llenado anterior (el primero no tiene tramo)
      acum: ultimo ? JSON.parse(JSON.stringify(M().acum)) : null,
    };
    L.push(f);
    if (L.length > 60) L.shift();
    M().acum = { c: 0, u: 0, t: 0, hc: 0, hs: 0 };
    // El tanque queda lleno, o con lo que había más lo cargado
    var t = M().tanque;
    if (f.aTope) t.nivel = tanqueL();
    else if (typeof f.rayitasDespues === 'number') t.nivel = litrosDeRayitas(f.rayitasDespues);
    else if (typeof t.nivel === 'number') t.nivel = Math.min(tanqueL(), t.nivel + litros);
    t.cuando = f.fecha;
    // El precio del llenado pasa a ser el de los cálculos
    if (f.precioLitro) { C().precioGalon = f.precioLitro * db.GALON_L; C().precioFecha = f.fecha.slice(0, 10); }
    // El kilometraje del tablero también corrige el odómetro (queda como lectura)
    db.fijarOdometro(km, true);
    cache = null;
    db.guardar();
    return f;
  }

  function borrarLlenado(fecha) {
    var L = M().llenados;
    for (var i = 0; i < L.length; i++) if (L[i].fecha === fecha) { L.splice(i, 1); break; }
    cache = null;
    db.guardar();
  }

  // El tablero marca otra cosa: se corrige el nivel
  function corregirRayitas(r) {
    M().tanque.nivel = litrosDeRayitas(+r);
    M().tanque.cuando = new Date().toISOString();
    db.guardar();
  }

  // ---------- Resúmenes ----------
  function litrosPorKmPromedio() {
    var r = resumen();
    if (r.kmL) return 1 / r.kmL;
    var c = coeficientes().coef;
    return (c[0] + c[1]) / 2;
  }

  function resumen() {
    var filas = tramos();
    var ult = filas.slice(-5), km = 0, l = 0;
    ult.forEach(function (f) { km += f.kmReal; l += f.gastado; });
    var co = coeficientes();
    return {
      tramos: filas.length, kmL: l > 0 ? km / l : null, ultimos: ult.length,
      ultimo: filas.length ? filas[filas.length - 1] : null,
      coef: co.coef, aprendido: co.aprendido, n: co.n, iniciales: iniciales(),
      rayitas: calibrarRayitas(),
    };
  }

  function tanque() {
    var nivel = M().tanque.nivel;
    if (typeof nivel !== 'number') return null;
    var r = rayitasDeLitros(nivel);
    var km = nivel / litrosPorKmPromedio();
    return { litros: nivel, rayitas: r, km: km, bajo: r <= 2 };
  }

  // Gasto de un recorrido según sus partes (para mostrar cuánto fue detenido y en tranque)
  window.jimnyConsumo = {
    movimiento: movimiento, detenido: detenido, enTranque: enTranque,
    agregarLlenado: agregarLlenado, borrarLlenado: borrarLlenado, corregirRayitas: corregirRayitas,
    coeficientes: coeficientes, iniciales: iniciales, factorTranque: factorTranque,
    resumen: resumen, tanque: tanque, tramos: tramos, calibrarRayitas: calibrarRayitas,
    litrosDeRayitas: litrosDeRayitas, rayitasDeLitros: rayitasDeLitros, resolver: resolver,
    _tranque: tranque,
  };
})();
