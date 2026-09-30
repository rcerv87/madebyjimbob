# MadeByJimBob — status

Last updated: 2026-09-29. Update this file when a story ships or a decision is made.
Story details and acceptance criteria: `BACKLOG.md` (generated from `docs/backlog_source.py`).

## At a glance

| | |
|---|---|
| Live site | https://madebyjimbob.onrender.com (Render: web service + Postgres; deploys on every push to `main`) |
| Code | https://github.com/rcerv87/madebyjimbob (private), branch `main` |
| Video | Cloudflare Stream, Starter bundle ($5/mo: 1,000 min stored, 5,000 min delivered). About 270 min used |
| Content | 4 videos (2 past live streams, 2 videos), 7,308 live-chat messages, 2,204 YouTube comments, 4 caption tracks / 43,435-word transcripts, JimBob's 9 YouTube playlists (252 entries; videos appear as they're imported) |
| Quality | 119 automated tests (79 server, 40 web), lint, formatting, CI on GitHub; migrations run before each deploy |
| Backlog | 77 stories; 15 done, 2 in progress |

## Waiting on Ruben

1. **Turn on phone push on the live site:** Render → `madebyjimbob` → Environment → add `VAPID_PRIVATE_KEY`
   with the value from your local `.env` (same name). Save; Render redeploys. The in-site bell works without it.
2. **Roll the Cloudflare API token** (it was pasted in chat): Cloudflare → My Profile → API Tokens → ⋯ → Roll,
   then update `CF_API_TOKEN` in `.env`.
3. **Decide R2 vs Stream** for the full library (`docs/adr/010-vod-on-r2.md`) before importing more than a few streams.
4. **GitHub branch rule:** Settings → Branches → rule for `main` → require the **CI / check** status (finishes MBJ-005).
5. **JimBob:** written OK to re-host his catalog (and shows with guests, especially behind a paywall);
   Google Takeout export of the channel (guide: the "JimBob's YouTube Backup" page); tier prices and perks;
   moderators; brand assets and domain.

## What's built

### Videos section
- **Videos** dashboard (home): chips All / Videos / Shorts / Live / Members only with counts, search on the
  server (titles and descriptions), sort by newest / oldest / most viewed; filters live in the URL.
  Video types come from import: past live streams are "Streamed", vertical ≤ 3 min are Shorts.
- Tabs **Videos · Playlists · Posts** (Posts is a "coming soon" page until MBJ-804).
- **Playlists**: JimBob's YouTube playlists imported in order (`npm run import:playlists -- <channel URL>`);
  videos not on the site yet appear once imported. Playlist page with Play all.
- **Studio playlists**: create, add, reorder, remove, rename, delete (YouTube ones are read-only there).
- **Up next**: playlist queue with position (e.g. 3 / 12) or the next video on the channel; Autoplay switch
  (remembered); 5-second end screen with Cancel / Play now; keeps Listen only on; lock-screen ⏭ / ⏮.

### Watching
- Stored videos from Cloudflare Stream; hls.js in Chrome/Edge/Firefox, Safari's own player on iPhone/iPad.
- Autoplay with sound when the browser allows it; otherwise a Play button (never starts muted).
- Resume where you left off (account when signed in, browser otherwise), "Resumed from mm:ss · Start over",
  `?t=` links, watched-progress bars on video cards.
- Gestures (double-tap ±10s, hold for 2×), J/K/L keys, speed picker (0.75×–2×), Mini player (PiP).
- **Listen only**: switches to Cloudflare's audio-only track at the same moment; keeps playing on a locked phone
  with lock-screen controls. Chat stays in sync.
- English auto-captions (CC in the player) on all 4 videos; transcripts stored in our database.
- Phone layout: video, then live chat, then comments.

### Conversation
- **Live chat replay** in sync with the video, from YouTube's chat replay (super chats, memberships, emoji).
- **Live only / Live + replay**: the original stream chat by default; replay chat and timestamped comments
  from later viewers on request ("+N from later viewers").
- Members chat on replays at their moment in the video; everyone watching sees it live.
- **Replies quote exactly what they answer**, in chat and comments; tapping a quote jumps to the original.
  Imported YouTube replies keep this link (1,371 reply-to-reply links restored).
- Tap a name to reply; `@` suggests names; your mentions are highlighted.
- **Comments** under each video: YouTube comments (threads, likes, pinned, Creator badge) and native ones.
  Comments can carry a moment; they then appear as bubbles in the chat and open their thread. Times typed in
  comments ("1:04:32") are clickable; 44 imported comments already carry one.
