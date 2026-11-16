/* Офлайн-режим: файлы приложения кэшируются, приложение открывается без интернета. */
const CACHE = 'hronika-v24';
const FILES = ['./', 'index.html', 'styles.css', 'theme-light.css', 'app.js', 'more.js', 'swipe.js', 'mobile.js', 'data.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// Сначала сеть (чтобы правки сразу были видны). Если сеть молчит дольше 3 с или её нет — берём из кэша.
// Шрифты Google кэшируются тоже (у их адреса есть «?», поэтому для них отдельное правило).
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const font = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  const cacheable = font || (url.origin === location.origin && !url.search);
  const net = fetch(e.request, { cache: font ? 'default' : 'no-cache' }).then(res => {
    if (cacheable && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return res;
  });
  const cached = () => caches.match(e.request, { ignoreSearch: !font });
  e.respondWith(new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done && r) { done = true; resolve(r); } };
    const timer = setTimeout(() => cached().then(finish), 3000);
    net.then(r => { clearTimeout(timer); finish(r); })
       .catch(() => { clearTimeout(timer); cached().then(r => r ? finish(r) : finish(Response.error())); });
  }));
});
