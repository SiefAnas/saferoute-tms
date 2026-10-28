import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { createBiometricTokenStore } from './biometricToken'

// The app's one biometric-locked token, on expo-secure-store (keychain / Android keystore),
// never AsyncStorage. See biometricLogic.ts for how biometric unlock works.
export const biometricToken = createBiometricTokenStore({
  store: SecureStore,
  keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
  isAvailable: () => {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') return false
    try {
      return SecureStore.canUseBiometricAuthentication()
    } catch {
      return false
    }
  },
})
