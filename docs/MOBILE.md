# Phone apps

The iPhone and Android apps are the web app wrapped with **Capacitor 8** (ADR-014). They live in `mobile/`: the
Capacitor settings (`capacitor.config.json`), the Android project (`mobile/android`) and the iPhone project
(`mobile/ios`). The pages themselves are the normal web build (`web/dist`), copied into each app.

## Where we are (2026-10-15)

- **Android:** builds on Ruben's PC and runs in the emulator. Checked there: sign-up and sign-in (token), the welcome
  steps, a Cloudflare Stream video playing, chat (read and post), saving watch progress, notes, sign-out. Status bar
  and top bar fit Android 15's edge-to-edge screens. App icon and launch screen use JimBob's art.
- **iPhone:** the project is generated (Swift Package Manager, no CocoaPods) but has never been built: that needs a
  Mac. Untested: everything on iOS.
- **Android background audio and lock-screen controls (MBJ-403, 2026-10-15):** while something plays, Android shows a
  media card (title, JimBob, play/pause, progress, previous/next when there's somewhere to go) and runs a media
  service so the app isn't closed in the background. Checked in the emulator: home screen and a minute with the screen
  off keep playing, the card's pause and play work, the video comes back on return. Through `web/src/mediaControls.js`
  and the `@capgo/capacitor-media-session` plugin (Android only; the website and the iPhone app use the browser's
  Media Session).
- **Android store build (MBJ-407, 2026-10-15):** release builds are signed with the upload key; `bundleRelease` makes
  the `.aab` Google Play takes. See "Release builds" below.
- **Android back button, links and share sheet (MBJ-408, 2026-10-16):** back closes an open menu or dialog, then goes
  back a page, then home, and from home leaves the app (playback keeps going). Links to the site's video, playlist,
  live, posts, profile, shop and art pages open the app when it's installed (the site's
  `/.well-known/assetlinks.json` vouches for the app's signing key; Android checks it when the app is installed), at
  that page, whether the app was closed or open. Share opens Android's own share sheet. Checked in the emulator.
- Not in the apps yet: native push, Google sign-in (MBJ-405, 110), and the iPhone side of background audio and links.

## How the apps differ from the website

All of it goes through `web/src/native.js`; the same build runs in a browser and in the apps.

| | Website | Apps |
|---|---|---|
| Where the pages come from | madebyjimbob.app | the phone (`https://localhost` Android, `capacitor://localhost` iPhone) |
| API and WebSocket | same address | `https://madebyjimbob.app` (`VITE_SITE_URL` for a test build) |
| Signed in with | session cookie | Bearer token from the `set-auth-token` header, kept on the phone |
| Share links, `/…` video and thumbnail addresses | this address | the site's address |
| Service worker, Web Push, Install app, iPhone "Add to Home Screen" hint | yes | no |
| Checkout, billing, outside links | in the page | the phone's browser |
| Continue with Google | yes | no (Google blocks it inside an app) |

The server answers the apps' origins on `/api` (CORS; `APP_ORIGINS` adds more) and Better Auth trusts them.

## Building Android on Ruben's PC

Android Studio is installed, with its Java (`C:\Program Files\Android\Android Studio\jbr`) and the SDK
(`%LOCALAPPDATA%\Android\Sdk`, Android 35 and 36) and two emulators (Pixel 9 Pro, Pixel 4).

```bash
npm run build                      # the web app (add VITE_SITE_URL=http://localhost:3000 for a local test build)
cd mobile && npx cap sync android  # copy it into the Android project
cd android
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ANDROID_HOME="$LOCALAPPDATA/Android/Sdk"
./gradlew assembleDebug            # → app/build/outputs/apk/debug/app-debug.apk
```

Or open it in Android Studio: `npm run open:android -w mobile`.

**Emulator:** `emulator -avd Pixel_9_Pro` (add `-no-window` to run it hidden), then `adb install -r <apk>`. A local
test build talks to the PC's server through `adb reverse tcp:3000 tcp:3000`; debug builds allow plain http for that
(`android/app/src/debug/AndroidManifest.xml`), store builds don't. Debug builds let Chrome DevTools inspect the app's
page: `adb forward tcp:9250 localabstract:webview_devtools_remote_<pid>`, then `http://127.0.0.1:9250/json`.

**On a phone:** copy `app-debug.apk` to the phone and open it (Android asks to allow installing from that app), or with
USB debugging on, `adb install -r app-debug.apk`. A debug build is for testing only; the Play Store needs a signed
release build (`./gradlew bundleRelease` with the upload key, MBJ-407).

## Release builds (Google Play)

The **upload key** signs every build sent to Google Play. It lives outside the repo:
`C:\Users\office\.madebyjimbob-keys\android-upload-key.jks`, with its passwords in `keystore.properties` in the same
folder (a copy sits in `mobile/android/keystore.properties`, which git ignores). **Back up both files** somewhere
private (a password manager or a private cloud folder; never email, never the repo). With Play App Signing, Google
keeps the key that signs the app people install, so a lost upload key can be replaced through Play support, but it
takes days.

```bash
npm run build && cd mobile && npx cap sync android && cd android
./gradlew bundleRelease           # → app/build/outputs/bundle/release/app-release.aab
```

Raise `versionCode` in `mobile/android/app/build.gradle` for every upload (and `versionName`, which people see).
Upload key fingerprint (SHA-256, public): `90:0D:10:83:10:C7:D6:B1:2D:03:9D:12:8D:77:2A:78:96:13:AD:D7:80:F8:1B:01:42:4E:38:B2:51:8D:36:B6`.

**Google Play's rule for new personal developer accounts:** before an app can go to production, it needs a closed
test with at least 12 testers who stay opted in for 14 days in a row. Organization accounts (a business, with a free
D-U-N-S number) skip that. Check the current rule when creating the account.

## Links that open the app

The pages are listed twice and must match: `APP_LINK_PATHS` in `server/src/app.js` (the iPhone file) and the
`<intent-filter android:autoVerify="true">` in `mobile/android/app/src/main/AndroidManifest.xml`. Android only opens
links in the app when the key that signed the installed app is in `/.well-known/assetlinks.json`: today that's the
upload key (sideloaded release builds). Once the app is in Google Play, add **Play's app signing key** fingerprint
(Play Console → Test and release → App integrity → App signing) to `ANDROID_CERT_SHA256` on Render, comma-separated
with the upload key's. Debug builds aren't covered; open links in them with
`adb shell am start -a android.intent.action.VIEW -d <url> com.madebyjimbob.app`. Check what Android decided:
`adb shell pm get-app-links com.madebyjimbob.app`. The iPhone file appears once `APPLE_TEAM_ID` is set.

## Building for iPhone

Needs a Mac with Xcode, so from this Windows PC that means a cloud Mac:
- **Codemagic** (free tier: 500 build minutes a month on Mac), or **GitHub Actions** macOS machines (private repos:
  macOS minutes count 10× against the 2,000 free minutes, so roughly 20 builds a month).
- An **Apple Developer account** ($99 a year) to sign builds and use TestFlight. Without it an iPhone build can't be
  installed on a phone.
- Open-on-a-Mac alternative: `npx cap open ios` in Xcode.

## Icons and launch screens

`python mobile/scripts/make-icons.py [--art <image>]` (Python with Pillow) writes the Android launcher icons
(including the adaptive icon on brand teal), the iPhone icon (1024 px) and both apps' launch screens from JimBob's
art. The current source is 512 px; a 1024 px original would give a sharper App Store icon.

## Before the stores (MBJ-407)

- Developer accounts: Apple ($99/year) and Google Play ($25 once), ideally JimBob's (the account holder's name shows
  as the seller; apps can be transferred later, but it's paperwork). See `docs/MIGRATION.md`.
- The store rules in ADR-014: Sign in with Apple if Google sign-in comes to the iPhone app; a decision on buying
  inside the apps; native features so the app isn't "just a website"; privacy labels and data safety forms.
- Each R2 bucket's CORS policy must allow `capacitor://localhost` and `https://localhost`.
- Release signing: a Play upload key (kept safe; losing it is painful) and Apple certificates through the build
  service.
