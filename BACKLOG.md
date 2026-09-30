# Backlog — MadeByJimBob

Generated from `docs/backlog_source.py` — edit there and re-run `python3 docs/backlog_source.py`.

**Priority:** Must / Should / Could.  **Size:** S (≤1 day), M (2–3 days), L (~1 week), XL (>1 week).

## Done (POC)

- Stored video playback from Cloudflare Stream with gestures, mini player, listen-only, lock-screen metadata
- YouTube import: video → Stream, chat replay → Postgres with `offset_ms`
- Chat replay synced to playback; native posting at playhead with WebSocket broadcast
- Rate limiting, banned-word masking, @mention highlighting
- Tier-gated video detail endpoint; Studio dashboard with per-video access control

## Done (MVP hardening)

- Username + password sign-in (scrypt); taken names need their password. Replaced by MBJ-101
- Tier picker only when `ALLOW_TEST_TIERS=true`; Studio restricted to `ADMIN_USERNAMES`
- Chat read, post, and WebSocket join enforce the video's tier
- Malformed or unknown video ids return 400/404 instead of 500

## Suggested sprint plan

| Sprint | Goal | Stories |
|---|---|---|
| Sprint 1 | Foundation | MBJ-001, MBJ-002, MBJ-003, MBJ-005, MBJ-006, MBJ-306 |
| Sprint 2 | Real users | MBJ-101, MBJ-102, MBJ-007, MBJ-201 |
| Sprint 3 | Paid tiers | MBJ-103, MBJ-104, MBJ-105, MBJ-107 |
| Sprint 4 | Chat that scales socially | MBJ-204, MBJ-203, MBJ-202, MBJ-209 |
| Sprint 5 | Shared types + mobile start | MBJ-004, MBJ-401, MBJ-402 |
| Sprint 6 | Mobile core | MBJ-403, MBJ-404, MBJ-406 |
| Sprint 7 | Go live | MBJ-301, MBJ-205, MBJ-302, MBJ-303 |

## Summary

