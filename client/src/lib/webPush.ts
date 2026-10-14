import { api } from './api'
import { keyBytes } from './notificationLogic'

// Browser push notifications (branch push-notifications): Web Push with the server's VAPID key,
// shown by public/sw.js even when no SafeTurns tab is open. Works in Chrome, Edge and Firefox
// (desktop and Android); Safari on Mac 16+; on iPhone only once SafeTurns is added to the Home
// Screen. The browser's permission prompt is only shown when the person clicks "Turn on".

const SUB_KEY = 'saferoute_push_endpoint'

export type WebPushState = 'unsupported' | 'unconfigured' | 'off' | 'on' | 'blocked'

export function webPushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

let keyPromise: Promise<string | null> | null = null
function serverKey() {
  keyPromise ??= api
    .get<{ public_key: string | null }>('/notifications/web-push-key')
    .then((r) => r.public_key)
    .catch(() => {
      keyPromise = null
      return null
    })
  return keyPromise
}


async function registration() {
  return navigator.serviceWorker.register('/sw.js')
}

export async function webPushState(): Promise<WebPushState> {
  if (!webPushSupported()) return 'unsupported'
  if (!(await serverKey())) return 'unconfigured'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission !== 'granted') return 'off'
  const reg = await navigator.serviceWorker.getRegistration('/sw.js')
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off'
}

// Subscribe this browser and tell the API. Asks for permission only when `ask` (a click).
async function subscribe(ask: boolean): Promise<WebPushState> {
  if (!webPushSupported()) return 'unsupported'
  const key = await serverKey()
  if (!key) return 'unconfigured'
  if (Notification.permission === 'default' && ask) await Notification.requestPermission()
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission !== 'granted') return 'off'
  const reg = await registration()
  await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }))
  await api.post('/notifications/devices', { kind: 'web', platform: 'web', device_name: navigator.userAgent.slice(0, 100), subscription: sub.toJSON() })
  localStorage.setItem(SUB_KEY, sub.endpoint)
  return 'on'
}

export const enableWebPush = () => subscribe(true)

// After sign-in: if this browser already allowed notifications, (re)register it for the person
// now signed in. Never prompts.
export function syncWebPush() {
  if (!webPushSupported() || Notification.permission !== 'granted') return
  void subscribe(false).catch(() => {})
}

// Log out: stop pushes to this browser for the person leaving. No session needed server-side.
export async function disableWebPush() {
  try {
    const endpoint = localStorage.getItem(SUB_KEY)
    localStorage.removeItem(SUB_KEY)
    if (webPushSupported()) {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js')
      const sub = await reg?.pushManager.getSubscription()
      await sub?.unsubscribe()
    }
    if (endpoint) await api.delete('/notifications/devices', { token: endpoint })
  } catch {
    // best effort: the next person to sign in on this browser takes the subscription over
  }
}

