import Constants from 'expo-constants'

// Everything here comes from `extra` in app.config.ts — that file is the single place to
// change the app name, the bundle id and the API URL.
const extra = (Constants.expoConfig?.extra ?? {}) as { apiBaseUrl?: string; appName?: string; webUrl?: string }

// Fallbacks only matter if the app somehow runs without its own manifest; they mirror
// app.config.ts's defaults so the app still starts instead of crashing on launch.
export const API_BASE_URL = extra.apiBaseUrl ?? 'https://saferoute-tms-api.onrender.com'
export const APP_NAME = extra.appName ?? 'SafeRoute'
// The website: admins open it for everything the app doesn't do (see WebsiteRow).
export const WEB_URL = extra.webUrl ?? 'https://saferoute-tms-client.onrender.com'
