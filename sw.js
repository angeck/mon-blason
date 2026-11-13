// mypocketclub · l'application s'ouvre même sans réseau (les données reviennent de Supabase avec le réseau)
const CACHE = 'pc-alpha-5.9.0';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'js/core.js', 'js/ui.js', 'js/auth.js', 'js/accueil.js', 'js/agenda.js', 'js/messages.js', 'js/equipe.js', 'js/joueur.js', 'js/club.js', 'js/compte.js', 'js/importer.js', 'js/coach.js', 'js/vie.js', 'js/notif.js', 'js/profils.js', 'js/convoc.js', 'js/v35.js', 'js/v36.js', 'js/v37.js', 'js/v38.js', 'js/v310.js', 'js/v42.js', 'js/v43.js', 'js/v44.js', 'js/v46.js', 'js/v47.js', 'js/v48.js', 'js/v410.js', 'js/v51.js', 'js/v52.js', 'js/v54.js', 'js/v55.js', 'js/v56.js', 'js/v57.js', 'js/faq_shots.js', 'js/legal.js', 'js/pdfmin.js', 'js/equipes_import.js', 'manifest.webmanifest', 'icon.svg', 'img/ballon-mypocketclub-etoile.svg', 'img/ballon-basket.svg', 'img/ballon-volley.svg', 'img/ballon-foot.svg', 'img/ballon-rugby.svg', 'icon-192.png', 'icon-512.png', 'badge-96.png', 'icon-maskable-512.png', 'icon-maskable-192.png', 'apple-touch-icon.png', 'favicon-32.png', 'favicon-48.png', 'img/logo-mypocketclub.svg'];
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

// Étape B · notifications : le serveur envoie { title, body, url, tag } ; un toucher ouvre (ou ramène) l'application
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'mypocketclub', { body: d.body || '', icon: 'icon-192.png', badge: 'badge-96.png', tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.startsWith(self.registration.scope));
    if (c) { c.focus(); return c.navigate ? c.navigate(url).catch(() => {}) : null; }
    return self.clients.openWindow(url);
  }));
});
