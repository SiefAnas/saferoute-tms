import type { ExpoConfig } from 'expo/config'

// ─────────────────────────────────────────────────────────────────────────────
// The only place to change the app's identity or which API it talks to.
// "SafeRoute" is a working name and will change before publishing, so keep it here.
// ─────────────────────────────────────────────────────────────────────────────
const APP_NAME = 'SafeRoute'
const SLUG = 'saferoute'
const SCHEME = 'saferoute'
const BUNDLE_ID = 'com.saferoute.app' // ios.bundleIdentifier and android.package
const VERSION = '1.0.0'

// Production API (API_CONTRACT.md §1: no /api prefix — that's a web-only Vite proxy thing).
// EXPO_PUBLIC_API_BASE_URL overrides it for local server work without editing this file.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://saferoute-tms-api.onrender.com'
// ─────────────────────────────────────────────────────────────────────────────

const config: ExpoConfig = {
  name: APP_NAME,
  slug: SLUG,
  scheme: SCHEME,
  version: VERSION,
  orientation: 'portrait',
  icon: './assets/icon.png',
  // Follow the phone's light/dark setting (design: mobile tokens have both themes).
  userInterfaceStyle: 'automatic',
  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: true,
    infoPlist: {
      // Check-in/check-out save the driver's coordinates when the phone allows it
      // (GPS is optional server-side, see API_CONTRACT.md §3).
      NSLocationWhenInUseUsageDescription:
        'Your location is saved with your shift check-in and check-out, so your company can confirm where the shift started and ended.',
    },
  },
  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      backgroundColor: '#111318',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION'],
    predictiveBackGestureEnabled: false,
  },
  web: { favicon: './assets/favicon.png', bundler: 'metro' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        resizeMode: 'contain',
        backgroundColor: '#fafafa',
        dark: { backgroundColor: '#141a22' },
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiBaseUrl: API_BASE_URL,
    appName: APP_NAME,
  },
}

export default config
