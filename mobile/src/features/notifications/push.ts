import { Platform } from 'react-native'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { api } from '@/api'
import { permissionView, type PermissionView } from './logic'

// Push notifications on the phone (branch push-notifications), through the Expo push service:
//  - this device's Expo push token is sent to the API after sign-in (POST /notifications/devices)
//    and removed at log out (DELETE /notifications/devices), so pushes follow the person signed in;
//  - the system permission is only asked for when the person taps "Turn on" on the notification
//    screen, after our own explanation, never at first launch (iOS asks once only);
//  - a "no" changes nothing else: the in-app list and the bell still work.
// Needs a development or store build (EAS). Expo Go can't receive remote pushes on Android.

const TOKEN_KEY = 'saferoute.pushToken'

// Shown while the app is open, too (banner + in the list), with sound.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

// Android 8+ needs a channel before anything shows, and Android 13+ only offers the permission
// prompt once a channel exists. The server sends with channelId 'default'.
async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync('default', {
    name: 'SafeTurns',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
  })
}

function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null
}

export async function getPermissionView(): Promise<PermissionView> {
  if (!Device.isDevice) return permissionView(null, false)
  const p = await Notifications.getPermissionsAsync()
  return permissionView(p, true)
}

// Only call from a button the person tapped. Returns the new state.
export async function requestPermission(): Promise<PermissionView> {
  if (!Device.isDevice) return 'unsupported'
  await ensureAndroidChannel()
  const p = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: true, allowSound: true },
  })
  const view = permissionView(p, true)
  if (view === 'on') await registerThisDevice()
  return view
}

// After sign-in (and at app start with a session): register this device if the person already
// allowed notifications. Never prompts. Quietly does nothing in the simulator, without
// permission, or before the EAS project id is set (app.config.ts extra.eas.projectId).
export async function registerThisDevice(): Promise<boolean> {
  try {
    if (!Device.isDevice) return false
    const { granted } = await Notifications.getPermissionsAsync()
    if (!granted) return false
    const id = projectId()
    if (!id) {
      console.warn('[push] no EAS projectId in app config (EAS_PROJECT_ID); push registration skipped')
      return false
    }
    await ensureAndroidChannel()
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id })
    await api.post('/notifications/devices', {
      kind: 'expo',
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      device_name: Device.deviceName ?? Device.modelName ?? null,
    })
    await SecureStore.setItemAsync(TOKEN_KEY, token)
    return true
  } catch (err) {
    console.warn('[push] registration failed', err)
    return false
  }
}

// Log out (or the session ended): stop pushes to this phone for the person who was signed in.
// The API doesn't need a valid session for this, so it works after a 401 too. Best effort: a
// failure (no signal) is fine, the next person to sign in on this phone takes the token over.
export async function unregisterThisDevice(): Promise<void> {
  let token: string | null = null
  try {
    token = await SecureStore.getItemAsync(TOKEN_KEY)
    if (!token) return
    await SecureStore.deleteItemAsync(TOKEN_KEY)
    await api.delete('/notifications/devices', { token })
  } catch {
    // ignored on purpose (see above)
  }
}
