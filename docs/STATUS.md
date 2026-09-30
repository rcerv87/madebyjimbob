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
5. **Domain:** choose where the platform lives: madebyjimbob.com with the store at shop.madebyjimbob.com
   (recommended), or the platform on watch.madebyjimbob.com (`docs/adr/011-domain-and-store.md`).
6. **JimBob's OK** on using his avatar, banner art, and store products in the platform before the link goes wide.
7. **JimBob:** written OK to re-host his catalog (and shows with guests, especially behind a paywall);
   Google Takeout export of the channel (guide: the "JimBob's YouTube Backup" page); tier prices and perks;
   moderators; brand assets and domain.

## What's built

### Sharing and search basics
- Every page is sent with its own title, description, and link-preview tags (Open Graph / X cards): a shared
  video link shows its thumbnail and title. Browser tab titles follow the page.
- Unknown pages and missing videos/playlists return a real 404 with a "Page not found" screen.
- The whole site is `noindex` (search engines skip it) until `ALLOW_INDEXING=true` is set on the real domain;
  link previews still work. `robots.txt` keeps Studio and the API out of search. Set `SITE_URL` once the domain
  is live so previews use it.
- **Likes**: thumbs up (with count) and thumbs down on every video; tap again to clear. Dislikes show only in
  Studio's content table (like YouTube).
- **Faster first load**: each page's code loads when it's opened; the home page downloads ~190 KB of script
  (~63 KB compressed) instead of 836 KB (~272 KB); the video player library (~600 KB) loads only on video pages.
  Hashed script/style files are cached for a year; icons and brand art for a day; the service worker is always
  re-checked.
- **Share** button on videos: copy the link, copy it at the current moment (`?t=`), or the phone's share sheet.

### JimBob's brand, Shop, and Art
- The platform now wears his brand from madebyjimbob.com: store teal accent, MADEbyJIMBOB wordmark in Jost,
  his illustrated avatar in the header and as the app icon, and his banner art on the Videos page with the
  stream schedule (weekdays around noon ET) and his social links. Assets are in `web/public/brand/`.
- **Shop**: his Shopify store's collections and products, read live (10-minute cache); Buy opens the
  product in his store for checkout. Nothing about the store changed.
- **Art**: gallery of his original art, prints, and digital art from the store; tap for a large view and
  View in store.

### Videos section
- **Videos** dashboard (home): chips All / Videos / Shorts / Live / Members only with counts, search on the
  server (titles and descriptions), sort by newest / oldest / most viewed; filters live in the URL.
  Video types come from import: past live streams are "Streamed", vertical ≤ 3 min are Shorts.
- Tabs **Videos · Playlists · Posts**. Posts is a **preview** (MBJ-804 not built): six example posts in JimBob's
  style (icon-painting progress with his own photos from YouTube, a poll, a stream link, a locked members-only
  post, a store drop with the real sticker pack, a Q&A call), each labeled Example. Captions are written for the
  preview; memes/screenshots from his YouTube posts were left out. Delete `web/src/postExamples.js` when real
  posts ship.
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
- Gestures (double-tap ±10s, hold for 2×), J/K/L keys, speed picker (0.75×–2×), Mini player (PiP); the Mini
  player keeps playing while browsing other pages ("Back to tab" returns to the video).
- **Listen only**: switches to Cloudflare's audio-only track at the same moment; keeps playing on a locked phone
  with lock-screen controls. Chat stays in sync. Locking a phone mid-video switches to it on its own (sound keeps
  going); unlocking switches back to the video.
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
| 2026-09-30 | Keep the Shopify store for products and checkout; the platform shows it (ADR-011). Art = his illustrations and comics from the store's art collections |
| 2026-09-30 | Platform adopts his store's brand (teal, Jost wordmark, avatar, banner art) |

## Known limits (fine for a demo, not for launch)