| ID | Title | Epic | Phase | Priority | Size | Depends on |
|---|---|---|---|---|---|---|
| MBJ-001 | Test harness | Foundation | 0 | Must | M | — |
| MBJ-002 | Lint and format | Foundation | 0 | Must | S | — |
| MBJ-003 | Database migrations | Foundation | 0 | Must | M | — |
| MBJ-004 | TypeScript and shared package | Foundation | 0 | Should | L | MBJ-001, MBJ-002 |
| MBJ-005 | CI pipeline | Foundation | 0 | Must | S | MBJ-001, MBJ-002 |
| MBJ-006 | Extract YouTube replay parser | Foundation | 0 | Must | S | MBJ-001 |
| MBJ-007 | Structured logging | Foundation | 0 | Should | S | — |
| MBJ-008 | Staging environment | Foundation | 0 | Should | S | MBJ-003 |
| MBJ-101 | Real authentication | Accounts & memberships | 1 | Must | L | MBJ-003 |
| MBJ-102 | Roles and Studio access | Accounts & memberships | 1 | Must | S | MBJ-101 |
| MBJ-103 | Signed playback URLs | Accounts & memberships | 1 | Must | M | MBJ-101 |
| MBJ-104 | Web subscriptions and entitlements | Accounts & memberships | 1 | Must | L | MBJ-101 |
| MBJ-105 | Pricing page and upsell | Accounts & memberships | 1 | Must | M | MBJ-104 |
| MBJ-106 | Account page | Accounts & memberships | 1 | Should | M | MBJ-104 |
| MBJ-107 | Owned email list | Accounts & memberships | 1 | Must | S | MBJ-101, MBJ-102 |
| MBJ-201 | Chat replay polish | Chat & moderation | 1 | Should | M | — |
| MBJ-202 | @mention autocomplete and notifications | Chat & moderation | 1 | Should | M | MBJ-101 |
| MBJ-203 | Upvotes and top questions | Chat & moderation | 1 | Should | M | MBJ-101 |
| MBJ-204 | Moderation tools | Chat & moderation | 1 | Must | L | MBJ-102 |
| MBJ-206 | Managed filters and spam detection | Chat & moderation | 1 | Should | M | MBJ-204 |
| MBJ-207 | Native tipped messages (web) | Chat & moderation | 1 | Should | L | MBJ-104 |
| MBJ-208 | Chat search in Studio | Chat & moderation | 1 | Could | M | MBJ-102 |
| MBJ-209 | Tier-based chat limits | Chat & moderation | 1 | Should | S | MBJ-104 |
| MBJ-701 | Content management | Studio & analytics | 1 | Should | M | MBJ-102 |
| MBJ-703 | Members and revenue dashboard | Studio & analytics | 1 | Should | M | MBJ-104, MBJ-102 |
| MBJ-704 | Data export | Studio & analytics | 1 | Should | S | MBJ-102 |
| MBJ-401 | Expo app scaffold | Mobile apps | 2 | Must | L | MBJ-004, MBJ-101 |
| MBJ-402 | Mobile player and gestures | Mobile apps | 2 | Must | M | MBJ-401 |
| MBJ-403 | Background audio, lock screen, PiP | Mobile apps | 2 | Must | M | MBJ-402 |
| MBJ-404 | Mobile chat | Mobile apps | 2 | Must | M | MBJ-401 |
| MBJ-405 | Push notifications | Mobile apps | 2 | Should | M | MBJ-401, MBJ-202 |
| MBJ-406 | In-app subscriptions and tips | Mobile apps | 2 | Must | L | MBJ-104, MBJ-401 |
| MBJ-407 | Store release | Mobile apps | 2 | Must | M | MBJ-403, MBJ-406 |
| MBJ-205 | Redis pub/sub and rate limits | Chat & moderation | 3 | Should | M | MBJ-001 |
| MBJ-301 | Live video model and live page | Live via YouTube | 3 | Must | M | MBJ-003 |
| MBJ-302 | YouTube live chat ingest worker | Live via YouTube | 3 | Must | L | MBJ-301, MBJ-205, MBJ-006 |
| MBJ-303 | Live chat mode in the UI | Live via YouTube | 3 | Must | M | MBJ-302 |
| MBJ-304 | Auto-archive finished streams | Live via YouTube | 3 | Must | M | MBJ-302 |
| MBJ-305 | Post to YouTube chat from the platform | Live via YouTube | 3 | Should | L | MBJ-101, MBJ-302, MBJ-306 |
| MBJ-306 | Google API verification and quota request | Live via YouTube | 3 | Must | S | — |
| MBJ-307 | Rumble chat and Rants ingest | Live via YouTube | 3 | Should | M | MBJ-302 |
| MBJ-308 | Moderation reaches YouTube | Live via YouTube | 3 | Should | M | MBJ-204, MBJ-302 |
| MBJ-309 | Configurable live source | Live via YouTube | 3 | Should | S | MBJ-301 |
| MBJ-501 | Owned live ingest to R2 | Owned live & audio | 4 | Must | L | MBJ-309 |
| MBJ-502 | Audio-only renditions | Owned live & audio | 4 | Must | M | MBJ-501 |
| MBJ-503 | Podcast feeds | Owned live & audio | 4 | Should | M | MBJ-502, MBJ-104 |
| MBJ-504 | Restream to YouTube and Rumble | Owned live & audio | 4 | Should | M | MBJ-501 |
| MBJ-505 | Owned live recordings | Owned live & audio | 4 | Should | M | MBJ-501 |
| MBJ-601 | Watch and listen tracking | Engagement & AI | 5 | Must | S | MBJ-101 |
| MBJ-602 | XP, levels, badges | Engagement & AI | 5 | Should | M | MBJ-601 |
| MBJ-603 | Leaderboards | Engagement & AI | 5 | Could | S | MBJ-602 |
| MBJ-604 | Captions | Engagement & AI | 5 | Should | M | — |
| MBJ-605 | AI recaps and chapters | Engagement & AI | 5 | Should | M | MBJ-604 |
| MBJ-606 | Call-ins | Engagement & AI | 5 | Could | XL | MBJ-104, MBJ-301 |
| MBJ-607 | Polls and predictions | Engagement & AI | 5 | Could | L | MBJ-602 |
| MBJ-702 | Chat analytics | Studio & analytics | 5 | Should | M | MBJ-102 |

## Epic 0xx — Foundation

Make the POC a safe base: tests, CI, migrations, shared types.

### MBJ-001 — Test harness

**Status:** Done · **Phase 0 — Foundation** · **Priority:** Must · **Size:** M

As the developer, I want automated tests so Claude Code can change things safely.

