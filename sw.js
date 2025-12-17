self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ページ側から通知内容を受け取って表示
self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'notify') {
    const { title, body, tag } = data.payload || {};
    self.registration.showNotification(title || '通知', {
      body: body || '',
      tag: tag || 'iv-lineup',
      renotify: true
    });
  }
});

// 通知クリックでアプリへフォーカス
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (allClients.length > 0) {
      allClients[0].focus();
    } else {
      clients.openWindow('./');
    }
  })());
});
