/* =========================================================
   db.js: "base de datos" local del carro, guardada en el
   navegador (localStorage, clave "jimny-db").

   Guarda:
   - odómetro: el kilometraje que uno escribe + lo que suma el GPS
   - mantenimiento: último servicio (fecha y km), cada cuántos
     meses y km toca, e historial
   - combustible: precio por galón y consumo del carro
   - plan de viaje: distancia del tramo que se va a hacer
   - viajes: historial de viajes terminados
   - destinos: lugares guardados (casa, trabajo...) y el elegido
   - gasolineras favoritas, en orden de preferencia
   - qué tarjetas del panel se esconden

   Ojo: si se borran los datos del navegador, se pierde. Por eso
   en Ajustes hay "Exportar respaldo" e "Importar respaldo".
   ========================================================= */
(function () {
  'use strict';

  var CLAVE = 'jimny-db';
  var GALON_L = 3.78541;

  function base() {
    return {
      version: 1,
      // lecturas: cada vez que se corrige con el tablero (km real y km que la app había visto)
      odometro: { base: null, baseFecha: null, sumadoM: 0, totalAppM: 0, lecturas: [] },
      mantenimiento: { fecha: null, km: null, meses: 3, kmIntervalo: 5000, historial: [] },
      // Precio máximo de la gasolina de 91 en Panamá y Colón del 16 al 30 de octubre de 2026 (Secretaría de Energía).
      // Consumo: unos 12 km/l, lo que reportan dueños de Jimny 1.5 manual con parrilla y llantas AT (8,3 l/100 km);
      // el dato de fábrica ronda los 14 a 15 km/l.
      // Se guarda por galón; se muestra en la unidad elegida (litro por defecto: en Panamá se compra por litro)
      combustible: { precioGalon: 4.84, tipo: '91', consumoKmL: 12, precioFecha: '2026-10-16', unidad: 'litro', favoritas: ['Terpel', 'Texaco'],
        // Caja y gasto detenido (ver consumo.js). factorTranque null = el de la caja (1,5 manual, 1,6 automático)
        caja: 'manual', aire: true, ralentiConAire: 0.8, ralentiSinAire: 0.5, factorTranque: null, tanqueL: 40 },
      // Modelo de consumo (consumo.js): lo acumulado desde el último llenado, llenados y nivel del tanque
      consumo: { acum: { c: 0, u: 0, t: 0, hc: 0, hs: 0 }, llenados: [], tanque: { nivel: null, cuando: null } },
      plan: { km: 0, idaVuelta: true },
      viajes: [],
      destinos: { lista: [], activo: null },
      pantalla: { ocultas: [] },   // tarjetas del panel que no se quieren ver
      escenas: { aprender: true }, // aprender la escena de cada zona (zonas.js)
    };
  }

  function leer() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(CLAVE) || 'null'); } catch (e) { d = null; }
    var b = base();
    if (!d || typeof d !== 'object') return b;
    // Completa campos que falten (por si la versión guardada es vieja)
    for (var k in b) {
      if (!(k in d)) d[k] = b[k];
      else if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) {
        for (var j in b[k]) if (!(j in d[k])) d[k][j] = b[k][j];
      }
    }
    return d;
  }

  var datos = leer();
  // La primera versión traía Puma por un error al entender el nombre; la de Nacho es Terpel
  // Odómetro de una versión anterior (sin lecturas): lo configurado pasa a ser la primera lectura
  if (datos.odometro.base !== null && !datos.odometro.lecturas.length) {
    datos.odometro.totalAppM = datos.odometro.sumadoM;
    datos.odometro.lecturas.push({ fecha: datos.odometro.baseFecha || new Date().toISOString(), km: datos.odometro.base, appM: 0 });
  }
  if (!datos.consumo.acum || typeof datos.consumo.acum.hc !== 'number') datos.consumo.acum = { c: 0, u: 0, t: 0, hc: 0, hs: 0 };
  // (una sola vez: si después alguien escoge Puma a propósito, se respeta)
  if (!datos.combustible.favoritasRevisadas) {
    if (JSON.stringify(datos.combustible.favoritas) === '["Puma","Texaco"]') datos.combustible.favoritas = ['Terpel', 'Texaco'];
    datos.combustible.favoritasRevisadas = true;
  }

  function guardar() {
    try { localStorage.setItem(CLAVE, JSON.stringify(datos)); } catch (e) { /* sin almacenamiento */ }
    try { window.dispatchEvent(new CustomEvent('jimny-db')); } catch (e) { /* navegador viejo */ }
  }

  // ---------- Odómetro ----------
  function odometroKm() {
    if (datos.odometro.base === null) return null;
    return datos.odometro.base + datos.odometro.sumadoM / 1000;
  }

  // Corregir con el tablero: se guarda como lectura (no se pierde lo anterior), así entre dos
  // lecturas se sabe cuántos km anduvo de verdad el carro y cuántos vio la app
  function fijarOdometro(km, sinGuardar) {
    var o = datos.odometro;
    o.base = Math.max(0, +km);
    o.baseFecha = new Date().toISOString();
    o.sumadoM = 0;
    o.lecturas.unshift({ fecha: o.baseFecha, km: o.base, appM: Math.round(o.totalAppM) });
    if (o.lecturas.length > 100) o.lecturas.length = 100;
    if (!sinGuardar) guardar();
  }

  // Km que la app no vio entre dos lecturas del tablero (la más nueva primero)
  function coberturaEntre(nueva, vieja) {
    var real = nueva.km - vieja.km, app = (nueva.appM - vieja.appM) / 1000;
    if (!(real > 0)) return null;
    return { kmReal: real, kmApp: app, sinRegistrar: Math.max(0, real - app), parte: Math.min(1, app / real) };
  }

  var pendienteGuardar = 0;
  function sumarMetros(m) {
    if (!(m > 0)) return;
    datos.odometro.sumadoM += m;
    datos.odometro.totalAppM += m;
    // Guardar como mucho cada 10 s para no escribir en cada posición
    if (Date.now() - pendienteGuardar > 10000) { pendienteGuardar = Date.now(); guardar(); }
  }
  window.addEventListener('pagehide', guardar);

  // ---------- Mantenimiento ----------
  function sumarMeses(fechaISO, meses) {
    var f = new Date(fechaISO + 'T12:00:00');
    var dia = f.getDate();
    f.setMonth(f.getMonth() + meses);
    if (f.getDate() !== dia) f.setDate(0); // 31 de enero + 1 mes = 28/29 de febrero
    return f;
  }

  function estadoMantenimiento(hoy) {
    var m = datos.mantenimiento;
    if (!m.fecha) return { configurado: false };
    hoy = hoy || new Date();
    var proximaFecha = sumarMeses(m.fecha, m.meses);
    // Días de calendario (de medianoche a medianoche), sin importar la hora del día
    var a0 = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    var b0 = new Date(proximaFecha.getFullYear(), proximaFecha.getMonth(), proximaFecha.getDate());
    var dias = Math.round((b0 - a0) / 86400000);
    var odo = odometroKm();
    var kmFaltan = (m.km !== null && odo !== null && m.kmIntervalo) ? (m.km + m.kmIntervalo - odo) : null;
    var nivel = 'ok';
    if (dias <= 0 || (kmFaltan !== null && kmFaltan <= 0)) nivel = 'vencido';
    else if (dias <= 14 || (kmFaltan !== null && kmFaltan <= 500)) nivel = 'pronto';
    return { configurado: true, proximaFecha: proximaFecha, dias: dias, kmFaltan: kmFaltan, nivel: nivel };
  }

  function registrarMantenimiento(fechaISO, km, nota) {
    var m = datos.mantenimiento;
    m.fecha = fechaISO;
    m.km = (km === null || km === '' || isNaN(+km)) ? odometroKm() : +km;
    m.historial.unshift({ fecha: fechaISO, km: m.km, nota: nota || '' });
    if (m.historial.length > 50) m.historial.length = 50;
    guardar();
  }

  // ---------- Combustible y costos ----------
  function costoPorKm() {
    var c = datos.combustible;
    if (!(c.precioGalon > 0) || !(c.consumoKmL > 0)) return null;
    return c.precioGalon / (c.consumoKmL * GALON_L);
  }

  function costoDe(km) { var k = costoPorKm(); return k === null ? null : km * k; }
  function galonesDe(km) { var c = datos.combustible; return c.consumoKmL > 0 ? km / c.consumoKmL / GALON_L : null; }

  // Unidad elegida para ver precio y cantidad: 'litro' o 'galon'
  function unidad() { return datos.combustible.unidad === 'galon' ? 'galon' : 'litro'; }
  function precioLitro() { return datos.combustible.precioGalon / GALON_L; }
  function precioEnUnidad() { var g = datos.combustible.precioGalon; return unidad() === 'litro' ? g / GALON_L : g; }
  function fijarPrecio(valor, enUnidad) { datos.combustible.precioGalon = (enUnidad || unidad()) === 'litro' ? valor * GALON_L : valor; }
  function cantidadDe(km) {
    var c = datos.combustible;
    if (!(c.consumoKmL > 0)) return null;
    var litros = km / c.consumoKmL;
    return unidad() === 'litro' ? { valor: litros, unidad: 'litros' } : { valor: litros / GALON_L, unidad: 'galones' };
  }

  // ---------- Viajes ----------
  function guardarViaje(v) {
    if (!v || v.metros < 300) return;
    var km = v.metros / 1000;
    var costo = typeof v.litros === 'number' ? v.litros * precioLitro() : costoDe(km);
    datos.viajes.unshift({ inicio: v.inicio, fin: v.ultimaVez, km: Math.round(km * 10) / 10, minutos: Math.round(v.segundos / 60), maxima: Math.round(v.maxima), costo: costo,
      litros: typeof v.litros === 'number' ? Math.round(v.litros * 100) / 100 : null,
      detenidoMin: Math.round((v.segDetenido || 0) / 60), tranqueMin: Math.round((v.segTranque || 0) / 60) });
    if (datos.viajes.length > 200) datos.viajes.length = 200;
    guardar();
  }

  function resumenMes(fecha) {
    fecha = fecha || new Date();
    var km = 0, costo = 0, n = 0;
    datos.viajes.forEach(function (v) {
      var f = new Date(v.inicio);
      if (f.getFullYear() === fecha.getFullYear() && f.getMonth() === fecha.getMonth()) { km += v.km; costo += v.costo || 0; n++; }
    });
    return { km: km, costo: costo, viajes: n };
  }

  // ---------- Destinos ----------
  function destinoActivo() {
    var d = datos.destinos;
    for (var i = 0; i < d.lista.length; i++) if (d.lista[i].id === d.activo) return d.lista[i];
    return null;
  }

  function agregarDestino(nombre, lat, lon) {
    nombre = String(nombre || '').trim().slice(0, 40);
    if (!nombre || !(Math.abs(lat) <= 90) || !(Math.abs(lon) <= 180)) return null;
    var dest = { id: 'd' + Date.now().toString(36) + Math.floor(Math.random() * 1000), nombre: nombre, lat: +(+lat).toFixed(6), lon: +(+lon).toFixed(6) };
    // Mismo nombre: se reemplaza la ubicación
    var lista = datos.destinos.lista, previo = -1;
    for (var i = 0; i < lista.length; i++) if (lista[i].nombre.toLowerCase() === nombre.toLowerCase()) previo = i;
    if (previo >= 0) { dest.id = lista[previo].id; lista[previo] = dest; } else lista.push(dest);
    guardar();
    return dest;
  }

  function borrarDestino(id) {
    datos.destinos.lista = datos.destinos.lista.filter(function (x) { return x.id !== id; });
    if (datos.destinos.activo === id) datos.destinos.activo = null;
    guardar();
  }

  function activarDestino(id) {
    datos.destinos.activo = id || null;
    guardar();
  }

  // Al tocar la tarjeta: el siguiente de la lista y, después del último, ninguno
  function siguienteDestino() {
    var lista = datos.destinos.lista, actual = -1;
    for (var i = 0; i < lista.length; i++) if (lista[i].id === datos.destinos.activo) actual = i;
    var sig = actual + 1 < lista.length ? lista[actual + 1] : null;
    activarDestino(sig ? sig.id : null);
    return sig;
  }

  // ---------- Respaldo ----------
  function exportar() {
    var respaldo = { app: 'jimny-animado', exportado: new Date().toISOString(), db: datos };
    try { respaldo.viajeActual = JSON.parse(localStorage.getItem('jimny-viaje') || 'null'); } catch (e) { /* nada */ }
    if (window.jimnyZonas) respaldo.zonas = window.jimnyZonas.exportar();
    return JSON.stringify(respaldo, null, 2);
  }

  function importar(texto) {
    var r = JSON.parse(texto);
    if (!r || r.app !== 'jimny-animado' || !r.db || r.db.version !== 1) throw new Error('El archivo no es un respaldo del Jimny animado');
    try { localStorage.setItem(CLAVE, JSON.stringify(r.db)); } catch (e) { throw new Error('No se pudo guardar en el navegador'); }
    datos = leer(); // completa campos que falten
    if (r.viajeActual) { try { localStorage.setItem('jimny-viaje', JSON.stringify(r.viajeActual)); } catch (e) { /* nada */ } }
    if (r.zonas && window.jimnyZonas) window.jimnyZonas.importar(r.zonas);
    guardar();
    return datos;
  }

  function borrarTodo() {
    datos = base();
    guardar();
  }

  window.jimnyDB = {
    datos: function () { return datos; },
    guardar: guardar,
    odometroKm: odometroKm, fijarOdometro: fijarOdometro, sumarMetros: sumarMetros, coberturaEntre: coberturaEntre,
    estadoMantenimiento: estadoMantenimiento, registrarMantenimiento: registrarMantenimiento, sumarMeses: sumarMeses,
    costoPorKm: costoPorKm, costoDe: costoDe, galonesDe: galonesDe,
    unidad: unidad, precioEnUnidad: precioEnUnidad, precioLitro: precioLitro, fijarPrecio: fijarPrecio, cantidadDe: cantidadDe, GALON_L: GALON_L,
    guardarViaje: guardarViaje, resumenMes: resumenMes,
    destinoActivo: destinoActivo, agregarDestino: agregarDestino, borrarDestino: borrarDestino,
    activarDestino: activarDestino, siguienteDestino: siguienteDestino,
    exportar: exportar, importar: importar, borrarTodo: borrarTodo,
  };
})();
