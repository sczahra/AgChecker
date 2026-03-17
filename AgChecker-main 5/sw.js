const CACHE_NAME = 'ag-app-shell-v1.3.0';
const ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/db.js',
  '/js/rules.js',
  '/js/off.js',
  '/js/version.js',
  '/rules.json',
  '/manifest.webmanifest',
  '/CHANGELOG.md',
  '/README.md',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (e)=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate', (e)=>{
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k=> k===CACHE_NAME ? null : caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e)=>{
  if(e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if(ASSETS.includes(url.pathname)){
    e.respondWith(caches.match(e.request).then(r=> r || fetch(e.request)));
    return;
  }
  e.respondWith(
    fetch(e.request).catch(()=> caches.match(e.request))
  );
});
