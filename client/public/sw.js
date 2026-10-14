// SafeTurns service worker: browser push notifications only (no offline caching).
// The API sends { title, body, data } encrypted with Web Push (server/src/services/push.js).
// It shows even when no SafeTurns tab is open, as long as the browser is running. Clicking it
// focuses an open SafeTurns tab (or opens one) on data.web_route, else the notification list.
self.addEventListener('push', (event) => {
  let msg = {}
  try {
    msg = event.data ? event.data.json() : {}
  } catch {
    msg = { title: 'SafeTurns', body: event.data ? event.data.text() : '' }
  }
  const data = msg.data || {}
  event.waitUntil(
    self.registration
      .showNotification(msg.title || 'SafeTurns', {
        body: msg.body || '',
        data,
        icon: '/icon-192.png',
        badge: '/favicon-48.png',
        tag: data.notification_id || undefined,
      })
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((tabs) => tabs.forEach((tab) => tab.postMessage({ type: 'saferoute:notification' }))),
  )
})

function webPath(data) {
  const route = data && data.web_route
  return typeof route === 'string' && route.startsWith('/') && !route.startsWith('//') ? route : '/notifications'
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const target = new URL(webPath(data), self.location.origin)
  if (data.notification_id) target.searchParams.set('read', data.notification_id)
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
      const tab = tabs.find((t) => new URL(t.url).origin === self.location.origin)
      if (tab) return tab.focus().then(() => tab.navigate(target.href))
      return self.clients.openWindow(target.href)
    }),
  )
})
