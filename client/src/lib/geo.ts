export interface Coords {
  lat: number
  lng: number
}

// Best-effort geolocation with a short timeout. GPS is optional at check-in/out
// (server/src/services/sessions.js only validates coords if present), so this resolves
// to null on denial/timeout/unavailability rather than ever blocking the action.
export function getCurrentCoords(timeoutMs = 4000): Promise<Coords | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve(null)
      return
    }
    const timer = setTimeout(() => resolve(null), timeoutMs)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer)
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
      { timeout: timeoutMs },
    )
  })
}
