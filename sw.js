const CACHE_NAME = 'ajedrez-siurot-suizo-v4';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './sw.js', // Añadido por seguridad
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://raw.githubusercontent.com/ManuelVS8/Torneo_Ajedrez_Siurot_SUIZO/refs/heads/main/suizo.ico',
  // URL CORREGIDA (Raw directo):
  'https://raw.githubusercontent.com/ManuelVS8/Efectos_audio/37b3eb2da9c15c04dfb71dfe1be60f088ea3cdfc/Tap.mp3'
];

// INSTALACIÓN
self.addEventListener('install', event => {
  self.skipWaiting(); // Fuerza la activación inmediata
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('✅ Cacheando recursos Ajedrez Suizo');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .catch(err => console.error('Error al cachear:', err))
  );
});

// ACTIVACIÓN: Limpieza de versiones antiguas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Limpiando caché antigua:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// FETCH: Estrategia Inteligente
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // EXCEPCIÓN CRÍTICA: Google Script siempre va a la RED
  // para que los resultados del torneo estén actualizados.
  if (url.hostname.includes('script.google')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // ESTRATEGIA: Cache First, Network Fallback
  event.respondWith(
    caches.match(event.request).then(response => {
      // Si está en caché, lo servimos
      if (response) {
        return response;
      }
      
      // Si no, vamos a la red
      return fetch(event.request).then(networkResponse => {
        // Opcional: guardar en caché lo nuevo que encontremos
        if (networkResponse && networkResponse.status === 200) {
           const responseClone = networkResponse.clone();
           caches.open(CACHE_NAME).then(cache => {
             cache.put(event.request, responseClone);
           });
        }
        return networkResponse;
      });
    })
  );
});