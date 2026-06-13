// Pappa Pronta - Service Worker (versione push)
const CACHE = 'pappa-push-v6';
const ASSETS = ['./index.html','./manifest.json','./icon-192.png','./icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS).catch(()=>{})));
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // La pagina la prendo SEMPRE dalla rete (niente copie vecchie). Cache solo come riserva offline.
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});

// Notifica push ricevuta dal server: arriva anche ad app chiusa / schermo bloccato
self.addEventListener('push', e => {
  let data = { title: '🐶 Ora della pappa!', body: 'È ora di dar da mangiare al cane', id: null };
  try { if (e.data) data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: 'pappa-' + (data.id || Date.now()),
    requireInteraction: true,
    vibrate: [200,100,200],
    data: { id: data.id },
    actions: [{ action: 'done', title: '✓ Dato da mangiare' }]
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  e.waitUntil((async () => {
    const all = await clients.matchAll({ type:'window', includeUncontrolled:true });
    if (e.action === 'done' && id != null) all.forEach(c => c.postMessage({ type:'MEAL_DONE', id }));
    if (all.length) all[0].focus(); else clients.openWindow('./index.html');
  })());
});
