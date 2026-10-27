/* Service worker de Pique: SOLO avisos push.
 * No intercepta pedidos ni guarda caché (sin handler de "fetch"), así nunca sirve pantallas viejas. */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { title: 'Pique', body: event.data ? event.data.text() : '' };
  }

  const actions = Array.isArray(data.actions) ? data.actions : [];
  const options = {
    body: data.body || '',
    icon: '/favicon-192.png',
    badge: '/favicon-48.png',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/bookings', actions },
    // Android muestra hasta 2 botones; iPhone no los muestra y abre la URL principal.
    actions: actions.slice(0, 2).map((item) => ({ action: item.action, title: item.title })),
  };

  event.waitUntil(self.registration.showNotification(data.title || 'Pique', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let url = data.url || '/bookings';
  if (event.action) {
    const match = (data.actions || []).find((item) => item.action === event.action);
    if (match && match.url) url = match.url;
  }
  const target = new URL(url, self.location.origin).href;

  event.waitUntil((async () => {
    // Enlaces externos (ej. Google Maps): ventana nueva.
    if (!target.startsWith(self.location.origin)) {
      return self.clients.openWindow(target);
    }
    // Si Pique ya está abierto, se reutiliza esa ventana.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) {
          try {
            await client.navigate(target);
          } catch (error) {
            // Ventanas no controladas no se pueden navegar: se abre una nueva.
            return self.clients.openWindow(target);
          }
        }
        return undefined;
      }
    }
    return self.clients.openWindow(target);
  })());
});
