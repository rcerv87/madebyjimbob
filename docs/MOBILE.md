# Mobile app

## Stack
- Expo (React Native), TypeScript, Expo Router.
- `expo-video` for playback: HLS, PiP, background audio, now-playing controls.
- `react-native-gesture-handler` + `react-native-reanimated` for player gestures.
- `react-native-purchases` (RevenueCat) for subscriptions and tip IAP.
- Shared API client and types from `packages/shared` (MBJ-004).

## Player requirements
| Feature | Implementation |
|---|---|
| Background audio / locked screen | `player.staysActiveInBackground = true`; config plugin `supportsBackgroundPlayback: true` |
| Lock-screen / notification controls | `player.showNowPlayingNotification = true`; set title and artwork |
| Picture-in-picture | `allowsPictureInPicture`, `startsPictureInPictureAutomatically`; plugin `supportsPictureInPicture: true` |
| Listen-only | Hide video view, keep player running, prefer audio-only rendition when available (MBJ-502) |
| Double-tap ±10s | Tap gesture with `numberOfTaps(2)` on left/right thirds |
| Long-press 2× | Long-press gesture sets `playbackRate = 2`, restores on release |
| Pinch zoom | Pinch gesture scales the video view (clamped 1×–3×), double-tap resets when zoomed |

YouTube-embedded live streams (Phase 3) can't do background audio or PiP; passive listening for those relies on owned audio (Phase 4) or the podcast feed.

## Chat while backgrounded
- Background audio keeps the app alive; stop rendering chat while backgrounded.
- On foreground: fetch messages since the last seen id, then resume the socket.
- @mentions and tipped messages delivered as push notifications (Expo Notifications).

## Payments
- Subscriptions: RevenueCat offerings mapped to Plus / Premium entitlements.
- Tips: consumable IAP products at fixed price points.
- Where platform rules allow, link to web checkout for lower fees.

## Release
- EAS Build and EAS Submit. Internal testing tracks first (TestFlight, Play internal).