Acceptance criteria:
- [x] `npm test` runs server and web tests from the repo root
- [x] Server tests run against a disposable Postgres (`DATABASE_URL_TEST`) and reset it per run
- [x] Covered: sign-in, tier gating on `/videos/:id`, chat window query, chat post + rate limit, WS broadcast
- [x] Web: at least one render test each for Home, Watch (locked + unlocked), ChatPanel

### MBJ-002 — Lint and format

**Status:** Done · **Phase 0 — Foundation** · **Priority:** Must · **Size:** S

As the developer, I want consistent code style enforced automatically.

Acceptance criteria:
- [x] ESLint + Prettier configured for server and web
- [x] `npm run lint` and `npm run format` at root
- [x] Existing code passes lint

### MBJ-003 — Database migrations

**Status:** Done · **Phase 0 — Foundation** · **Priority:** Must · **Size:** M

As the developer, I want versioned schema changes so production data is never at risk.

Acceptance criteria:
- [x] node-pg-migrate installed; baseline migration equals current `schema.sql`
- [x] Migrations run as Render pre-deploy command, not on app boot
- [x] `npm run migrate:create <name>` documented in CLAUDE.md
- [x] `schema.sql` removed or marked historical

### MBJ-004 — TypeScript and shared package

**Status:** To do · **Phase 0 — Foundation** · **Priority:** Should · **Size:** L · **Depends on:** MBJ-001, MBJ-002

As the developer, I want shared types across server, web, and mobile so contracts can't drift.

Acceptance criteria:
- [ ] `packages/shared` exports types for User, Video, ChatMessage, WS events, and a typed API client
- [ ] Server and web compile with `tsc --noEmit` in CI
- [ ] No behavior change; all tests pass

### MBJ-005 — CI pipeline

**Status:** In progress · **Phase 0 — Foundation** · **Priority:** Must · **Size:** S · **Depends on:** MBJ-001, MBJ-002

As the developer, I want every PR checked before merge.

Acceptance criteria:
- [ ] GitHub Actions runs lint, test (with Postgres service), and build on PRs to main
- [ ] Status check required to merge

### MBJ-006 — Extract YouTube replay parser

**Status:** Done · **Phase 0 — Foundation** · **Priority:** Must · **Size:** S · **Depends on:** MBJ-001

As the developer, I want the chat replay parser as a tested module so live ingest can reuse it.

Acceptance criteria:
- [x] Parser lives in `server/src/ingest/youtubeReplay.js` with pure functions
- [x] Fixture-based tests cover text, emoji, super chat, membership, negative offsets
- [x] Import script uses the module; behavior unchanged

### MBJ-007 — Structured logging

**Status:** To do · **Phase 0 — Foundation** · **Priority:** Should · **Size:** S

As the operator, I want useful logs when something breaks in production.

Acceptance criteria:
- [ ] pino logger with request id per HTTP request
- [ ] Errors logged with stack; no secrets or tokens logged

### MBJ-008 — Staging environment

**Status:** To do · **Phase 0 — Foundation** · **Priority:** Should · **Size:** S · **Depends on:** MBJ-003

As the product owner, I want to review changes before they reach JimBob's audience.

Acceptance criteria:
- [ ] Separate Render service + database for staging deployed from `staging` branch
- [ ] Documented in README

## Epic 1xx — Accounts & memberships

Real users, tiers, payments, and server-enforced access.

### MBJ-101 — Real authentication

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** L · **Depends on:** MBJ-003

As a viewer, I want a real account so my identity, tier, and history are mine.

Acceptance criteria:
- [ ] Self-hosted auth (ADR-006) with email + password, magic link, Google, and Apple sign-in
- [ ] Users choose a unique username at signup (3–32 `[A-Za-z0-9_]`)
- [ ] POC `/session` endpoint and `session_token` column removed
- [ ] Tier can no longer be self-selected

### MBJ-102 — Roles and Studio access

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** S · **Depends on:** MBJ-101

As JimBob, I want only me and my mods to reach Studio and mod tools.

Acceptance criteria:
- [ ] `users.role` = viewer | mod | admin
- [ ] `/api/studio/*` and `/api/mod/*` return 403 for viewers
- [ ] Studio nav hidden for viewers
- [ ] Admin can promote/demote mods in Studio

### MBJ-103 — Signed playback URLs

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-101

As JimBob, I want paid videos to be unwatchable without the right tier, even with a copied link.

