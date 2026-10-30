// Pocket Club · l'application s'ouvre même sans réseau (les données reviennent de Supabase avec le réseau)
const CACHE = 'pc-alpha-3.1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'js/core.js', 'js/ui.js', 'js/auth.js', 'js/accueil.js', 'js/agenda.js', 'js/messages.js', 'js/equipe.js', 'js/joueur.js', 'js/club.js', 'js/compte.js', 'js/importer.js', 'js/coach.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname.endsWith('supabase.co') || u.pathname.endsWith('version.json')) return; // jamais de cache pour les données
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && (u.origin === location.origin || /jsdelivr|gstatic|googleapis/.test(u.hostname))) { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put(e.request, c)); }
    return r;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
