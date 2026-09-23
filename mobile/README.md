# SafeRoute mobile app (drivers and parents)

Expo (React Native) app for **drivers** and **parents**. Admins, school admins and school staff
use the website; if they sign in here they see a "please use the website" screen.

It talks to the live API (`https://saferoute-tms-api.onrender.com`) by default. The API rules it
follows are in `../API_CONTRACT.md`; what the server still needs is in `../MOBILE_BACKEND_NEEDS.md`.

---

## Try it on your phone with Expo Go (Windows, first time)

You need: a Windows PC with **Node.js 20 or newer** (https://nodejs.org, the "LTS" installer),
**Git**, and an iPhone or Android phone. The phone and the PC should be on the **same Wi-Fi**.

1. **Install Expo Go on the phone.**
   iPhone: App Store → search "Expo Go". Android: Play Store → "Expo Go".
   (Expo Go runs the app without building it. It must support SDK 57; the store version does.)
2. **Get the code** (skip if you already have it). Open **PowerShell** and run:
   ```powershell
   git clone https://github.com/SiefAnas/saferoute-tms.git saferoute-mobile
   cd saferoute-mobile
   git checkout mobile-app
   ```
3. **Install the app's packages** (one time, takes a few minutes):
   ```powershell
   cd mobile
   npm install
   ```
4. **Start the app server:**
   ```powershell
   npx expo start
   ```
   A QR code appears in the window. If Windows asks whether to allow Node.js through the
   firewall, click **Allow** (tick "Private networks").
5. **Open it on the phone:**
   - **iPhone:** open the normal **Camera** app, point it at the QR code, tap the banner.
   - **Android:** open **Expo Go** → "Scan QR code" → scan it.
   The first load takes 20–60 seconds. Then the SafeRoute sign-in screen appears.
6. **Sign in** with a driver or parent account (ask Anas for a test account; passwords are
   never stored in the repo). The first sign-in after a quiet period can take up to a minute
   while the free server wakes up; the app says so.

**If the phone can't connect** (it keeps loading, or says "could not connect"):
- Make sure the phone and PC are on the same Wi-Fi (not the phone's mobile data, not a guest
  network).
- Or use a tunnel, which works over any network: stop the server with `Ctrl+C` and run
  `npx expo start --tunnel` (say **yes** if it asks to install `@expo/ngrok`), then scan again.

**To stop:** press `Ctrl+C` in PowerShell. Next time only steps 4–6 are needed
(`cd saferoute-mobile\mobile`, `npx expo start`).

---

## Where to change things

Everything lives at the top of **`app.config.ts`**:

| What | Where |
|---|---|
| App name shown on the phone | `APP_NAME` |
| Bundle id (iOS) / package (Android) | `BUNDLE_ID`, e.g. `com.yourcompany.saferoute`. Choose it before the first store build; it can't change after publishing. |
| Version | `VERSION` |
| API URL | `API_BASE_URL`, or without editing: `$env:EXPO_PUBLIC_API_BASE_URL="http://192.168.1.20:4000"; npx expo start` (use your PC's LAN IP, not `localhost`, for a server running on your PC) |
| App icon, splash | `assets/` (placeholders drawn by `scripts/make-icons.mjs`; replace the PNGs with the real logo, same sizes: 1024×1024; `icon.png` must have no transparency) |
| Colors | `src/theme/tokens.ts` |

---

## Building real apps later (EAS)

Expo Go is for testing. To put the app on TestFlight / the Play Store (or install it without
Expo Go), use Expo's build service **EAS**:

1. Create a free account at https://expo.dev, then in `mobile/`:
   ```powershell
   npm install -g eas-cli
   eas login
   eas init            # links this project to your Expo account (adds a projectId)
   ```
2. **Android test build (APK you can install directly):**
   `eas build --platform android --profile preview`, then download the APK from the link.
3. **iPhone build:** needs a paid **Apple Developer account** ($99/year).
   `eas build --platform ios --profile preview` (internal devices) or `--profile production`,
   then `eas submit --platform ios` to send it to TestFlight.
4. Store builds: `eas build --platform all --profile production`, then `eas submit`.

Profiles are in `eas.json`. The `development` profile is for a custom dev client and needs
`npx expo install expo-dev-client` first; you don't need it for Expo Go or store builds.

---

## For developers

```powershell
npm run typecheck     # tsc
npm run lint          # eslint
npm test              # jest
npm run doctor        # expo-doctor
npm run export:ios    # production bundle check (dist-ios, git-ignored)
npm run export:android
```

- Code: `app/` (screens, expo-router), `src/api` (API client, types), `src/auth` (sign-in, token
  in `expo-secure-store`), `src/features/driver|parent`, `src/components`, `src/theme`.
- Rules the app follows (from `../API_CONTRACT.md` §7):
  - The token lives only in the secure store. A 401 or logout clears it and all cached data.
  - "Today" never comes from `toISOString()`. Use `src/lib/localDate.ts`; business rules come
    from the server (`/schedule/today`, skip-status, 409 messages).
  - Parents only call `/parent/*`. Drivers only read their own data (never the company's
    student list).
  - Missing server features show "Coming soon", never fake data.
- Progress log: `../MOBILE_PROGRESS.md`.
