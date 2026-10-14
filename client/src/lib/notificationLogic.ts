// Pure notification helpers (no React, no fetch), so they can be tested with plain Node.

// The website page a notification opens: data.web_route when it is an in-site path, never a URL.
export function webRouteOf(data: { web_route?: unknown } | null | undefined): string | null {
  const r = data?.web_route
  return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : null
}

// The VAPID public key (base64url) as the bytes PushManager.subscribe wants.
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

// "99+" on the bell past 99, nothing at zero.
export function badgeText(count: number): string | null {
  if (!count || count < 1) return null
  return count > 99 ? '99+' : String(count)
}
