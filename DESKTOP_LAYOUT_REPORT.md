# Driver and parent pages: desktop layout (branch `web-desktop-layout`)

Date: 2026-09-23. Client only: no backend changes, same endpoints, same Coming soon items.

## How it works
- **Phone (under 768px):** exactly the approved mobile design (3a driver, 5b parent). Same
  markup and classes as before: greeting header, scroll area, action bar, bottom tabs.
- **Tablet and desktop (768px and wider):** a website shell in the admin pages' style:
  - slate sidebar with the amber tile ("SafeRoute" + "Driver" / "Parent"), the tabs as sidebar
    links (Week keeps its Coming soon, with a "Soon" chip), user, theme toggle and logout in the
    footer;
  - a top bar with the greeting and the date line (driver: date · van · plate);
  - the web palette (amber primary action, admin cards), light and dark;
  - the page's action area (check in, picked up / no-show, skip pickup) is a bar along the bottom
    of the content, right-aligned and max 520px wide, instead of a full-width phone bar;
  - confirm dialogs ("Switch to Afternoon?") are centered instead of pinned to the bottom.
- **Wide desktop (1024px and wider):** side-by-side panels where it helps (below).

Why 768px: the same breakpoint (`md`) the admin shell uses to switch to its sidebar.

## Screens
| Screen | Desktop look |
|---|---|
| Driver Today | Left: shift switch, status, progress and the run list. Right (from 1024px): the selected student's details as a panel (route, notes, contacts with call buttons, school); defaults to the next stop, the selected row is highlighted. From 768–1023px the list is one column and a tap opens the usual bottom sheet. Check in / Picked up / No-show in the bottom action bar. |
| Driver Trips | Same list in the wide content area. |
| Driver Week | Same Coming soon card (V2). |
| Driver Pay | From 1024px: pay card and "Days worked" calendar side by side. |
| Parent Students | From 1024px: "Your children" list on the left, the selected child on the right (status, Live location · Coming soon, Today times, driver card with call button). Skip pickup in the bottom action bar. 768–1023px: one column, child chips as on the phone. |
| Parent Profile | Details card in a column max 680px wide. |

## Files
- `client/src/components/mobile.tsx`: `MobileShell` now picks `PhoneShell` (unchanged) or
  `WideShell`; `ThumbBar` renders the wide action bar; `ConfirmCard` centered from md.
- `client/src/lib/useMediaQuery.ts` (new): `MD_QUERY`, `LG_QUERY`.
- `client/src/index.css`: `.web-portal` gives the mobile-only color roles (shift switch, call
  button, pay calendar, notes) web values in light and dark.
- `client/src/layouts/DriverLayout.tsx`, `ParentLayout.tsx`: pass title/sub instead of a header.
- `client/src/pages/driver/StudentSheet.tsx`: content split so it renders as a sheet or a panel
  (`StudentPanel`).
- `client/src/pages/driver/DriverTodayPage.tsx`, `DriverPayPage.tsx`,
  `client/src/pages/parent/ParentHomePage.tsx`, `ParentProfilePage.tsx`: wide-screen layout.

## Checks
- Every driver screen (Today, Trips, Week, Pay) and parent screen (Students, Profile) at 390, 820
  and 1440px: no element past the right edge, page width = window width (no horizontal
  scroll), no button or link smaller than 32px. Phone shell below 768, website shell at 820 and
  1440. Light and dark checked (colors read from the page and screenshots). No console errors.
- Client `npm test` (5 + 27), `tsc -b`, `vite build`: pass.
- Test accounts used: the `…muelscel@example.test` driver and parent, through the local API.

## To see it
Open the website, log in as a driver or parent, and make the browser window at least **1024px**
wide (e.g. a normal laptop window at 1440px) for the side-by-side view; 768–1023px shows the
website shell in one column; under 768px is the phone design.

## Notes
- The browser tool I used doesn't fire resize events when it changes the emulated size, so each
  width was checked after a reload. Real browsers switch layouts live when the window is resized.
- Tablet (820px) Today and Parent use one column plus the bottom sheet / chips, since two columns
  next to a 240px sidebar get too narrow.
