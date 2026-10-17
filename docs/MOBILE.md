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
- **Android notifications (MBJ-405, 2026-10-16):** on (Firebase project `madebyjimbob-e9aea` in Ruben's Google
  account; "Notifications" below). Turn on asks Android for permission and registers the phone for the signed-in
  account; replies arrive as phone notifications (channel "Replies and mentions", a play-button icon in JimBob's
  teal); tapping one opens the thread ("From your notification"); signing out stops them. Checked end to end in the
  emulator against the PC's server (permission prompt, notification with the app in the background, tap, sign-out),
  plus server tests with a stand-in Firebase; an app built without Firebase's file starts and hides the option.
- **Android Google sign-in (MBJ-110, 2026-10-16):** Continue with Google opens the phone's "Choose an account" picker
  and signs in to the live site. Checked in the emulator with both a test build (debug key) and a store-signed build
  (upload key), each against the live site, then signed out. App version 0.1.1 (versionCode 2).
- Not in the apps yet: going live from the phone without OBS (MBJ-409, backlog), and the iPhone side of background
  audio, links, notifications and Google sign-in.

## How the apps differ from the website

All of it goes through `web/src/native.js`; the same build runs in a browser and in the apps.

| | Website | Apps |
|---|---|---|
| Where the pages come from | madebyjimbob.app | the phone (`https://localhost` Android, `capacitor://localhost` iPhone) |
| API and WebSocket | same address | `https://madebyjimbob.app` (`VITE_SITE_URL` for a test build) |
| Signed in with | session cookie | Bearer token from the `set-auth-token` header, kept on the phone |
| Share links, `/…` video and thumbnail addresses | this address | the site's address |
| Service worker, Web Push, Install app, iPhone "Add to Home Screen" hint | yes | no |
| Notifications | Web Push | the phone's own, through Firebase (Android; MBJ-405) |
| Checkout, billing, outside links | in the page | the phone's browser |
| Continue with Google | Google's page | the phone's own account picker (Android; iPhone once its client id is set, MBJ-110) |

The server answers the apps' origins on `/api` (CORS; `APP_ORIGINS` adds more) and Better Auth trusts them.

## Building Android on Ruben's PC

Android Studio is installed, with its Java (`C:\Program Files\Android\Android Studio\jbr`) and the SDK
(`%LOCALAPPDATA%\Android\Sdk`, Android 35 and 36) and two emulators (Pixel 9 Pro, Pixel 4).

```bash
npm run android -w mobile          # web app → Android project → app/build/outputs/apk/debug/app-debug.apk
npm run android -w mobile -- --site http://localhost:3000   # a test build that talks to this PC's server
```

`mobile/scripts/build-android.mjs` does the three steps (and sets Java and the SDK); by hand they are:

