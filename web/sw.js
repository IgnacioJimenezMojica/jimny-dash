/* =========================================================
   sw.js: service worker de la versión web.

   Con internet: siempre intenta traer la versión nueva
   (si tarda más de 3 s, usa la guardada).
   Sin internet: usa la copia guardada.

   construir.py reemplaza VERSION por una huella del index.html,
   así cada versión nueva limpia la copia vieja.
   ========================================================= */
var CACHE = 'jimny-__VERSION__';
var ARCHIVOS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'iconos/icono-192.png',
  'iconos/icono-512.png',
  'iconos/icono-mascara-512.png',
  'iconos/icono-apple-180.png',
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARCHIVOS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (nombres) {
      return Promise.all(nombres.filter(function (n) { return n.indexOf('jimny-') === 0 && n !== CACHE; })
        .map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function conTiempoLimite(promesa, ms) {
  return new Promise(function (ok, mal) {
    var t = setTimeout(function () { mal(new Error('tiempo')); }, ms);
    promesa.then(function (r) { clearTimeout(t); ok(r); }, function (e) { clearTimeout(t); mal(e); });
  });
}

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;

  // La página: primero la red, si falla la copia guardada
  if (e.request.mode === 'navigate') {
    e.respondWith(
      conTiempoLimite(fetch(e.request), 3000).then(function (r) {
        var copia = r.clone();
        caches.open(CACHE).then(function (c) { c.put('index.html', copia); });
        return r;
      }).catch(function () {
        return caches.match('index.html');
      })
    );
    return;
  }

  // Lo demás (íconos, manifiesto): primero la copia guardada
  e.respondWith(caches.match(e.request).then(function (r) { return r || fetch(e.request); }));
});
