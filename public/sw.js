// HRSC–Prithvi service worker. It caches only the offline page and the app icons, never pages, API
// answers, invitations, votes or member media, and it shows chat notifications.
const CACHE = 'prithvi-shell-v3';
// Cloudflare serves public/offline.html at /offline (its .html address redirects there), and a page load cannot be
// answered with a redirected response, so the worker caches and serves /offline.
const OFFLINE = '/offline';
const SHELL = [OFFLINE, '/icons/icon-192.png', '/favicon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

// A page that cannot load while offline shows the reconnect screen; every other request goes to the network untouched.
self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
});

// Pushes carry only a title, generic text, a tag (one notification per chat) and an in-app address.
self.addEventListener('push', event => {
  const note = event.data ? event.data.json() : { title: 'HRSC–Prithvi', body: 'Something new at HRSC–Prithvi', tag: 'prithvi', url: '/winterleague' };
  event.waitUntil(self.registration.showNotification(note.title, {
    body: note.body, tag: note.tag, renotify: true, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: note.url },
  }));
});

// Opens the chat in an existing app window when there is one; only addresses on this site are followed.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/winterleague', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const open = windows.find(client => new URL(client.url).origin === target.origin);
    if (!open) return self.clients.openWindow(target.href);
    return open.focus().then(client => client.navigate(target.href)).catch(() => self.clients.openWindow(target.href));
  }));
});
