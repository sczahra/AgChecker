const CACHE_NAME = 'ag-app-shell-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/db.js',
  '/js/rules.js',
  '/js/off.js',
  '/rules.json',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', (e)=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(ASSETS)));
});

self.addEventListener('activate', (e)=>{
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k=> k===CACHE_NAME ? null : caches.delete(k))))
  );
});

self.addEventListener('fetch', (e)=>{
  const url = new URL(e.request.url);
  // App shell: network-first for JSON rules, cache-first for static
  if(ASSETS.includes(url.pathname)){
    e.respondWith(caches.match(e.request).then(r=> r || fetch(e.request)));
    return;
  }
  // Offline fallback
  e.respondWith(
    fetch(e.request).catch(()=> caches.match(e.request))
  );
});
