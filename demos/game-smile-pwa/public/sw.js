// __BUILD_ID__ is substituted by server.js on every request for this file,
// using Cloud Run's per-revision K_REVISION. That means a new deploy always
// ships a brand new cache name here, so the old cache is dropped on
// activate instead of lingering forever.
const CACHE_NAME = 'smile-jump-__BUILD_ID__';

// Paths that must always be revalidated against the network: the app shell
// and its code. These are small and cheap to refetch, and are exactly what
// you want "latest" for. Everything else (wasm runtime, ML model, icons)
// is large, rarely changes, and is safe to serve cache-first.
const APP_SHELL_PATHS = new Set(['/', '/index.html', '/main.js', '/install-prompt.js', '/sw.js', '/manifest.webmanifest']);

const ASSETS = [
  './',
  './index.html',
  './main.js',
  './install-prompt.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './models/face_landmarker.task',
  './vendor/tasks-vision/vision_bundle.mjs',
  './vendor/tasks-vision/wasm/vision_wasm_internal.js',
  './vendor/tasks-vision/wasm/vision_wasm_internal.wasm',
  './vendor/tasks-vision/wasm/vision_wasm_nosimd_internal.js',
  './vendor/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isAppShell = APP_SHELL_PATHS.has(url.pathname);

  if (isAppShell) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => cached);
    })
  );
});
