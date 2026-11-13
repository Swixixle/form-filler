// Form Filler's service worker (written into the build by vite.config.js). It keeps the page's own files so the page
// opens and finds blanks with no connection after the first visit. It never touches anything but this site's own
// files: the handwriting model from Hugging Face is kept by the page's own reader, not here.
const VERSION = '__VERSION__', CACHE = 'form-filler-' + VERSION, FILES = [/*__FILES__*/];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('form-filler-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), hit = await cache.match(request, { ignoreSearch: true }) || (request.mode === 'navigate' ? await cache.match('./') : null);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());   // kept for next time, e.g. the handwriting runtime
    return response;
  })());
});
