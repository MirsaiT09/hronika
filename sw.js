/* Офлайн-режим: файлы приложения кэшируются, приложение открывается без интернета. */
const CACHE = 'hronika-v7';
const FILES = ['./', 'index.html', 'styles.css', 'app.js', 'more.js', 'data.js', 'manifest.webmanifest',
  'assets/deutsch-gothic.ttf', 'assets/cross.png', 'assets/eye.png', 'assets/title-raspisanie.png', 'assets/title-prepody.png', 'assets/title-progul.png', 'assets/title-sessia.png', 'assets/star.png', 'assets/spike.png', 'assets/ribs.png', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Сначала сеть (чтобы правки сразу были видны), при отсутствии сети — кэш
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(res => {
    if ((res.ok || res.type === 'opaque') && !new URL(e.request.url).search) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
