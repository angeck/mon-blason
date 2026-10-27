// Mon Blason · service worker : l'application s'ouvre même sans réseau (les données viennent de Supabase quand le réseau revient)
const CACHE = 'mb-alpha-0.1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname.endsWith('supabase.co')) return; // jamais de cache pour les données
  // réseau d'abord (mises à jour immédiates), cache si hors connexion
  e.respondWith(fetch(e.request).then((r) => { if (r.ok && (u.origin === location.origin || u.hostname.includes('jsdelivr') || u.hostname.includes('gstatic') || u.hostname.includes('googleapis'))) { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