- Sign-in is in-house: no email, no password reset, no Google/Apple (MBJ-101).
- No payments: everyone is Free unless an admin changes a video to Free (MBJ-104). Keep videos Free until then.
- Paid-video links aren't signed; a copied Stream link plays for anyone (MBJ-103).
- Every page open counts as a view (MBJ-216).
- Rate limits and live chat rooms live in one server's memory; fine for one Render instance (MBJ-205 for more).
- Auto-captions can invent text during silence or music.
- Downloading from YouTube with yt-dlp is against YouTube's terms; use Takeout or original recordings for the library.
- Push on iPhone requires Add to Home Screen (Apple's rule).
- Search engines still see little content beyond titles and descriptions (the app draws pages in the browser);
  crawlable content, structured data, sitemap, and speed remain in MBJ-815.

## What's next (in order)

1. **Live indicator** — red ring and LIVE badge, Studio "Go live" switch (MBJ-805); with the **schedule
   calendar** (MBJ-813): JimBob enters streams and debates in Studio, viewers see them in their time zone, add
   them to Google/Apple/Outlook or subscribe to a feed, and get reminders.
2. **Navigation bar** — top nav for every section, bottom tab bar on phones and in the app (MBJ-810);
   **social links and sharing** with link previews (MBJ-809).
3. **Studio: manage videos and users** — upload from the browser, edit, replace, unpublish, delete
   (MBJ-701); find members, ban/time out, highlight regulars and guests, roles, staff notes (MBJ-705, with the
   chat moderation tools in MBJ-204). Can start on today's admin list before real roles (MBJ-102).
4. **Posts** — text, images, polls with threaded comments (MBJ-804).
5. **Unwatched filter and binge queue** (MBJ-814) — quick win on top of saved watch progress: Unwatched / In
   progress / Watched chips and an automatic playlist of everything you haven't finished.
6. **Gamification** — XP, levels, and activity badges for heavy chatters and commenters (MBJ-601, 602),
   watch-time rewards such as a free t-shirt after a set number of hours, delivered as a Shopify code (MBJ-611),
   and supporter shout-outs for super chats and Bob Chats, with a queue and optional on-stream overlay (MBJ-612).
7. **AI stream notes** — a facilitator-style notes page per stream: summary, sections, who said what, key
   exchanges, super chats and Bob Chats with answers, questions and promises (MBJ-605); speaker labels (MBJ-608);
   tags for topics and people with browse pages (MBJ-609); search inside streams (MBJ-610). Transcripts for all
   4 videos are already stored. Together with **ratings, moment reactions, and hotspots** (MBJ-613): thumbs
   up/down, tag a moment or a stretch as funny/interesting/boring, and a minute-by-minute heatmap over the
   progress bar.
8. **SEO before launch** — per-page titles, descriptions, and link previews filled in by the server, crawlable
   video pages, VideoObject/Event structured data, sitemap and robots, real 404s, noindex the onrender preview,
   faster bundle (MBJ-815); then slugs, indexable transcripts, topic and guest landing pages (MBJ-816).
9. **Accounts and money** — start with the **payments and fees decision** (MBJ-112: compare Stripe, PayPal, bank
   payments, Shopify, app-store fees with JimBob's real numbers). Then real sign-in with **one-tap social
   sign-in, passkeys, and staying signed in** (MBJ-101, 110), **sign-up/onboarding** (MBJ-108), memberships and
   the **payments API** (MBJ-104, 109), **saved payment methods and a prepaid wallet** so small Bob Chats don't
   lose ~9% to fees (MBJ-111), pricing page (MBJ-105), **founding members** (MBJ-811), **Store** (MBJ-807).
10. **Link YouTube/Rumble names to profiles** (MBJ-215); **one view per viewer** (MBJ-216).
11. **Library move** — R2 (MBJ-506) and the whole-channel import from Takeout (MBJ-806), after the ADR-010 decision.
12. **Art section** (MBJ-808) — scope to confirm: JimBob's artwork and builds, or brand art.
13. **Store apps** — decide Capacitor (wrap this app) vs Expo (ADR-008), then MBJ-401+.
14. **Live via YouTube** — detection, merged live chat, auto-archive (MBJ-301+).

## Reference

Facts gathered while building, so a new session doesn't have to rediscover them. Secrets are named here,
never written here: their values live only in `.env` (git-ignored) or Render's Environment settings.

### Environments

| | Local (Ruben's PC) | Live |
|---|---|---|
| App | http://localhost:3000 (`node server/src/index.js` from the repo root; build web first) | https://madebyjimbob.onrender.com |
| Database | Postgres cluster in `.localdb` on 127.0.0.1:5544 (`madebyjimbob`, tests use `madebyjimbob_test`) | Render Postgres `madebyjimbob-db`; external URL in `.env` as `RENDER_DATABASE_URL` |
| Deploy | — | Push to `main` on GitHub → Render builds, runs migrations (pre-deploy), and restarts (~2 min) |

- **Check a deploy is live:** the built page references `web/dist/assets/index-<hash>.js`; poll the live `/` until
  it contains the new hash.
- **Run imports against the live database** (from the PC, video already on Stream so nothing re-uploads):
  `DATABASE_URL="$RENDER_DATABASE_URL" PGSSL=true npm run import:youtube -- <url> --stream-uid <uid>`
  (`--chat-only` refreshes chat + comments; `--no-comments` skips comments). Same pattern for
  `import:playlists` and `captions:fetch`.
- **Test in real Chrome/Edge, not VS Code's built-in browser** (it lacks the H.264/AAC codecs, so video won't play).

### Services and settings

| Service | What | Notes |
|---|---|---|
| GitHub | `rcerv87/madebyjimbob` (private) | CI workflow in `.github/workflows/ci.yml`; branch rule still to add |
| Render | Blueprint from `render.yaml`: web service `madebyjimbob` (Starter) + Postgres | Env: `ADMIN_USERNAMES=jimbob`, `VAPID_PUBLIC_KEY`/`VAPID_SUBJECT` from render.yaml; `VAPID_PRIVATE_KEY` must be added by hand |
| Cloudflare Stream | Starter bundle ($5/mo) | Customer code `xw9exz2muwhw7zsm` (public); `CF_ACCOUNT_ID`, `CF_API_TOKEN` (Stream: Edit) in `.env`. English auto-captions generated for all 4 videos |
| Shopify | JimBob's store, madebyjimbob.com | Read via public product JSON (`SHOP_URL`, default https://madebyjimbob.com); no Shopify credentials yet |
| Web Push | VAPID key pair | Generated 2026-09-29; both keys in local `.env` |

### Content on the site

Same four videos locally and live (different database ids):

| YouTube id | Title | Type | Local id | Live id | Stream uid |
|---|---|---|---|---|---|
| `mzP0tKpIv5w` | Jimbob guitar is coming to life… | video (360p, vertical, 10 min) | 3 | 1 | `c5453d94b90ed211c863e8de3700f8e8` |
| `gdgBIwSAKgg` | Two Evolution Simps Get Torn Up | video (26 min) | 4 | 2 | `9000b4293757124395f7e9a691794805` |
| `Hz_elPwFwvU` | Alex Malpass Is Challenged | live (31 min, 810 chat) | 8 | 3 | `3ba82df285a3cb656d94022b5a7fc6c0` |
| `uijhf9xg4u8` | Evolution Debate | live (3 h 25 min, 6,498 chat) | 10 | 4 | `a2c7004be7c1acbd2b30a36e9652761f` |

Playlists: JimBob's 9 YouTube playlists are imported locally and live; only "Livestream Clips" has a video on
the site so far. Stream usage ≈ 270 of 1,000 stored minutes.

### JimBob

- **YouTube:** channel `UCe37IG3iLRcQlteFFBkX6Pw` (@madebyjimbob). Live **weekdays around 12:00pm ET**.
  40+ past streams, typically **2–6 hours** (~4 h average). Many have chat replay; some don't.
- **Measured chat** (two replays): 26–28 msg/min average, busiest minute 78, bursts ~5/s, 150–390 chatters,
  11–57 super chats per stream in USD/GBP/CAD/EUR.
- **Store (Shopify, madebyjimbob.com):** ~148 products ($5–$500): classic art prints, t-shirts, stickers, mugs,
  *Savage Memes* books (autographed, vol. 1–5, published with Arkhaven), original and digital art, OrthoThugs
  line, "Be in JimBob's next print" commissions, **Bob Chats** (paid chat messages sold as products), AmeriChat.
  Has a newsletter signup (seed for MBJ-107). Font Jost; teal #27717A.
- **Elsewhere:** X @byjimbob, Instagram @madebyjimbob (original account was cancelled at 115k followers),
  Facebook, Gab, Telegram, Spotify and Bandcamp (music), Washington Examiner (comics).
- **Brand assets in the platform** (`web/public/brand/`): avatar cropped from his website header art (the
  sunglasses-and-cap character, also on Bob Chats), the header art, and the Bob Chats image. The other
  portraits on his store may be customers' commissions; don't use them as JimBob.
- **Google Takeout guide for JimBob:** https://claude.ai/artifact/7HaUjjThdugEcyBfUfCt1q (private until
  shared from its Share menu). He was asked to export the whole channel as the backup and import source.

### Product decisions that shape the UI

- Videos never start muted; if the browser blocks sound, show a Play button.
- Chat opens in **Live only**; later viewers' chat and timestamped comments are behind "Live + replay".
- Replies always quote exactly what they answer (chat and comments).
- Listen only switches to Cloudflare's audio-only track so phones keep playing when locked; locking a phone
  mid-video turns it on automatically and unlocking turns it off.
- iPhone/iPad use Safari's native HLS; everything else uses hls.js.
- Store checkout stays on Shopify; the platform shows products and links out.

### How releases are verified

Each release: `npm test`, `npm run lint`, `npm run format:check`, `npm run build`, then a real-browser check
with headless Chrome driven over the DevTools protocol (screenshots and DOM checks), including phone layout
via device emulation (a plain headless window can't go below ~500px wide, which fakes overflow). Then push,
wait for the new bundle hash on the live site, re-run any data imports against the live database, and spot
check live endpoints. Update this file and the backlog `STATUS` dict with every release.