Acceptance criteria:
- [ ] Gated videos have `requireSignedURLs` enabled on Stream
- [ ] API returns a short-lived signed token URL only to entitled users
- [ ] Free videos stay unsigned
- [ ] Import script sets the flag based on `--tier`

### MBJ-104 — Web subscriptions and entitlements

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** L · **Depends on:** MBJ-101

As a viewer, I want to subscribe to Plus or Premium on the web.

Acceptance criteria:
- [ ] Stripe Checkout for Plus and Premium (monthly; annual optional)
- [ ] RevenueCat receives Stripe purchases; webhook updates `entitlements`
- [ ] `users.tier` derived from active entitlements; expires correctly on cancel/lapse
- [ ] Webhooks verified by signature and idempotent

### MBJ-105 — Pricing page and upsell

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-104

As a free viewer, I want to see what paid tiers include and upgrade in one step.

Acceptance criteria:
- [ ] Pricing page shows the tier matrix from the PRD
- [ ] Locked video screen links to upgrade with that tier preselected
- [ ] After purchase, the user returns to the video and it plays

### MBJ-106 — Account page

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-104

As a member, I want to manage my subscription and profile.

Acceptance criteria:
- [ ] Change username (once per 30 days), manage subscription via Stripe customer portal
- [ ] Shows tier, renewal date, linked accounts

### MBJ-107 — Owned email list

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** S · **Depends on:** MBJ-101, MBJ-102

As JimBob, I want my audience's contact info so no platform can take my audience away.

Acceptance criteria:
- [ ] Marketing opt-in checkbox at signup, stored with timestamp
- [ ] Admin can export opted-in users as CSV from Studio
- [ ] Unsubscribe link handling documented

## Epic 2xx — Chat & moderation

The core chat experience and the tools to keep it usable.

### MBJ-201 — Chat replay polish

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M

As a viewer, I want chat that feels as good as YouTube's.

Acceptance criteria:
- [ ] "Jump to latest" button appears when scrolled up; resumes auto-scroll
- [ ] Hovering a message shows its video timestamp; clicking seeks the player there
- [ ] On WebSocket reconnect, missed messages are fetched since the last id

### MBJ-202 — @mention autocomplete and notifications

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-101

As a member, I want to know when someone mentions me.

Acceptance criteria:
- [ ] Typing `@` suggests recent chatters in this video
- [ ] Mentioned native users get an in-app notification (bell with count)
- [ ] Clicking a notification opens the video at that message's timestamp

### MBJ-203 — Upvotes and top questions

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-101

As a viewer, I want to upvote good messages; as JimBob, I want the best questions surfaced.

Acceptance criteria:
- [ ] One vote per user per message; toggle to remove
- [ ] Vote counts update live via WS `vote` event
- [ ] "Top questions" tab lists messages containing `?` ordered by votes

### MBJ-204 — Moderation tools

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** L · **Depends on:** MBJ-102

As a mod, I want to hide messages and remove bad actors quickly.

Acceptance criteria:
- [ ] Mods can hide a message, time out a user (1/5/60 min), or ban a user
- [ ] Room modes: open, slow (N seconds), members-only; broadcast via WS `room`
- [ ] Hidden messages disappear for all viewers in real time (WS `hide`) but remain in the database
- [ ] Every action logged in `mod_actions` and visible in Studio

### MBJ-205 — Redis pub/sub and rate limits

**Status:** To do · **Phase 3 — Live via YouTube** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-001

As the operator, I want chat to work across multiple instances and a separate ingest worker.

Acceptance criteria:
- [ ] Render Key Value added to `render.yaml`
- [ ] Room fan-out via Redis pub/sub
- [ ] Rate limits stored in Redis
- [ ] Works with 2 web instances in a load test of 1,000 sockets

### MBJ-206 — Managed filters and spam detection

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-204

As a mod, I want to manage banned terms and have obvious spam held automatically.

Acceptance criteria:
- [ ] `banned_terms` editable in Studio replaces the env var
- [ ] Automated classifier holds likely spam/toxicity for review
- [ ] Mods can approve or reject held messages

### MBJ-207 — Native tipped messages (web)

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** L · **Depends on:** MBJ-104

As a member, I want to tip with a highlighted message like a Super Chat.

Acceptance criteria:
- [ ] Fixed tip amounts via Stripe
- [ ] Message posts only after payment confirmation (webhook)
- [ ] Paid message pinned for a duration scaled by amount; WS `pin` event
- [ ] Tips appear in Studio revenue

