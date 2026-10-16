# ADR-014: The phone apps wrap the web app with Capacitor

- **Status:** Accepted (supersedes ADR-008)
- **Date:** 2026-10-15

## Context

ADR-008 (2026-09-29) chose Expo: a React Native app rebuilt screen by screen next to the website. Since then the web
app has grown to dozens of screens (watch page with chat, comments, notes and reactions, Studio, accounts, payments,
membership, the hotspot strip), all responsive and tested on phones. Rebuilding them in React Native would take months
and leave two front ends to keep in step. Ruben asked on 2026-10-15 to wrap the existing app for Apple and Android.

## Decision

- **Capacitor 8** (`mobile/` workspace) wraps the same web build (`web/dist`) for iOS and Android. One front end: the
  website and the apps are the same code; `web/src/native.js` tells them apart at runtime (`isNativeApp()`).
- **App id `com.madebyjimbob.app`**, name **MADEbyJIMBOB**. The id can never change once an app is in a store.
- **Inside an app the pages live on the phone** (`capacitor://localhost` on iPhone, `https://localhost` on Android)
  and call the live site over the internet. The server answers those origins (CORS on `/api`, Better Auth's trusted
  origins; `APP_ORIGINS` adds more) and the apps **sign in with a Bearer token** (the `set-auth-token` header, already
  used by tests), kept on the phone. No cookies cross over.
- Things the apps do differently, all through `native.js`: the API and WebSocket addresses, share links (the site's
  address, not the phone's), video and thumbnail addresses that start with `/`, no service worker or Web Push (native
  push comes with MBJ-405), checkout and other outside pages open in the phone's browser (no embedded checkout), and no
  Google button (Google blocks sign-in inside an app's web view; the apps get native sign-in later).
- Native features come as Capacitor plugins when their stories are built: background audio and lock-screen controls
  (MBJ-403), push through FCM and APNs (MBJ-405), the share sheet, and links that open the app (universal links / app
  links).
- **Builds:** Android builds on Ruben's PC (Android Studio's Java and SDK are installed). iPhone builds need a Mac:
  a cloud Mac build service (Codemagic, or GitHub Actions' macOS machines) once there's an Apple developer account.

## Consequences

- Every web feature reaches the apps the day it ships; an app update is only needed for native changes (plugins,
  icons, settings). Store review still applies to each app release.
- **Store rules to meet before submitting** (not needed for test builds):
  - Apple 4.8: an iPhone app that offers Google sign-in must also offer Sign in with Apple. Today the apps offer
    neither (email and password only), so this applies only once Google comes to the apps.
  - Apple 3.1.1 and Google Play billing: selling digital access (memberships, super chats) inside an app normally has
    to go through the stores' own payments. The apps open checkout in the browser for now; before submitting, decide
    between selling nothing in the apps (members join on the website), the stores' payments (RevenueCat, ADR-007), or
    an outside-purchase link where the store allows it.
  - Apple 4.2 (minimum functionality): wrapped websites get rejected when they add nothing. Native push, background
    audio and the share sheet are what make this an app; ship them before the first App Store submission.
  - Apple 1.2 (user-generated content): reporting, blocking, filtering and banning already exist. Account deletion
    inside the app (5.1.1) exists too.
- Video storage has to allow the apps' origins: Cloudflare Stream already does; each R2 bucket's CORS policy needs
  `capacitor://localhost` and `https://localhost` added, or replays from R2 won't play in the Android app.
- ADR-008's player plan (expo-video, gestures) is dropped; the web player already has double-tap seek, long-press 2×
  and Listen only.
