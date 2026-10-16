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
- Not in the apps yet: native push, background audio with the screen locked, the share sheet, links that open the
  app, Google sign-in (MBJ-403, 405, 110).

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
