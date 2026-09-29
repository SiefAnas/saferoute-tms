# Task: put the new SafeTurns logo in the website and the mobile app

The final logo is decided. It's a shield with a turn arrow inside, and next to it the name "safeturns" in lowercase ("safe" in one color, "turns" in an accent color). Everything you need is in this folder, `design-reference/brand/safeturns-logo/`. Open `preview.png` first to see how it should look.

Work on a new branch `brand-logo`. Don't touch `server/`. Don't push to `main`.

## The main rule: light mode = amber, dark mode = evergreen

The logo changes colors with the app theme:

- **Light theme:** the amber logo
- **Dark theme:** the evergreen logo

Also pick the version by what is behind the logo:

- **"on-light":** for light backgrounds
- **"on-dark":** for dark backgrounds

For example, the web sidebar is dark slate in both themes, so it always uses "on-dark".

| Theme | Surface | Shield | Arrow | "safe" | "turns" |
|---|---|---|---|---|---|
| light (amber) | on-light | `#111318` | `#F59E0B` | `#111318` | `#B86E00` |
| light (amber) | on-dark | `#F59E0B` | `#111318` | `#FAF8F3` | `#F59E0B` |
| dark (evergreen) | on-light | `#123C36` | `#F5F0E6` | `#123C36` | `#23876A` |
| dark (evergreen) | on-dark | `#F5F0E6` | `#123C36` | `#F5F0E6` | `#8FD9B8` |

Only the logo changes with the theme. Don't change any other app color. Amber stays the action color everywhere like it is now.

## Fonts

The name uses Bricolage Grotesque 700, but it's already turned into paths inside the lockup SVGs. **Don't load Bricolage anywhere**, and don't change the app fonts (Inter and Public Sans stay).

## Files in this folder

- `svg/mark-{amber|evergreen}-on-{light|dark}.svg`: the shield only, viewBox `10 4 44 56`.
- `svg/lockup-{amber|evergreen}-on-{light|dark}.svg`: shield + name, viewBox `10 4 290.97 56`, so width = height × 5.196.
- `svg/favicon.svg`: switches by itself with the OS dark mode. `svg/favicon-light.svg` and `svg/favicon-dark.svg` are fixed versions.
- `web/`: favicon.ico (16/32/48), favicon PNGs, apple-touch-icon.png (180), icon-192.png, icon-512.png.
- `mobile/`: all the Expo icon and splash PNGs (1024 px).
- `png/`: PNG copies of the marks and lockups, in case you need them somewhere.

Shield geometry, if you build the components inline (viewBox `0 0 64 64` base):

- shield: `M32 5 L53 12.5 V29 C53 43.5 44 53 32 59 C20 53 11 43.5 11 29 V12.5 Z` (fill)
- arrow stem: `M24 44 V31 A7 7 0 0 1 31 24 H38`
- arrow head: `M34 17.5 L40.5 24 L34 30.5`
- both arrow paths: `fill="none"`, `stroke-width="5"`, `stroke-linecap="round"`, `stroke-linejoin="round"`

For the name, copy the two `<path>` elements inside the `<g transform=...>` of any `lockup-*.svg`, keeping the transform. The first path is "safe", the second is "turns". They are the same in all 4 lockup files, only the fill colors change.

## Web (`client/`)

1. **Logo component.** Make `src/components/Logo.tsx` with an inline SVG, like `<Logo kind="mark" | "lockup" surface="light" | "dark" | "auto" className=... />`.
   - Size it by height with CSS; the width follows the viewBox.
   - Colors come from CSS variables, not hard-coded hexes. Add them in `src/index.css` for the light theme, and override them under `[data-theme='dark']` with the evergreen values from the table.
   - `surface="auto"` means on-light in the light theme and on-dark in the dark theme, for surfaces that flip with the theme (cards, top bar, auth pages).
   - Give it `role="img"` and `aria-label="SafeTurns"`.