### MBJ-208 — Chat search in Studio

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Could · **Size:** M · **Depends on:** MBJ-102

As JimBob, I want to find what people said.

Acceptance criteria:
- [ ] Search by text, author, source, date range, video
- [ ] Results link to the video at that timestamp

### MBJ-209 — Tier-based chat limits

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** S · **Depends on:** MBJ-104

As JimBob, I want free chatters slowed down and members rewarded.

Acceptance criteria:
- [ ] Free users: slow mode per PRD; Plus/Premium: normal rate
- [ ] Tier badge shown next to native usernames

## Epic 3xx — Live via YouTube

Watch live in-platform with YouTube/Rumble chat merged in, then auto-archive.

### MBJ-301 — Live video model and live page

**Status:** To do · **Phase 3 — Live via YouTube** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-003

As a viewer, I want to watch JimBob live without leaving the platform.

Acceptance criteria:
- [ ] `videos.status` and `videos.source` added (see DATA_MODEL)
- [ ] Live page embeds the YouTube IFrame player for the active broadcast
- [ ] "Live now" banner on Home while a stream is live
- [ ] `GET /api/live/current` returns the live video or null

### MBJ-302 — YouTube live chat ingest worker

**Status:** To do · **Phase 3 — Live via YouTube** · **Priority:** Must · **Size:** L · **Depends on:** MBJ-301, MBJ-205, MBJ-006

As a viewer, I want YouTube chat in the platform in real time.

Acceptance criteria:
- [ ] Render background worker; JimBob authorizes his channel once via OAuth
- [ ] Detects live broadcast start/end
- [ ] Polls chat at YouTube's interval; inserts with `offset_ms = publishedAt − actualStartTime`
- [ ] Idempotent; persists page token in `ingest_cursors`; survives restarts without gaps or duplicates
- [ ] Publishes new messages to the video's room

### MBJ-303 — Live chat mode in the UI

**Status:** To do · **Phase 3 — Live via YouTube** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-302

As a viewer, I want live chat to behave like live chat, not replay.

Acceptance criteria:
- [ ] Live videos render all incoming messages (no playhead filtering)
- [ ] Native posts use server-computed `offset_ms`
- [ ] After the stream is archived, the same chat replays in sync

### MBJ-304 — Auto-archive finished streams

**Status:** To do · **Phase 3 — Live via YouTube** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-302

As JimBob, I want every live stream saved to my own storage automatically.

Acceptance criteria:
- [ ] When a broadcast ends, a job downloads the VOD and uploads it to Stream
- [ ] Video row switches to archived; tier default configurable
- [ ] Failure retries and alerts in logs

### MBJ-305 — Post to YouTube chat from the platform

**Status:** To do · **Phase 3 — Live via YouTube** · **Priority:** Should · **Size:** L · **Depends on:** MBJ-101, MBJ-302, MBJ-306

As a member with a YouTube account, I want my messages to appear in YouTube's chat too.

Acceptance criteria:
- [ ] User links YouTube via Google OAuth
- [ ] Posts go to YouTube via `liveChatMessages.insert` and to native chat, de-duplicated
- [ ] Quota usage tracked daily; when exhausted, posts fall back to native-only with a notice

### MBJ-306 — Google API verification and quota request

**Status:** To do · **Phase 3 — Live via YouTube** · **Priority:** Must · **Size:** S

As the product owner, I want Google approvals in place before live features need them.

Acceptance criteria:
- [ ] OAuth consent screen verified for YouTube scopes
- [ ] Quota increase requested with expected usage
- [ ] Non-code task — owner: Ruben. Start during Phase 1.

### MBJ-307 — Rumble chat and Rants ingest

**Status:** To do · **Phase 3 — Live via YouTube** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-302

As a viewer, I want Rumble chat merged into the same feed.

Acceptance criteria:
- [ ] Worker polls Rumble Live Stream API with JimBob's key
- [ ] Messages stored with `source = rumble`; Rants as `kind = paid`
- [ ] Rumble tag shown in chat

### MBJ-308 — Moderation reaches YouTube

**Status:** To do · **Phase 3 — Live via YouTube** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-204, MBJ-302

As a mod, I want one set of tools for both chats.

Acceptance criteria:
- [ ] Hiding a YouTube-sourced message also deletes it on YouTube
- [ ] Banning a YouTube author bans them on YouTube
- [ ] Actions use JimBob's OAuth token and are logged

