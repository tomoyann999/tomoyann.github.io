/* sw.js */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('message', (e) => {
  const data = e.data || {};
  if (data.type !== 'notify') return;
  const p = data.payload || {};
  if (!self.registration?.showNotification) return;

  self.registration.showNotification(p.title || '次の対戦メンバー', {
    body: p.body || '',
    tag: p.tag || 'iv-lineup',   // 同じtagで最新1件に更新
    renotify: true,
    badge: 'icon-192.png',
    icon: 'icon-192.png',
    data: { url: './?overlay=1&transparent=1' },
    actions: [{ action: 'open', title: '配信用を開く' }]
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || './';
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) if ('focus' in c) return c.focus();
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
