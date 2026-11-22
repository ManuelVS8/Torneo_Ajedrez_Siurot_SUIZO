/* Service worker · Ajedrez Siurot
   - Archivos de la propia app: primero la red (así los cambios llegan solos) y, sin conexión, la última copia.
   - Las peticiones al Script de Google NUNCA pasan por aquí: los resultados siempre van a la red. */
const CACHE = 'ajedrez-siurot-torneo-2';
const BASICOS = [
  './', './index.html', './admin.html', './pantalla.html', './estilo.css', './comun.js',
  './manifest.json', './manifest-admin.json',
  './iconos/icon-192.png', './iconos/icon-512.png', './iconos/icon-180.png', './iconos/icon-maskable-512.png', './iconos/favicon.png',
  './fuentes/fredoka-latin-600-normal.woff2', './fuentes/fredoka-latin-700-normal.woff2',
  './fuentes/nunito-latin-400-normal.woff2', './fuentes/nunito-latin-700-normal.woff2', './fuentes/nunito-latin-800-normal.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(BASICOS.map((u) => c.add(u).catch(() => { }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // Google Script y demás: directo a la red
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) { const copia = res.clone(); caches.open(CACHE).then((c) => c.put(req, copia)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match(url.pathname.endsWith('admin.html') ? './admin.html' : './index.html')))
  );
});