- **Notifications**: mentions and replies in chat or comments → bell with unread count, a bubble while you're on
  the site ("Jump to it" goes to the moment), and phone push (once the Render key is set).

### App
- Installable **PWA**: Home Screen icon, full screen, Install app button (Android/desktop), iPhone
  Add-to-Home-Screen hint; service worker for fast start and push.

### Accounts, access, Studio
- Username + password sign-in (scrypt; lockout after 10 wrong tries). No email or reset yet.
- Tiers enforced on the server for video, chat, comments, and the live WebSocket. Test tier picker only
  when `ALLOW_TEST_TIERS=true` (off on Render).
- Studio (admins in `ADMIN_USERNAMES`): totals, per-video stats, top chatters, set a video's tier.

### Importing and data
- `npm run import:youtube -- <url>`: video → Stream, chat replay, comments (with typed times and reply links).
  `--stream-uid` re-uses a Stream copy, `--chat-only` refreshes chat + comments. Re-runs are safe.
- `npm run captions:fetch [-- --generate]`: request Stream auto-captions and save them as transcripts.
- Tools on Ruben's PC (`C:\Users\office\tools\bin`): yt-dlp, ffmpeg, deno. Local database: `.localdb` on port 5544.

### Engineering
- Migrations (node-pg-migrate; Render pre-deploy), structured logs with request ids and redaction,
  request ids on errors, 400/413 for bad input, CI workflow, LF line endings, ESLint + Prettier.

## Decisions log

| Date | Decision |
|---|---|
| 2026-09-29 | Cloudflare Stream Starter for the MVP demo; R2 proposed for the library (ADR-010, pending) |
| 2026-09-29 | Live streaming stays on YouTube (embed) until owned ingest; Stream Live rejected on cost (~$300 per 5-hour show at 1,000 viewers) |
| 2026-09-29 | JimBob makes a Google Takeout copy of the channel (backup + source for the full import) |
| 2026-09-29 | Chat opens in **Live only** by default; timestamped comments show in the chat feed; mentions reach people through a bell (email later, if ever) |
| 2026-09-29 | Videos never start muted |
| 2026-09-29 | Release order: installable app + notifications first, then the Videos section (dashboard, playlists, up next), live indicator, posts |
| 2026-09-29 | Hosting on Render; code on GitHub (`rcerv87/madebyjimbob`) |
| 2026-09-29 | Library layout: Videos (filter chips), Playlists, Posts as the three main tabs; members-only is a filter, not a tab |
| 2026-09-29 | Backlog adds sign-up/onboarding, payments API, store, art, social links, navigation bar, founding members |

## Known limits (fine for a demo, not for launch)

- Sign-in is in-house: no email, no password reset, no Google/Apple (MBJ-101).
- No payments: everyone is Free unless an admin changes a video to Free (MBJ-104). Keep videos Free until then.
- Paid-video links aren't signed; a copied Stream link plays for anyone (MBJ-103).
- Every page open counts as a view (MBJ-216).
- Rate limits and live chat rooms live in one server's memory; fine for one Render instance (MBJ-205 for more).
- Auto-captions can invent text during silence or music.
- Downloading from YouTube with yt-dlp is against YouTube's terms; use Takeout or original recordings for the library.
- Push on iPhone requires Add to Home Screen (Apple's rule).

## What's next (in order)

1. **Live indicator** — red ring and LIVE badge, Studio "Go live" switch (MBJ-805).
2. **Navigation bar** — top nav for every section, bottom tab bar on phones and in the app (MBJ-810);
   **social links and sharing** with link previews (MBJ-809).
3. **Posts** — text, images, polls with threaded comments (MBJ-804).
4. **Accounts and money** — real sign-in and **sign-up/onboarding** (MBJ-101, 108), memberships and the
   **payments API** (MBJ-104, 109), pricing page (MBJ-105), **founding members** (MBJ-811), **Store** (MBJ-807).
5. **Link YouTube/Rumble names to profiles** (MBJ-215); **one view per viewer** (MBJ-216).
6. **Library move** — R2 (MBJ-506) and the whole-channel import from Takeout (MBJ-806), after the ADR-010 decision.
7. **Art section** (MBJ-808) — scope to confirm: JimBob's artwork and builds, or brand art.
8. **Store apps** — decide Capacitor (wrap this app) vs Expo (ADR-008), then MBJ-401+.
9. **Live via YouTube** — detection, merged live chat, auto-archive (MBJ-301+).
