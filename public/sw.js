// Listen for background push events from the server
self.addEventListener('push', (event) => {
  let payload = {
    title: 'Sweet Chat 🍬',
    body: 'You received a new message!',
    icon: '/icon-192.png', // Uses your existing public icon asset
    badge: '/icon-192.png',
    data: { url: '/' }
  };

  if (event.data) {
    try {
      const data = event.data.json();
      payload.title = data.title || payload.title;
      payload.body = data.body || payload.body;
      if (data.data) payload.data = data.data;
    } catch (e) {
      // Fallback if the payload from the server is straight text
      payload.body = event.data.text();
    }
  }

  // Keep the service worker alive until the native device banner renders
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      vibrate: [100, 50, 100], // Premium soft pulse vibration on mobile devices
      data: payload.data,
      tag: 'sweet-chat-msg', // Collapses duplicate updates nicely
      renotify: true
    })
  );
});

// Handle clicking on the notification banner when app is closed
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  // Wake up or focus the window shell
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});