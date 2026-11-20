// Form Filler's service worker (written into the build by vite.config.js). It keeps the page's own files so the page
// opens and finds blanks with no connection after the first visit. It never touches anything but this site's own
// files: the handwriting model from Hugging Face is kept by the page's own reader, not here.
//
// The cache it keeps them in can be written by any page published at this same web address, but this script cannot.
// So the build writes each file's SHA-256 here, and a kept copy is served only while it is still the one built: one
// that does not match is fetched again, and nothing that does not match is kept.
const VERSION = '__VERSION__', CACHE = 'form-filler-' + VERSION, FILES = [/*__FILES__*/], PRINTS = {/*__PRINTS__*/};
const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const printOf = async response => hex(await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer()));
// A request's file as the build names it: "./assets/index-….js", or "./" for the page itself.
const fileOf = url => { const scope = new URL(self.registration.scope), path = url.pathname.startsWith(scope.pathname) ? url.pathname.slice(scope.pathname.length) : null; return path === null ? null : './' + path; };
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('form-filler-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), file = fileOf(url);
    let hit = await cache.match(request, { ignoreSearch: true }), want = PRINTS[file];
    if (!hit && request.mode === 'navigate') { hit = await cache.match('./'); want = PRINTS['./']; }
    if (hit && want && await printOf(hit) === want) return hit;
    const response = await fetch(request);
    // Kept for next time (the handwriting runtime, say), only if it is the file that was built.
    if (response.ok && response.type === 'basic' && want && await printOf(response) === want) await cache.put(request, response.clone());
    return response;
  })());
});
