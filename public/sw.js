// Service worker: tiene l'app sul telefono per aprirla anche senza campo.
// Le chiamate /api non passano da qui (i dati offline li gestisce js/coda.js), tranne le foto, tenute in cache.
const VERSIONE = 'sc-v1';
const FILE = ['/', '/index.html', '/style.css', '/manifest.webmanifest', '/icona.svg', '/icona-192.png',
  '/js/app.js', '/js/ui.js', '/js/api.js', '/js/coda.js', '/js/campo.js', '/js/ufficio.js'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSIONE).then((c) => c.addAll(FILE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== VERSIONE).map((x) => caches.delete(x)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/foto/')) {
    e.respondWith(caches.open(VERSIONE + '-foto').then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;
  // Prima la rete (per avere sempre l'ultima versione), se manca la copia salvata
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) caches.open(VERSIONE).then((c) => c.put(e.request, r.clone())); return r; })
    .catch(async () => (await caches.match(e.request)) || caches.match('/index.html')));
});
