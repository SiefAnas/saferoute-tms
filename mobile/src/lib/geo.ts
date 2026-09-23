import * as Location from 'expo-location'

export interface Coords {
  lat: number
  lng: number
}

// Best-effort location for shift check-in / check-out. GPS is optional server-side
// (server/src/services/sessions.js only validates the pair when it is present), and the
// server rejects a half-pair with 400, so this resolves to null — never a partial answer —
// on denial, timeout or any failure, and never blocks the driver from checking in.
export async function getCurrentCoords(timeoutMs = 6000): Promise<Coords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== Location.PermissionStatus.GRANTED) return null
    const position = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      timeoutMs,
    )
    if (!position) return null
    return { lat: position.coords.latitude, lng: position.coords.longitude }
  } catch {
    // A van in a parking garage, location services off, or a permission dialog the driver
    // dismissed — all of these must still allow the check-in to go through.
    return null
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      },
    )
  })
}
