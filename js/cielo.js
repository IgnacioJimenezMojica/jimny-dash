/* =========================================================
   cielo.js: el cielo de la animación sigue el clima real.

   - Toma el código del clima de Open-Meteo que ya baja
     widgets.js (evento "jimny-clima" o el último guardado,
     si tiene menos de 3 horas).
   - Lo traduce a un estado: despejado, parcial, nublado,
     lluvia (débil, normal o fuerte) o tormenta, y pone la
     clase en <html>. Los efectos están en css/clima.css.
   - El sol sigue la altura real del sol (la misma cuenta del
     modo noche): sale bajo por la izquierda, sube y baja por
     la derecha. Se ve solo de día y con poco o nada de nubes.
   - En Ajustes > Pantalla > Cielo se elige "Según el clima
     real", "Siempre despejado" o probar cada estado.
   ========================================================= */
(function () {
  'use strict';

  var raiz = document.documentElement;
  var selector = document.getElementById('a-cielo');
  var ayuda = document.querySelector('[data-a="cielo-estado"]');
  var VIGENCIA = 3 * 3600000;
  var PANAMA = { lat: 8.9824, lon: -79.5199 };
  var ESTADOS = ['despejado', 'parcial', 'nublado', 'lluvia', 'tormenta'];
  var NOMBRES = { despejado: 'despejado', parcial: 'parcialmente nublado', nublado: 'nublado', lluvia: 'lluvia', tormenta: 'tormenta' };

  var estado = { modo: 'real', real: null, intensidad: null, aplicado: null, codigo: null };

  // Código WMO de Open-Meteo -> estado del cielo
  function desdeCodigo(c) {
    if (c === 0 || c === 1) return { cielo: 'despejado' };
    if (c === 2) return { cielo: 'parcial' };
    if (c === 3 || c === 45 || c === 48) return { cielo: 'nublado' };
    if (c >= 95) return { cielo: 'tormenta', intensidad: 'fuerte' };
    if ([51, 53, 56, 61, 66, 80].indexOf(c) >= 0) return { cielo: 'lluvia', intensidad: 'debil' };
    if ([65, 82].indexOf(c) >= 0) return { cielo: 'lluvia', intensidad: 'fuerte' };
    if (c >= 51 && c <= 86) return { cielo: 'lluvia', intensidad: 'normal' }; // 55, 57, 63, 67, 81 y nieve (no aplica en Panamá)
    return null;
  }

  function leer(clave) { try { return JSON.parse(localStorage.getItem(clave) || 'null'); } catch (e) { return null; } }

  function tomarClima(c) {
    if (!c || typeof c.codigo !== 'number' || Date.now() - (c.cuando || 0) > VIGENCIA) { estado.real = null; estado.codigo = null; return; }
    var r = desdeCodigo(c.codigo);
    estado.real = r ? r.cielo : null;
    estado.intensidad = r ? r.intensidad || null : null;
    estado.codigo = c.codigo;
  }

  function aplicar() {
    var cielo, intensidad = null;
    if (estado.modo === 'real') { cielo = estado.real || 'despejado'; intensidad = estado.intensidad; }
    else { cielo = ESTADOS.indexOf(estado.modo) >= 0 ? estado.modo : 'despejado'; intensidad = cielo === 'tormenta' ? 'fuerte' : null; }
    ESTADOS.forEach(function (e) { raiz.classList.toggle('clima-' + e, e === cielo); });
    raiz.classList.toggle('lluvia-debil', intensidad === 'debil');
    raiz.classList.toggle('lluvia-fuerte', intensidad === 'fuerte');
    estado.aplicado = cielo;
    moverSol();
    if (ayuda) {
      if (estado.modo === 'real') ayuda.textContent = estado.real ? 'Ahora: ' + NOMBRES[estado.real] + ', según el clima real.' : 'Todavía sin dato del clima (necesita internet); se ve despejado.';
      else ayuda.textContent = estado.modo === 'despejado' ? 'Siempre despejado, sin importar el clima.' : 'Modo de prueba: ' + NOMBRES[estado.modo] + '. Vuelve a "Según el clima real" para usar el dato real.';
    }
  }

  // ---------- Sol ----------
  function modoLuz() {
    var r = document.querySelector('input[name="luz"]:checked');
    return r ? r.id.replace('luz-', '') : 'auto';
  }

  function ubicacion() {
    var g = window.jimnyWidgets && window.jimnyWidgets.gps && window.jimnyWidgets.gps.ultimo;
    if (g) return g;
    var p = leer('jimny-pos');
    return p && typeof p.lat === 'number' ? p : PANAMA;
  }

  function moverSol() {
    var luz = modoLuz(), visible = false, x = 72, y = 34, bajo = false;
    var conNubes = estado.aplicado === 'nublado' || estado.aplicado === 'lluvia' || estado.aplicado === 'tormenta';
    if (luz === 'dia') {
      visible = !conNubes; // día forzado: sol en un lugar fijo y bonito
    } else if (luz === 'auto' && window.jimnyLuz) {
      var u = ubicacion(), ahora = window.jimnyLuz.ahora();
      var elev = window.jimnyLuz.elevacionSol(ahora, u.lat, u.lon);
      var luego = window.jimnyLuz.elevacionSol(new Date(ahora.getTime() + 600000), u.lat, u.lon);
      var subiendo = luego > elev;
      // Altura: desde detrás de las montañas (62vh) hasta 36vh para no quedar detrás del panel de datos
      var f = Math.max(0, Math.min(1, elev / 70));
      y = 62 - f * 26;
      x = subiendo ? 14 + f * 36 : 86 - f * 36;
      visible = elev > -2 && !conNubes;
      bajo = elev < 15; // en la última hora antes de ponerse (o la primera después de salir) se ve anaranjado
    }
    raiz.style.setProperty('--sol-x', x.toFixed(1) + '%');
    raiz.style.setProperty('--sol-y', y.toFixed(1) + 'vh');
    raiz.classList.toggle('sol-visible', visible);
    raiz.classList.toggle('sol-bajo', bajo);
  }

  // ---------- Selector en Ajustes ----------
  try { estado.modo = localStorage.getItem('jimny-cielo') || 'real'; } catch (e) { estado.modo = 'real'; }
  if (selector) {
    selector.value = estado.modo;
    selector.addEventListener('change', function () {
      estado.modo = selector.value;
      try { localStorage.setItem('jimny-cielo', estado.modo); } catch (e) { /* nada */ }
      aplicar();
    });
  }

  window.addEventListener('jimny-clima', function (ev) { tomarClima(ev.detail); aplicar(); });
  document.addEventListener('change', function (ev) { if (ev.target && ev.target.name === 'luz') moverSol(); });

  tomarClima(leer('jimny-clima'));
  aplicar();
  setInterval(function () { tomarClima(leer('jimny-clima')); aplicar(); }, 60000);

  window.jimnyCielo = { estado: estado, desdeCodigo: desdeCodigo, aplicar: aplicar, moverSol: moverSol };
})();