2. **Sidebar (`src/layouts/AdminLayout.tsx`, the `brand` block).** Swap the `local_shipping` truck icon inside the amber button for the logo mark (surface dark). Keep the collapse button working as it does now, and keep the hub name and org name text. If the amber square button behind the shield looks bad, make the button background transparent with a subtle hover. Check it in both the expanded and the collapsed rail.
3. **Wide mobile shell (`src/components/mobile.tsx`, around line 146).** Where it shows the text "SafeTurns" on the dark sidebar, use the lockup (surface dark) instead.
4. **Auth pages (login, register, password pages, whatever uses `AuthScreen`).** Show the lockup (surface auto, about 36 to 40 px tall) where the "SafeTurns" title is. Keep a real heading for screen readers (visually hidden is fine).
5. **Favicons.**
   - Copy `svg/favicon.svg`, `svg/favicon-light.svg`, `svg/favicon-dark.svg` and everything in `web/` into `client/public/`. The new `favicon.svg` replaces the old Vite one.
   - In `index.html` add:
     ```html
     <link rel="icon" href="/favicon.ico" sizes="48x48">
     <link rel="icon" id="favicon-svg" href="/favicon.svg" type="image/svg+xml">
     <link rel="apple-touch-icon" href="/apple-touch-icon.png">
     ```
   - Make the tab icon follow the app's own theme toggle, not only the OS. In `src/lib/theme.ts` `apply()`, set the `#favicon-svg` href to `/favicon-dark.svg` or `/favicon-light.svg`. Do the same in the small inline script in `index.html`, so it's right before first paint.
6. **Optional.** If it's simple, add `public/site.webmanifest` with name SafeTurns, icons 192 and 512, `theme_color` `#111318`, `background_color` `#FAF8F3`, and link it.

## Mobile (`mobile/`, Expo SDK 57)

1. **Assets.** Copy these from `mobile/` over the old ones in `mobile/assets/`:
   - `icon.png`
   - `android-icon-foreground.png`
   - `android-icon-background.png`
   - `android-icon-monochrome.png`
   - `favicon.png`

   Also add `ios-icon-light.png`, `ios-icon-dark.png`, `ios-icon-dark-filled.png`, `ios-icon-tinted.png`, `splash-icon-light.png` and `splash-icon-dark.png`. Delete the old `splash-icon.png` only if nothing uses it anymore.
2. **`app.config.ts`.**
   - **iOS icon:** use the light, dark and tinted icons (`ios.icon` as an object with `light`, `dark`, `tinted`). Check the Expo SDK 57 docs for the exact shape first. Apple wants the dark icon on a transparent background, which is `ios-icon-dark.png`. If Expo needs a filled one, use `ios-icon-dark-filled.png`.
   - **Android icon:** keep `adaptiveIcon.backgroundColor: '#111318'`. Android can't switch the app icon with dark mode, so it stays the amber one. The monochrome file is for Android themed icons.
   - **Splash (`expo-splash-screen` plugin):**
     - light: image `./assets/splash-icon-light.png` on `#fafafa`
     - dark: `dark: { image: './assets/splash-icon-dark.png', backgroundColor: '#141a22' }`
     - use an `imageWidth` around 120 to 140

     Check the plugin options for SDK 57.
3. **Logo component.** Add `react-native-svg` with `npx expo install react-native-svg`, then make `src/components/Logo.tsx` with the same props as the web one.
   - Pick the colors with `useTheme().isDark` from `src/theme/theme.tsx` (light = amber, dark = evergreen), plus the surface prop.
   - Keep the path strings in one file in the mobile app, with a comment that points to `design-reference/brand/safeturns-logo/`.
4. **Login screen (`app/login.tsx`).** Replace the `{APP_NAME}` text with the lockup (about 36 px tall), and use `APP_NAME` as its `accessibilityLabel`. Leave the other screens as they are for now.

## Checks before you commit

- **Web:** `npm test`, `tsc -b` and `vite build` all clean. Then look at:
  - light and dark mode
  - the sidebar expanded and collapsed
  - the login page at desktop and phone width
  - the tab icon when you switch the theme in the app
- **Mobile:**
  - `npm run typecheck`, `npm run lint` and the tests
  - run `npx expo prebuild --clean` in a temp copy, or `npx expo config --type public`, to make sure the icon and splash config is valid
  - check the login screen in light and dark
- Commit in small steps on `brand-logo`. At the end, write a short report: what changed, where the logo shows up now, and anything you couldn't do. Include the Expo icon config if the docs said something different from what I wrote here.