### MBJ-309 — Configurable live source

**Status:** To do · **Phase 3 — Live via YouTube** · **Priority:** Should · **Size:** S · **Depends on:** MBJ-301

As JimBob, I want to switch live platforms without an app update.

Acceptance criteria:
- [ ] Live source per video: youtube | rumble | owned
- [ ] Clients pick the player from the API response

## Epic 4xx — Mobile apps

iOS and Android with background audio, PiP, gestures, and IAP.

### MBJ-401 — Expo app scaffold

**Status:** To do · **Phase 2 — Mobile** · **Priority:** Must · **Size:** L · **Depends on:** MBJ-004, MBJ-101

As a viewer, I want the platform as a phone app.

Acceptance criteria:
- [ ] `mobile/` Expo app in the workspace using `packages/shared`
- [ ] Sign-in, Home, Watch, Account screens
- [ ] Runs on iOS simulator and Android emulator

### MBJ-402 — Mobile player and gestures

**Status:** To do · **Phase 2 — Mobile** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-401

As a mobile viewer, I want YouTube-quality player controls.

Acceptance criteria:
- [ ] expo-video HLS playback
- [ ] Double-tap left/right ±10s with visual feedback
- [ ] Long-press 2× while held
- [ ] Pinch to zoom (1×–3×)

### MBJ-403 — Background audio, lock screen, PiP

**Status:** To do · **Phase 2 — Mobile** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-402

As a passive listener, I want to lock my phone and keep listening.

Acceptance criteria:
- [ ] Audio continues with screen locked and app backgrounded
- [ ] Lock-screen/notification controls with title and artwork
- [ ] PiP starts automatically when leaving the app while playing
- [ ] Listen-only toggle hides video

### MBJ-404 — Mobile chat

**Status:** To do · **Phase 2 — Mobile** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-401

As a mobile viewer, I want to read and post chat.

Acceptance criteria:
- [ ] Chat panel synced to playback (replay) and live mode
- [ ] Catch-up fetch after returning from background

### MBJ-405 — Push notifications

**Status:** To do · **Phase 2 — Mobile** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-401, MBJ-202

As a member, I want to know when JimBob goes live or someone mentions me.

Acceptance criteria:
- [ ] Expo push for: live now, @mentions, tip replies
- [ ] Per-type opt-out in Account

### MBJ-406 — In-app subscriptions and tips

**Status:** To do · **Phase 2 — Mobile** · **Priority:** Must · **Size:** L · **Depends on:** MBJ-104, MBJ-401

As a mobile viewer, I want to subscribe and tip in the app.

Acceptance criteria:
- [ ] RevenueCat offerings for Plus and Premium on iOS and Android
- [ ] Consumable tip products
- [ ] Entitlements shared with web purchases

### MBJ-407 — Store release

**Status:** To do · **Phase 2 — Mobile** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-403, MBJ-406

As JimBob, I want the app in both stores.

Acceptance criteria:
- [ ] EAS Build/Submit configured
- [ ] TestFlight and Play internal testing live
- [ ] Store listings and privacy disclosures complete

## Epic 5xx — Owned live & audio

Platform-independent live, audio-only, and podcast feeds.

### MBJ-501 — Owned live ingest to R2

**Status:** To do · **Phase 4 — Owned live + audio** · **Priority:** Must · **Size:** L · **Depends on:** MBJ-309

As JimBob, I want a live stream no platform can shut off.

Acceptance criteria:
- [ ] MediaMTX on a VPS accepts RTMP/SRT from OBS
- [ ] ffmpeg outputs 720p/480p + audio-only HLS to R2
- [ ] Served via a Cloudflare domain; plays in web and mobile
- [ ] Runbook in `docs/runbooks/owned-live.md`

### MBJ-502 — Audio-only renditions

**Status:** To do · **Phase 4 — Owned live + audio** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-501

As a passive listener, I want listen mode to use far less data.

Acceptance criteria:
- [ ] Live: audio-only HLS from 501
- [ ] VOD: job produces AAC HLS per video to R2
- [ ] Listen-only mode switches to the audio playlist

### MBJ-503 — Podcast feeds

**Status:** To do · **Phase 4 — Owned live + audio** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-502, MBJ-104

As a listener, I want streams in my podcast app.

