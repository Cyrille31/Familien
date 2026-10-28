// Service worker : garde l'application sur l'appareil pour un usage hors ligne.
// Le fichier du Drive n'est jamais intercepté ni mis en cache ici : il est
// téléchargé uniquement sur demande et enregistré par l'application.
const VERSION = 'familien-v1.4.0';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/auth.js',
  './js/importers.js',
  './js/csv.js',
  './js/model.js',
  './js/sheets.js',
  './js/storage.js',
  './js/tree.js',
  './manifest.webmanifest',
  './exemple.csv',
  './icons/logo.svg',
  './icons/icon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => cached || fetch(req).then((resp) => {
      if (resp.ok) {
        const copy = resp.clone();
        caches.open(VERSION).then((cache) => cache.put(req, copy));
      }
      return resp;
    }).catch(() => (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