```bash
npm run build                      # the web app (VITE_SITE_URL=http://localhost:3000 for a local test build;
                                   # VITE_NATIVE_PUSH=1 when google-services.json is there)
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
npm run android:release -w mobile  # → app/build/outputs/bundle/release/app-release.aab (and a signed .apk)
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

## Notifications (Firebase)

Replies reach the apps through **Firebase Cloud Messaging** (free). The server sends them from `server/src/fcm.js`
(Firebase's HTTP v1 API with the service account key in `FCM_SERVICE_ACCOUNT`, no Firebase SDK; base64 in the local
`.env`, the JSON as is on Render) next to Web Push,
from the same `notifyFor()`, with the same per-type settings. Each app install's token is in `device_tokens`; a
token Firebase calls gone (uninstalled, replaced, or from an earlier Firebase project) is deleted. In the app,
`web/src/push.js` asks for permission, makes the Android channel `activity` ("Replies and mentions"), registers,
re-registers on every start while signed in (tokens change; a phone moves to whoever signs in), opens a tapped
notification's page, and forgets the phone on sign-out.

Both sides switch on only when set up: the server when `FCM_SERVICE_ACCOUNT` is a service account key (`/api/push/key`
answers `native: true`), the app when it was built with `mobile/android/app/google-services.json` (the build script
then sets `VITE_NATIVE_PUSH=1`). An app built without that file must never ask Android for a token: the plugin
calls Firebase unguarded and the app crashes.

**Setting up Firebase** ($0; about 10 minutes):

1. Go to console.firebase.google.com and sign in with the Google account that should own it (Ruben's for the beta).
2. **Create a project** → name `MADEbyJIMBOB` → Continue → turn **Google Analytics off** → Create project → Continue.
3. On the project's page, click the **Android** icon (Add app) → Android package name `com.madebyjimbob.app`, app
   nickname `MADEbyJIMBOB` (leave SHA-1 empty) → **Register app** → **Download google-services.json** → save it as
   `C:\madebyjimbob\mobile\android\app\google-services.json` → Next → Next → Continue to console. (This file isn't
   secret, but git ignores it: GitHub flags the Google key inside. A copy sits next to the upload key.)
4. Gear icon (top left) → **Project settings** → **Service accounts** tab → **Generate new private key** → Generate
   key. A `.json` file downloads: **this one is secret**. Move it to
   `C:\Users\office\.madebyjimbob-keys\firebase-service-account.json` (next to the Android upload key).
5. Render → madebyjimbob → **Environment** → Add environment variable → key `FCM_SERVICE_ACCOUNT`, value: open that
   file in Notepad, Ctrl+A, Ctrl+C, paste → **Save, rebuild, and deploy**.
6. For local tests, add the same to the local `.env` (or ask Claude to, from the file, without showing it).

Then rebuild the app (`npm run android -w mobile`). **Testing:** the Pixel 9 Pro emulator has Google Play, which
Firebase needs; sign in, Account → Notifications → Turn on, then reply to that account's comment from the website.

**iPhone (not built):** the plugin hands back Apple's token, which Firebase can't send to as it is. Either add
Firebase's iPhone SDK (`@capacitor-firebase/messaging`) with an APNs key uploaded to Firebase, or send to Apple
directly with an APNs key. Both need the Apple Developer account. Until then the iPhone app shows no notification
option.

## Sign in with Google

Google refuses its sign-in page inside an app's web view, so the apps use the phone's own Google account picker
(`@capgo/capacitor-social-login`: Credential Manager on Android, Google Sign-In on iPhone; only Google and Apple are
bundled, see `plugins.SocialLogin` in `capacitor.config.json`). The picker hands back an ID token, the app sends it to
`POST /api/auth/sign-in/social` (`idToken`), and the server checks it with Google against the **web** client id, the
same as the website's sign-in (new members pick a username once; Google's tokens aren't kept). The app learns the
client ids from `/api/sign-in-options`.

Google Cloud (the project with the web client in `GOOGLE_CLIENT_ID`) needs, for **Android**, an Android OAuth client
per signing key, each with package `com.madebyjimbob.app` and that key's SHA-1: the upload key
(`AB:DE:72:DE:08:47:FD:5E:0F:CC:DC:B2:6B:59:7C:76:6E:FE:CD:67`), the debug key on Ruben's PC
(`A7:C1:23:75:5A:E5:2D:F6:C7:A4:34:54:43:8F:F8:FC:C1:20:8A:B2`), and Play's app signing key once the app is in Play.
Nothing goes in the app or on Render for those. If sign-in fails with "Developer console is not set up correctly"
(logcat: `GoogleProvider`), the SHA-1 of the installed build isn't registered.

For **iPhone**: an iOS OAuth client (bundle id `com.madebyjimbob.app`); its id goes in `GOOGLE_IOS_CLIENT_ID` on Render
and its "iOS URL scheme" (`com.googleusercontent.apps.…`) in `mobile/ios/App/App/Info.plist` under `CFBundleURLTypes`.
Apple requires **Sign in with Apple** in any app that offers Google sign-in, so turn both on together (the add-on has
Apple bundled already). Until `GOOGLE_IOS_CLIENT_ID` is set the iPhone app doesn't show Google.

## Building for iPhone

iPhone builds need a Mac, so they run on **Codemagic** (a cloud Mac; free tier: 500 Mac build minutes a month, about
20 builds) from `codemagic.yaml` at the repo root. The workflow `ios-testflight` runs by hand from codemagic.io:
1. `npm ci`, then `npm run build` (the web app, talking to the live site);
2. `npx cap sync ios`;
3. signing: `app-store-connect fetch-signing-files com.madebyjimbob.app --type IOS_APP_STORE --create` makes the
   Apple Distribution certificate and the App Store profile on the first build, then reuses them;
4. sets the build number to Codemagic's `$BUILD_NUMBER`, builds the `.ipa`, and uploads it to TestFlight.

What Codemagic holds:
- the team integration **MADEbyJIMBOB ASC** (an App Store Connect API key with the App Manager role: Issuer ID, Key
  ID and the `.p8` file);
- the environment group **ios_signing** with `CERTIFICATE_PRIVATE_KEY` (secret).

That key's file is `C:\Users\office\.madebyjimbob-keys\ios-distribution-certificate-key.pem`: back it up with the
Android upload key. If it's lost, revoke the certificate in the Apple Developer site and the next build makes a new
one with a new key.

The iPhone project uses Swift Package Manager (no CocoaPods). `npx cap sync ios` rewrites
`mobile/ios/App/CapApp-SPM/Package.swift` (commit it). The sign-in add-on's own hook drops the providers that are off
in `capacitor.config.json` (Facebook, X). Version: `MARKETING_VERSION` in `mobile/ios/App/App.xcodeproj/project.pbxproj`
(0.1.2, kept the same as Android's `versionName`). `ITSAppUsesNonExemptEncryption` is false in `Info.plist`: the app
only uses standard HTTPS, so TestFlight doesn't ask about encryption on every build. Internal TestFlight testing (up
to 100 people on the App Store Connect team) needs no App Review; external testers need Beta App Review.

On a Mac instead: `npx cap open ios` in Xcode.

## Icons and launch screens

`python mobile/scripts/make-icons.py [--art <image>]` (Python with Pillow) writes the Android launcher icons
(including the adaptive icon on brand teal), the iPhone icon (1024 px) and both apps' launch screens from JimBob's
art. The current source is 512 px; a 1024 px original would give a sharper App Store icon.

## Before the stores (MBJ-407)

- Developer accounts: Apple ($99/year) and Google Play ($25 once), ideally JimBob's (the account holder's name shows
  as the seller; apps can be transferred later, but it's paperwork). See `docs/MIGRATION.md`.
- The store rules in ADR-014: Sign in with Apple if Google sign-in comes to the iPhone app; a decision on buying
  inside the apps; native features so the app isn't "just a website"; privacy labels and data safety forms.
- Each R2 bucket's CORS policy allows `capacitor://localhost` and `https://localhost` (done 2026-10-16, both buckets).
- Release signing: a Play upload key (kept safe; losing it is painful) and Apple certificates through the build
  service.