Acceptance criteria:
- [ ] Public RSS feed of free episodes
- [ ] Private per-member tokenized feed including paid episodes; revoked on lapse
- [ ] Feeds validate in Apple Podcasts

### MBJ-504 — Restream to YouTube and Rumble

**Status:** To do · **Phase 4 — Owned live + audio** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-501

As JimBob, I want to stream once and reach every platform.

Acceptance criteria:
- [ ] Ingest forwards to YouTube and Rumble RTMP targets
- [ ] Targets configurable in Studio

### MBJ-505 — Owned live recordings

**Status:** To do · **Phase 4 — Owned live + audio** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-501

As JimBob, I want owned streams archived automatically.

Acceptance criteria:
- [ ] Live segments assembled into a VOD after the stream
- [ ] Chat replays in sync

## Epic 6xx — Engagement & AI

XP, badges, captions, recaps, call-ins.

### MBJ-601 — Watch and listen tracking

**Status:** To do · **Phase 5 — Engagement** · **Priority:** Must · **Size:** S · **Depends on:** MBJ-101

As JimBob, I want to know who actually watches and listens.

Acceptance criteria:
- [ ] Client heartbeat every 60s while playing (video or listen-only)
- [ ] Stored in `watch_sessions` with mode

### MBJ-602 — XP, levels, badges

**Status:** To do · **Phase 5 — Engagement** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-601

As a regular, I want my loyalty visible in chat.

Acceptance criteria:
- [ ] XP from watch/listen time, messages, and upvotes received; tier multipliers per PRD
- [ ] Level and badge shown next to name in chat
- [ ] Anti-farming: idle tabs and duplicate messages earn nothing

### MBJ-603 — Leaderboards

**Status:** To do · **Phase 5 — Engagement** · **Priority:** Could · **Size:** S · **Depends on:** MBJ-602

As a regular, I want to see where I rank.

Acceptance criteria:
- [ ] Per-stream and all-time leaderboards
- [ ] Shown on watch page and in Studio

### MBJ-604 — Captions

**Status:** To do · **Phase 5 — Engagement** · **Priority:** Should · **Size:** M

As a viewer, I want captions on stored videos.

Acceptance criteria:
- [ ] Captions generated for each VOD (Stream captions or Whisper)
- [ ] Selectable in web and mobile players
- [ ] Transcript stored

### MBJ-605 — AI recaps and chapters

**Status:** To do · **Phase 5 — Engagement** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-604

As a viewer, I want a quick summary and jump points.

Acceptance criteria:
- [ ] After archive, a job generates recap notes and chapters from transcript + chat
- [ ] Shown on the watch page; chapters seek the player
- [ ] JimBob can edit before publishing

### MBJ-606 — Call-ins

**Status:** To do · **Phase 5 — Engagement** · **Priority:** Could · **Size:** XL · **Depends on:** MBJ-104, MBJ-301

As a Premium member, I want to call in to the live show.

Acceptance criteria:
- [ ] Premium users request to call; LiveKit green room
- [ ] Producer screens and approves
- [ ] Approved caller appears in OBS via browser source

### MBJ-607 — Polls and predictions

**Status:** To do · **Phase 5 — Engagement** · **Priority:** Could · **Size:** L · **Depends on:** MBJ-602

As a viewer, I want to spend points and play along.

Acceptance criteria:
- [ ] Mods create polls/predictions during a stream
- [ ] Viewers vote with points; results broadcast live

## Epic 7xx — Studio & analytics

Creator tools and audience insight.

### MBJ-701 — Content management

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-102

As JimBob, I want to manage videos without a terminal.

Acceptance criteria:
- [ ] Edit title, description, tier, and thumbnail
- [ ] Start a YouTube import from a URL in Studio (background job with status)

### MBJ-702 — Chat analytics

**Status:** To do · **Phase 5 — Engagement** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-102

As JimBob, I want to see what landed with my audience.

Acceptance criteria:
- [ ] Messages-per-minute chart per stream with busiest moments linked to timestamps
- [ ] Top questions and per-stream sentiment summary

### MBJ-703 — Members and revenue dashboard

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-104, MBJ-102

As JimBob, I want to see who pays and how much I earn.

Acceptance criteria:
- [ ] Active members by tier, churn, MRR, tip totals by source

### MBJ-704 — Data export

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** S · **Depends on:** MBJ-102

As JimBob, I want a copy of everything that's mine.

Acceptance criteria:
- [ ] CSV export of chat (per video or all), members, and tips
