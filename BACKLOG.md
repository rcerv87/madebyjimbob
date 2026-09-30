# Backlog — MadeByJimBob

Generated from `docs/backlog_source.py` — edit there and re-run `python3 docs/backlog_source.py`.

**Priority:** Must / Should / Could.  **Size:** S (≤1 day), M (2–3 days), L (~1 week), XL (>1 week).

Current state, decisions, and what's next: `docs/STATUS.md`.

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
| Next | Presence and navigation | MBJ-805, MBJ-810, MBJ-809, MBJ-804 |
| Then | Accounts and money | MBJ-101, MBJ-114, MBJ-108, MBJ-113, MBJ-106, MBJ-116, MBJ-117, MBJ-115, MBJ-118, MBJ-119, MBJ-104, MBJ-109, MBJ-105, MBJ-811, MBJ-807 |

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
| MBJ-106 | Account settings | Accounts & memberships | 1 | Must | M | MBJ-101 |
| MBJ-107 | Owned email list | Accounts & memberships | 1 | Must | S | MBJ-101, MBJ-102 |
| MBJ-108 | Registration | Accounts & memberships | 1 | Must | M | MBJ-101, MBJ-114 |
| MBJ-109 | Payments API and receipts | Accounts & memberships | 1 | Must | M | MBJ-104 |
| MBJ-110 | Easy sign-in and staying signed in | Accounts & memberships | 1 | Must | M | MBJ-101 |
| MBJ-111 | Saved payment methods and a wallet | Accounts & memberships | 1 | Must | L | MBJ-104, MBJ-112 |
| MBJ-112 | Payments and fees decision (ADR) | Accounts & memberships | 1 | Must | S | — |
| MBJ-113 | Password reset and email change | Accounts & memberships | 1 | Must | M | MBJ-101, MBJ-114 |
| MBJ-114 | Sending email (ADR) | Accounts & memberships | 1 | Must | S | — |
| MBJ-115 | Welcome steps | Accounts & memberships | 1 | Should | S | MBJ-108 |
| MBJ-116 | Public profile | Accounts & memberships | 1 | Should | M | MBJ-101 |
| MBJ-117 | Edit profile | Accounts & memberships | 1 | Should | M | MBJ-116 |
| MBJ-118 | Download my data and delete my account | Accounts & memberships | 1 | Must | M | MBJ-101, MBJ-114 |
| MBJ-119 | Block and mute | Accounts & memberships | 1 | Should | S | MBJ-101 |
| MBJ-201 | Chat replay polish | Chat & moderation | 1 | Should | M | — |
| MBJ-202 | @mention autocomplete and notifications | Chat & moderation | 1 | Should | M | MBJ-101 |
| MBJ-203 | Upvotes and top questions | Chat & moderation | 1 | Should | M | MBJ-101 |
| MBJ-204 | Moderation tools | Chat & moderation | 1 | Must | L | MBJ-102 |
| MBJ-206 | Managed filters and spam detection | Chat & moderation | 1 | Should | M | MBJ-204 |
| MBJ-207 | Native tipped messages (web) | Chat & moderation | 1 | Should | L | MBJ-104 |
| MBJ-208 | Chat search in Studio | Chat & moderation | 1 | Could | M | MBJ-102 |
| MBJ-209 | Tier-based chat limits | Chat & moderation | 1 | Should | S | MBJ-104 |
| MBJ-210 | Video comments | Chat & moderation | 1 | Must | M | MBJ-001 |
| MBJ-211 | One conversation across live chat, replay chat, and comments | Chat & moderation | 1 | Must | L | MBJ-210 |
| MBJ-212 | Resume where you left off | Chat & moderation | 1 | Must | S | — |
| MBJ-213 | Installable web app (PWA) | Chat & moderation | 1 | Must | M | — |
| MBJ-214 | Push notifications (web) | Chat & moderation | 1 | Must | M | MBJ-202, MBJ-213 |
| MBJ-215 | Link YouTube and Rumble names to a profile | Chat & moderation | 1 | Should | M | MBJ-202 |
| MBJ-216 | Count one view per viewer | Chat & moderation | 1 | Should | S | — |
| MBJ-701 | Video management in Studio | Studio & analytics | 1 | Must | L | MBJ-102 |
| MBJ-703 | Members and revenue dashboard | Studio & analytics | 1 | Should | M | MBJ-104, MBJ-102 |
| MBJ-704 | Data export | Studio & analytics | 1 | Should | S | MBJ-102 |
| MBJ-705 | User management in Studio | Studio & analytics | 1 | Must | M | MBJ-102, MBJ-204 |
| MBJ-801 | Videos dashboard with filters | Library & community | 1 | Must | M | — |
| MBJ-802 | Playlists | Library & community | 1 | Must | M | MBJ-801 |
| MBJ-803 | Up next and autoplay | Library & community | 1 | Must | S | MBJ-802 |
| MBJ-804 | Posts | Library & community | 1 | Should | L | — |
| MBJ-805 | Live indicator | Library & community | 1 | Should | S | — |
| MBJ-807 | Store (Shopify integration) | Library & community | 1 | Should | M | — |
| MBJ-809 | Social media links and sharing | Library & community | 1 | Should | S | — |
| MBJ-810 | Navigation bar | Library & community | 1 | Must | M | — |
| MBJ-811 | Founding members | Library & community | 1 | Should | M | MBJ-104 |
| MBJ-812 | JimBob's brand on the platform | Library & community | 1 | Must | S | — |
| MBJ-813 | Schedule calendar with export | Library & community | 1 | Should | M | — |
| MBJ-814 | Unwatched filter and binge queue | Library & community | 1 | Should | S | MBJ-212, MBJ-803 |
| MBJ-815 | Technical SEO | Library & community | 1 | Must | M | MBJ-809 |
| MBJ-816 | Search-friendly content | Library & community | 1 | Should | M | MBJ-815, MBJ-605, MBJ-609 |
| MBJ-817 | Friends of the channel | Library & community | 1 | Should | S | — |
| MBJ-401 | Expo app scaffold | Mobile apps | 2 | Must | L | MBJ-004, MBJ-101 |
| MBJ-402 | Mobile player and gestures | Mobile apps | 2 | Must | M | MBJ-401 |
| MBJ-403 | Background audio, lock screen, PiP | Mobile apps | 2 | Must | M | MBJ-402 |
| MBJ-404 | Mobile chat | Mobile apps | 2 | Must | M | MBJ-401 |
| MBJ-405 | Push notifications | Mobile apps | 2 | Should | M | MBJ-401, MBJ-202 |
| MBJ-406 | In-app subscriptions and tips | Mobile apps | 2 | Must | L | MBJ-104, MBJ-401 |
| MBJ-407 | Store release | Mobile apps | 2 | Must | M | MBJ-403, MBJ-406 |
| MBJ-808 | Art section | Library & community | 2 | Should | S | MBJ-807 |
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
| MBJ-506 | Move stored video to R2 (ADR-010) | Owned live & audio | 4 | Should | M | — |
| MBJ-806 | Import the whole channel | Library & community | 4 | Should | M | MBJ-506 |
| MBJ-601 | Watch and listen tracking | Engagement & AI | 5 | Must | S | MBJ-101 |
| MBJ-602 | XP, levels, badges | Engagement & AI | 5 | Should | M | MBJ-601 |
| MBJ-603 | Leaderboards | Engagement & AI | 5 | Could | S | MBJ-602 |
| MBJ-604 | Captions | Engagement & AI | 5 | Should | M | — |
| MBJ-605 | AI stream notes (the facilitator) | Engagement & AI | 5 | Should | L | MBJ-604, MBJ-608 |
| MBJ-606 | Call-ins | Engagement & AI | 5 | Could | XL | MBJ-104, MBJ-301 |
| MBJ-607 | Polls and predictions | Engagement & AI | 5 | Could | L | MBJ-602 |
| MBJ-608 | Who's talking (speaker labels) | Engagement & AI | 5 | Should | M | MBJ-604 |
| MBJ-609 | Tags: sections, topics, people | Engagement & AI | 5 | Should | M | MBJ-605 |
| MBJ-610 | Search inside streams | Engagement & AI | 5 | Should | M | MBJ-604 |
| MBJ-611 | Watch-time rewards (e.g. a free t-shirt) | Engagement & AI | 5 | Should | M | MBJ-601, MBJ-108, MBJ-807 |
| MBJ-612 | Supporter shout-outs | Engagement & AI | 5 | Should | M | MBJ-207 |
| MBJ-613 | Ratings, moment reactions, and hotspots | Engagement & AI | 5 | Should | L | MBJ-601 |
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

**Status:** Done · **Phase 0 — Foundation** · **Priority:** Should · **Size:** S

As the operator, I want useful logs when something breaks in production.

Acceptance criteria:
- [x] pino logger with request id per HTTP request
- [x] Errors logged with stack; no secrets or tokens logged

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

### MBJ-106 — Account settings

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-101

As a member, I want one place to manage my profile, sign-in, notifications, membership, and privacy.

Acceptance criteria:
- [ ] `/account` (signed in only) with sections: Profile, Sign-in and security, Notifications, Membership, Privacy and data
- [ ] Profile links to the editor (MBJ-117); Sign-in and security holds password, email, devices, and sign-in methods (MBJ-113, MBJ-110)
- [ ] Notifications: per-type on/off for in-site, push, and email (replaces the scattered toggles)
- [ ] Membership shows tier, renewal date, and manage/cancel once MBJ-104 lands; before that it shows Free and what paid tiers include
- [ ] Account menu in the top bar links here; works at phone width

### MBJ-107 — Owned email list

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** S · **Depends on:** MBJ-101, MBJ-102

As JimBob, I want my audience's contact info so no platform can take my audience away.

Acceptance criteria:
- [ ] Marketing opt-in checkbox at signup, stored with timestamp
- [ ] Admin can export opted-in users as CSV from Studio
- [ ] Unsubscribe link handling documented
- [ ] Start from the existing Shopify newsletter list (export from Shopify customers who accepted marketing)

### MBJ-108 — Registration

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-101, MBJ-114

As a new viewer, I want to create an account in under a minute so I can chat, comment, and join.

Acceptance criteria:
- [ ] `/join` page and a sign-up dialog anywhere an action needs an account (chat, comment, like); afterwards you land back where you were, with the action ready
- [ ] Fields: email, username, password (at least 10 characters, checked against known-leaked passwords); Google and Apple once MBJ-110 lands
- [ ] Username: unique ignoring case, 3–32 `[A-Za-z0-9_]`, live availability check with suggestions; reserved names blocked (jimbob, admin, mod, support, and staff names); banned words blocked
- [ ] "I'm 13 or older" checkbox; Terms and Privacy links; optional email-list opt-in (MBJ-107)
- [ ] Verification email with a link (expires in 24 h, can be re-sent); unverified accounts can watch and chat but can't tip, buy, or claim rewards
- [ ] Bot protection: Cloudflare Turnstile on the form, plus rate limits per IP and per email
- [ ] Errors say what went wrong and how to fix it ("That username is taken — try jimbobfan_2")
- [ ] Existing POC accounts are asked to add and verify an email the next time they sign in

### MBJ-109 — Payments API and receipts

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-104

As a member, I want reliable billing; as JimBob, I want to see and manage payments.

Acceptance criteria:
- [ ] Stripe webhooks (checkout, renewals, failures, refunds) update entitlements idempotently
- [ ] Members see payment history and receipts; Stripe customer portal to change card or cancel
- [ ] Studio: revenue, refunds, failed payments; test mode for staging
- [ ] Backup processor evaluated (PRD open question)

### MBJ-110 — Easy sign-in and staying signed in

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-101

As a viewer, I want to sign in with one tap and stay signed in on my devices.

Acceptance criteria:
- [ ] Sign in with Google (also links YouTube for MBJ-215), Apple, X, and Facebook; email magic link as the no-password option
- [ ] Passkeys (Face ID / fingerprint / Windows Hello) instead of passwords
- [ ] Stay signed in: long-lived sessions that renew while used (e.g. 90 days), on web and the installed app
- [ ] Profile: see signed-in devices and sign out any of them; add or remove sign-in methods; merge an existing account
- [ ] Signing in from a notification or email link lands you where you were going
- [ ] Self-hosted auth library per ADR-006 (user records stay in our database)

### MBJ-111 — Saved payment methods and a wallet

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** L · **Depends on:** MBJ-104, MBJ-112

As a member, I want to pay in one tap with a method I've saved; as JimBob, I want to keep as much of each payment as possible.

Acceptance criteria:
- [ ] Saved methods on the profile: cards via Stripe, Apple Pay / Google Pay, PayPal (and Venmo), bank account (ACH); set a default, remove any
- [ ] One-tap tips, Bob Chats, and memberships with the default method; receipts in the profile
- [ ] Wallet (prepaid credits): add $10/$20/$50 once, then spend on Bob Chats and tips with no per-message fee
- [ ] Yearly membership option (one fee instead of twelve) with a discount
- [ ] Web checkout for everything where app-store rules allow; in-app purchase only where required
- [ ] A second processor ready (PayPal or other) in case one drops the account (PRD independence goal)

### MBJ-112 — Payments and fees decision (ADR)

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** S

As JimBob, I want the lowest-fee setup that still makes paying easy and keeps me independent.

Acceptance criteria:
- [ ] Compare with current published rates: Stripe (cards, Link, ACH), PayPal/Venmo, Shopify Payments, bank transfers, and crypto processors; include app-store fees for the phone apps
- [ ] Model real money with JimBob's numbers: memberships, Bob Chats/tips by size, merch orders, and the current Shopify plan and apps
- [ ] Decide merch: keep Shopify, or move to our own checkout (Stripe) with a print-on-demand partner for fulfilment; show the yearly saving and the work involved
- [ ] Record the decision as an ADR and update MBJ-104, MBJ-109, MBJ-111, and MBJ-807

### MBJ-113 — Password reset and email change

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-101, MBJ-114

As a member, I want to get back into my account if I forget my password, and keep my email up to date.

Acceptance criteria:
- [ ] "Forgot password?" sends a reset link (one use, expires in 1 h); the response never reveals whether the email has an account
- [ ] Resetting or changing the password signs out every other device
- [ ] Change email: confirm with the password, verify the new address, and notify the old one with a link to undo within 7 days
- [ ] Change password from Account settings (current password required)
- [ ] Rate limits on reset and change requests; every change is logged for the member's security history

### MBJ-114 — Sending email (ADR)

**Status:** In progress · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** S

As JimBob, I want account emails to arrive from my own domain and not land in spam.

Acceptance criteria:
- [ ] Pick a transactional email provider and record it as an ADR with the monthly cost at 1k, 10k, and 50k members (compare Resend, Postmark, Amazon SES)
- [ ] Sender on JimBob's domain (e.g. hello@) with SPF, DKIM, and DMARC set up
- [ ] Plain branded templates: verify email, reset password, email changed, new sign-in, account deleted
- [ ] Bounces and complaints recorded; bounced addresses stop getting mail
- [ ] Server tests never send real email (a stub records what would have been sent)

### MBJ-115 — Welcome steps

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** S · **Depends on:** MBJ-108

As a new member, I want a quick start that makes the site mine without forcing anything.

Acceptance criteria:
- [ ] After sign-up: add an avatar, pick notifications (live alerts on by default), link YouTube (MBJ-215), see membership options
- [ ] Every step can be skipped; a checklist on the profile shows what's left
- [ ] Ends on the page they signed up from, or the latest video

### MBJ-116 — Public profile

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-101

As a viewer, I want to see who someone in chat is; as a member, I want a page that shows I'm part of the community.

Acceptance criteria:
- [ ] `/@username` page: avatar, display name, bio, links, joined date, tier badge, and badges/level once MBJ-602 lands
- [ ] Recent public activity: comments with the video and moment they're on (each opens the video there); chat messages only if the member allows it
- [ ] Tapping a name or avatar in chat or comments opens a small profile card with "View profile" and "Mention"
- [ ] Linked YouTube/Rumble names shown once verified (MBJ-215)
- [ ] Anyone can view profiles, signed in or not; they aren't in search results (noindex) unless the member turns that on
- [ ] Banned members' profiles show only the username

### MBJ-117 — Edit profile

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-116

As a member, I want to choose how I look to everyone else on the site.

Acceptance criteria:
- [ ] Avatar: upload (JPEG/PNG/WebP up to 5 MB), crop to a circle, resized to small and large sizes; a default avatar with initials and a color until then
- [ ] Display name (up to 40 characters, shown next to the username), bio (up to 300 characters), up to 3 links
- [ ] Username change once every 30 days; the old name stays reserved for 30 days and old profile links redirect
- [ ] Avatars, names, and bios go through the same banned-word filter as chat; mods can reset them from Studio
- [ ] Changes show everywhere (chat, comments, profile) without a reload

### MBJ-118 — Download my data and delete my account

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-101, MBJ-114

As a member, I want to take my data with me or leave for good; as JimBob, I want the apps to pass store review.

Acceptance criteria:
- [ ] Download my data: profile, comments, chat messages, likes, watch history, and payments as a JSON file
- [ ] Delete account from Account settings with the password (or a fresh sign-in); required in the phone apps by Apple and Google
- [ ] 30 days to change your mind (signing in cancels it), then the account is erased; paid memberships are cancelled first
- [ ] Chat messages and comments stay in replays as "Deleted user" so conversations still make sense; an option also removes them
- [ ] Confirmation email at request and at erasure

### MBJ-119 — Block and mute

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** S · **Depends on:** MBJ-101

As a member, I want to stop seeing someone who bothers me.

Acceptance criteria:
- [ ] Block from the profile card or profile page; unblock from Account settings
- [ ] A blocked member's chat messages, comments, and mentions are hidden for you; they can't mention you or reply to you
- [ ] Mute (hide their messages) without them being able to tell
- [ ] Blocking never hides mods or JimBob
- [ ] Report a member (from the profile card, a message, or a comment) with a reason; reports land in a queue mods work from Studio (MBJ-204)

## Epic 2xx — Chat & moderation

The core chat experience and the tools to keep it usable.

### MBJ-201 — Chat replay polish

**Status:** Done · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M

As a viewer, I want chat that feels as good as YouTube's.

Acceptance criteria:
- [x] "Jump to latest" button appears when scrolled up; resumes auto-scroll
- [x] Hovering a message shows its video timestamp; clicking seeks the player there
- [x] On WebSocket reconnect, missed messages are fetched since the last id

### MBJ-202 — @mention autocomplete and notifications

**Status:** Done · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-101

As a member, I want to know when someone mentions me.

Acceptance criteria:
- [x] Typing `@` suggests recent chatters in this video
- [x] Mentioned native users get an in-app notification (bell with count)
- [x] Clicking a notification opens the video at that message's timestamp

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
- [ ] Bring in Bob Chats (today sold as a product on the Shopify store): shown and pinned like Super Chats, counted in the same totals

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

### MBJ-210 — Video comments

**Status:** Done · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-001

As a viewer, I want YouTube's comments and our members' comments under each video, like on YouTube.

Acceptance criteria:
- [x] Import pulls YouTube comments with replies, likes, pinned, and creator flag; re-import refreshes likes
- [x] Comments section under the video: Top/Newest sort, 20 threads per page, replies collapsed per thread
- [x] Signed-in members post comments and replies (one level); tier-gated like chat; rate limited
- [x] YT/JB source tags and a Creator badge distinguish where each comment came from

### MBJ-211 — One conversation across live chat, replay chat, and comments

**Status:** Done · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** L · **Depends on:** MBJ-210

As a viewer, I want to join the stream's conversation after it ended without losing what was said live or what each reply answers.

Acceptance criteria:
- [x] Chat marks live vs replay messages; Live only (default) / Live + replay toggle with a count of hidden later posts
- [x] Chat and comment replies quote the exact message they answer; tapping the quote shows the original
- [x] Tap a name to reply with @name; typing @ suggests names from the video
- [x] Comments can carry a moment in the video and appear as bubbles in the chat feed; YouTube comments take the first typed time
- [x] Typed times in comments are clickable; a chat bubble opens its whole thread

### MBJ-212 — Resume where you left off

**Status:** Done · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** S

As a viewer, I want videos to pick up where I stopped, on any device.

Acceptance criteria:
- [x] Position saved every 10s and on leaving the page; on the account when signed in, in the browser otherwise
- [x] Reopening resumes (past 10s, not in the last 30s) with Resumed from mm:ss and a Start over button
- [x] ?t=<seconds> links start at that time
- [x] Video cards show a watched progress bar

### MBJ-213 — Installable web app (PWA)

**Status:** Done · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M

As a viewer, I want to add the site to my phone's Home Screen and use it like an app.

Acceptance criteria:
- [x] Web app manifest and icons; installable in Chrome/Edge (no installability errors)
- [x] Service worker caches the app shell; API, WebSockets, and video are never cached
- [x] Install app button where the browser supports it; one-time Share -> Add to Home Screen hint on iPhone

### MBJ-214 — Push notifications (web)

**Status:** Done · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-202, MBJ-213

As a member, I want a notification on my phone when someone mentions or replies to me, even with the app closed.

Acceptance criteria:
- [x] Web Push with VAPID keys; subscribe/unsubscribe endpoints; dead subscriptions removed
- [x] Turn on from the bell; iPhone asks to add to Home Screen first
- [x] Tapping a notification opens the video at that moment (and the thread for comments)
- [x] Needs VAPID_PRIVATE_KEY set on Render

### MBJ-215 — Link YouTube and Rumble names to a profile

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-202

As a member, I want my YouTube/Rumble chat history and mentions tied to my site account.

Acceptance criteria:
- [ ] Profile lets a member claim a YouTube handle and gets a one-time code
- [ ] Posting the code in JimBob's live chat or as a comment verifies the claim on the next import
- [ ] Rumble names verified by hand in Studio until Rumble chat ingest exists
- [ ] Linked YouTube messages show the site name and tier badge; @mentions of the YouTube handle notify the member

### MBJ-216 — Count one view per viewer

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** S

As JimBob, I want view counts I can trust.

Acceptance criteria:
- [ ] A view counts once per viewer per video per day (account, or browser for signed-out)
- [ ] Refreshes and resumed sessions don't add views

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

### MBJ-506 — Move stored video to R2 (ADR-010)

**Status:** To do · **Phase 4 — Owned live + audio** · **Priority:** Should · **Size:** M

As JimBob, I want my library in plain files I control, at a fraction of Stream's storage cost.

Acceptance criteria:
- [ ] Decision recorded on ADR-010
- [ ] Import transcodes to an HLS ladder + audio-only with ffmpeg and uploads to R2
- [ ] Gated videos protected by a short-lived token checked at the edge
- [ ] Existing Stream videos migrated; captions kept (transcripts table)

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
- [ ] Activity badges for heavy chatters and commenters (e.g. bronze/silver/gold by messages and comments that others reply to or like), streaks for attending live, and a Regular badge; shown in chat, comments, and on profiles
- [ ] JimBob can create and award custom badges (e.g. Debate MVP, Founding member) from Studio

### MBJ-603 — Leaderboards

**Status:** To do · **Phase 5 — Engagement** · **Priority:** Could · **Size:** S · **Depends on:** MBJ-602

As a regular, I want to see where I rank.

Acceptance criteria:
- [ ] Per-stream and all-time leaderboards
- [ ] Shown on watch page and in Studio

### MBJ-611 — Watch-time rewards (e.g. a free t-shirt)

**Status:** To do · **Phase 5 — Engagement** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-601, MBJ-108, MBJ-807

As a loyal viewer, I want a real reward for the hours I spend watching and listening.

Acceptance criteria:
- [ ] JimBob sets milestones and rewards in Studio (e.g. 100 hours watched → free t-shirt), with a monthly budget or a limit on claims
- [ ] Only real watching counts: playing video or Listen only, at most real time (2x speed doesn't double it), idle and background-muted tabs excluded, daily cap
- [ ] Progress bar on the viewer's profile and a notification when a reward unlocks
- [ ] Claiming a physical reward needs a verified account (MBJ-108); one per person per reward
- [ ] Delivered through the Shopify store: a one-time 100%-off code for the chosen shirt, so ordering, sizing, and shipping use the existing checkout
- [ ] Studio list of claims, with the ability to review and cancel suspicious ones

### MBJ-612 — Supporter shout-outs

**Status:** To do · **Phase 5 — Engagement** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-207

As a supporter who super chats or Bob Chats, I want JimBob to see it and thank me.

Acceptance criteria:
- [ ] Every super chat, Bob Chat, and tip goes into a shout-out queue in Studio during the stream, oldest first, with name, amount, and message; JimBob marks each one read
- [ ] Optional on-stream overlay (a browser source for OBS) that shows the current shout-out
- [ ] Paid messages are highlighted and pinned in chat (MBJ-207); the supporter gets a thank-you notification when JimBob reads it
- [ ] Supporter badge and a Supporters wall with top supporters this month (opt-in names)
- [ ] Shout-outs appear in the stream notes with the time JimBob answered (MBJ-605)

### MBJ-613 — Ratings, moment reactions, and hotspots

**Status:** In progress · **Phase 5 — Engagement** · **Priority:** Should · **Size:** L · **Depends on:** MBJ-601

As a viewer, I want to rate a stream and mark the parts that are funny, interesting, or boring, and see what everyone else thought minute by minute.

Acceptance criteria:
- [ ] Thumbs up / down on each video (counts shown; one vote per person, changeable)
- [ ] Moment reactions while watching: one tap (Funny, Interesting, Fire, Boring, Cringe) stamps the current moment; press-and-drag on the progress bar marks a stretch (e.g. a boring call-in from 2:04:00 to 2:19:30) with a reaction
- [ ] Hotspot strip over the progress bar: a minute-by-minute heatmap of reactions, colored by the strongest reaction, combined with chat activity; tapping a spike jumps there
- [ ] Optional "skip marked-boring stretches" and "play the best parts" (highest-rated minutes) modes
- [ ] Studio: per-video minute-by-minute chart of reactions and chat (with MBJ-702) to see what landed and what dragged
- [ ] Fair counting: signed-in viewers only, one reaction per kind per person per minute, stretches capped in length, and heavy one-person marking down-weighted
- [ ] Feeds the AI stream notes and tags (MBJ-605, MBJ-609): hotspots become suggested highlights and clips

### MBJ-604 — Captions

**Status:** In progress · **Phase 5 — Engagement** · **Priority:** Should · **Size:** M

As a viewer, I want captions on stored videos.

Acceptance criteria:
- [ ] Captions generated for each VOD (Stream captions or Whisper)
- [ ] Selectable in web and mobile players
- [ ] Transcript stored

### MBJ-605 — AI stream notes (the facilitator)

**Status:** To do · **Phase 5 — Engagement** · **Priority:** Should · **Size:** L · **Depends on:** MBJ-604, MBJ-608

As a viewer or JimBob, I want notes for every stream like an AI meeting facilitator writes: what happened, who said what, and when.

Acceptance criteria:
- [ ] After a stream is archived, a job reads the transcript, speaker labels (MBJ-608), chat, super chats and Bob Chats, and writes the notes
- [ ] Summary at the top; sections/chapters with titles and times that seek the player
- [ ] Key exchanges between speakers: each side's main points in a debate, with timestamps
- [ ] Money moments: every super chat, Bob Chat, and tip with who sent it, what they said, and whether/when JimBob answered it
- [ ] Questions from chat and guests, answered or not; follow-ups and promises made on stream ("I'll look into that next week")
- [ ] Chat pulse: busiest moments and what set them off
- [ ] JimBob can edit, hide, or regenerate before publishing; notes are members-only or public per video
- [ ] Cost per stream estimated and shown before running on the whole library (Claude API for the notes)

### MBJ-608 — Who's talking (speaker labels)

**Status:** To do · **Phase 5 — Engagement** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-604

As a viewer, I want the transcript to show who said each line.

Acceptance criteria:
- [ ] Transcripts with speaker turns (diarization): Whisper + a diarization model, or a transcription service with speaker labels (decide by cost and accuracy)
- [ ] JimBob names each speaker once per stream in Studio (JimBob, guest names, callers); recurring guests are remembered
- [ ] Transcript panel on the watch page follows playback, shows speaker names, and each line seeks the video

### MBJ-609 — Tags: sections, topics, people

**Status:** To do · **Phase 5 — Engagement** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-605

As a viewer, I want to find every moment about a topic or with a person across all streams.

Acceptance criteria:
- [ ] Tags on moments and sections: topics (e.g. evolution, Orthodoxy), people who spoke, people mentioned, and chat users involved
- [ ] AI suggests tags from the notes (MBJ-605); JimBob and mods accept, edit, or add their own in Studio
- [ ] Topic and person pages: every tagged moment across streams, playable from that point
- [ ] Tags feed search (MBJ-610) and playlists (auto playlist per topic or guest)

### MBJ-610 — Search inside streams

**Status:** To do · **Phase 5 — Engagement** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-604

As a viewer, I want to search what was said and jump straight to it.

Acceptance criteria:
- [ ] Search across transcripts, chat, comments, notes, and tags; results show the line with its speaker and time
- [ ] Clicking a result opens the video at that moment (?t=)
- [ ] Postgres full-text search to start; filters by stream, speaker, date, and source (said on stream vs chat)

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

### MBJ-701 — Video management in Studio

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** L · **Depends on:** MBJ-102

As JimBob, I want to upload, edit, replace, and delete videos without a terminal.

Acceptance criteria:
- [ ] Upload a video file from the browser (resumable, straight to Cloudflare Stream or R2 per ADR-010) with progress; it appears once processing finishes
- [ ] Start a YouTube import from a URL (background job with status: downloading, uploading, processing, chat, comments, captions)
- [ ] Edit title, description, type (video/short/live), tier, publish date, and thumbnail (pick a frame or upload an image)
- [ ] Unpublish/hide a video (keeps chat, comments, and stats) vs. delete it (confirm step; removes the file from Stream and its chat, comments, and playlist entries)
- [ ] Replace the video file but keep its chat, comments, captions, and link, with an offset adjustment if the new file starts earlier or later
- [ ] Schedule a video to go public at a date and time; draft videos visible only in Studio
- [ ] Every change recorded in an audit log (who, what, when)

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

### MBJ-705 — User management in Studio

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-102, MBJ-204

As JimBob or a mod, I want to find any member and act on them in one place.

Acceptance criteria:
- [ ] Users list with search and filters: tier, role, banned, highlighted, new this week; sort by activity
- [ ] User page: profile, tier and membership, linked YouTube/Rumble names, chat and comment history, notifications sent, mod history
- [ ] Ban (with reason; blocks sign-in, chat, and comments), time out for a set time, unban; hide all of a user's messages in one step
- [ ] Highlight a user: VIP/featured badge and name color in chat and comments (e.g. regulars, guests, supporters); remove it any time
- [ ] Change role (viewer, mod, admin) and, for support cases, tier; private staff notes on the user
- [ ] Every action logged in mod_actions with who did it; bans and highlights apply live over WebSocket

## Epic 8xx — Library & community

Videos dashboard, playlists, up next, posts, and live presence.

### MBJ-801 — Videos dashboard with filters

**Status:** Done · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M

As a viewer, I want to find videos by type and search, starting from everything.

Acceptance criteria:
- [x] Video types from import: regular, short, past live (vertical + short = short; was_live = live)
- [x] Filter chips: All, Videos, Shorts, Live, Members only; search and sort (newest, most viewed)
- [x] Members-only items show which tier unlocks them; access still enforced on the server

### MBJ-802 — Playlists

**Status:** Done · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-801

As a viewer, I want JimBob's playlists, and as JimBob I want to build my own.

Acceptance criteria:
- [x] Import YouTube playlists with their order
- [x] Studio: create, rename, reorder, add/remove videos
- [x] Playlists tab lists them with count and total length

### MBJ-803 — Up next and autoplay

**Status:** Done · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** S · **Depends on:** MBJ-802

As a viewer, I want the next video to start when one ends.

Acceptance criteria:
- [x] Queue beside the player from the playlist (or related videos)
- [x] Autoplay next with a short countdown and cancel
- [x] Works in Listen only too

### MBJ-804 — Posts

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** L

As JimBob, I want to post updates, images, and polls; as a member, I want to discuss them.

Acceptance criteria:
- [ ] Studio composer: text, image, poll
- [ ] Posts tab and post page; members-only posts respect tiers
- [ ] Threaded, quote-aware comments reuse the comments system
- [ ] Built for how JimBob posts on YouTube (checked 2026-09-30, last 10 posts: all image posts, short or no caption, 400-1,100 likes): multi-photo work-in-progress series (icon painting), memes/comebacks, debate call-outs tagging other creators, personal photos
- [ ] Platform extras shown in the preview on /posts: polls, stream links with the video card, members-only posts (blurred and locked below the tier), store drops with the product card, Q&A calls
- [ ] Import: YouTube's Posts page includes the latest ~10 posts in its page data; older posts need paging through its continuation requests (yt-dlp doesn't import posts)

### MBJ-805 — Live indicator

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** S

As a viewer, I want to see at a glance when JimBob is live.

Acceptance criteria:
- [ ] Red ring + LIVE badge on JimBob's avatar and the header when live
- [ ] Live card at the top of Videos
- [ ] Studio Go live switch pointing at the YouTube live URL until MBJ-301 detects it automatically
- [ ] When not live, show the next stream from the schedule (weekdays around 12:00pm ET)

### MBJ-806 — Import the whole channel

**Status:** To do · **Phase 4 — Owned live + audio** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-506

As the operator, I want to load JimBob's full library in one run.

Acceptance criteria:
- [ ] Import from a Google Takeout folder (match by YouTube ID from the metadata) or the channel list
- [ ] Proposes file-to-video matches for review; OBS recordings matched by date and length with an offset adjustment
- [ ] Skips videos already imported; deletes local copies after upload; resumable overnight run

### MBJ-807 — Store (Shopify integration)

**Status:** In progress · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M

As a fan, I want to browse and buy JimBob's merch without leaving his platform's look and feel.

Acceptance criteria:
- [ ] Decision: keep the existing Shopify store (madebyjimbob.com, ~150 products) for catalog, checkout, and fulfilment
- [ ] Shop section shows the store's collections and products live (public product JSON, 10-minute cache); Buy opens the product in the store
- [ ] Next: cart and checkout inside the platform with Shopify's Storefront API (needs a Storefront access token from JimBob's Shopify admin)
- [ ] Member and founding-member discount codes applied at checkout
- [ ] Revisit moving merch off Shopify (own Stripe checkout + print-on-demand) if MBJ-112 shows a real saving

### MBJ-808 — Art section

**Status:** Done · **Phase 2 — Mobile** · **Priority:** Should · **Size:** S · **Depends on:** MBJ-807

As a fan, I want to browse JimBob's illustrations and comics.

Acceptance criteria:
- [x] Gallery built from the store's art collections (original art, art prints, classic art prints, digital art)
- [x] Tap a piece to see it large; View in store buys the print
- [x] Filter by kind of art
- [x] Later: link pieces to the videos and posts they appear in

### MBJ-809 — Social media links and sharing

**Status:** In progress · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** S

As JimBob, I want my socials everywhere and every page easy to share.

Acceptance criteria:
- [ ] Links to JimBob's YouTube, X, Instagram, Facebook, Gab, Telegram, Spotify, Bandcamp (and Rumble) on the Videos banner (done), header menu, and footer
- [ ] Share button on videos, moments (?t=), comments, and playlists; copies a link or opens the phone's share sheet
- [ ] Open Graph and Twitter card previews with title, thumbnail, and description

### MBJ-810 — Navigation bar

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M

As a viewer, I want to find every part of the site quickly on desktop and phone.

Acceptance criteria:
- [ ] Top navigation: Videos, Playlists, Posts, Live, Store, Art, Members, with the live ring (MBJ-805)
- [ ] Phone and installed app: bottom tab bar with the main sections
- [ ] Account menu: profile, notifications, membership, Studio for admins, sign out
- [ ] Keyboard and screen-reader friendly

### MBJ-811 — Founding members

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-104

As an early supporter, I want to be recognised as a founding member.

Acceptance criteria:
- [ ] Limited founding membership (count or date window) with a price locked for life
- [ ] Founding badge in chat and comments; founding members page (wall) with opt-in names
- [ ] Perks defined with JimBob (early access, store discount, call-in priority)

### MBJ-813 — Schedule calendar with export

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M

As JimBob, I want to publish my stream and debate schedule; as a viewer, I want it in my own calendar.

Acceptance criteria:
- [ ] Studio: add, edit, and cancel events: stream, debate, guest appearance, premiere, members-only event; title, description, guests, start time with time zone, expected length, and the YouTube (or site) link
- [ ] Recurring events (e.g. weekday streams around 12:00pm ET) with one-off changes and cancellations
- [ ] Schedule page: upcoming list and month view shown in the viewer's own time zone, with countdowns; members-only events respect tiers
- [ ] Export: Add to calendar per event (Google, Apple, Outlook via an .ics file) and a subscribe link (webcal/ICS feed) that keeps a viewer's calendar updated automatically
- [ ] Remind me: push and in-site notification before an event starts (MBJ-214), and at go-live
- [ ] Feeds the live indicator's "Next stream" (MBJ-805) and can post an announcement to Posts (MBJ-804)

### MBJ-814 — Unwatched filter and binge queue

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** S · **Depends on:** MBJ-212, MBJ-803

As a viewer, I want to see what I haven't watched and play it all back to back.

Acceptance criteria:
- [ ] Filter chips on Videos: Unwatched, In progress, Watched (from watch progress; account when signed in, browser otherwise)
- [ ] Binge queue: an automatic playlist of everything you haven't finished, in-progress first then oldest to newest (or newest first), that plays with Up next and autoplay, in Listen only too
- [ ] Mark as watched / unwatched from a video's menu; finishing a video (last 30s) marks it watched
- [ ] Counts on the chips and a "Keep watching" row on the Videos page

### MBJ-815 — Technical SEO

**Status:** In progress · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** M · **Depends on:** MBJ-809

As JimBob, I want Google and link previews to understand every page, so people find the platform instead of only YouTube.

Acceptance criteria:
- [ ] The server fills in each page's title, description, canonical URL, and Open Graph/Twitter tags before sending it (the app is client-rendered, so today crawlers and link previews see the same empty page for every video)
- [ ] Crawlers get the real content in the HTML for public pages: video title, description, chapters, and a transcript excerpt (prerender or server-render the public pages)
- [ ] Structured data (JSON-LD): VideoObject for each video (thumbnail, upload date, duration, views, embed URL), key moments from chapters, BroadcastEvent for live streams, Event for scheduled streams and debates (MBJ-813), Person/Organization for JimBob with his social profiles
- [ ] sitemap.xml (videos, playlists, posts, topic and guest pages) and robots.txt; members-only content and Studio are noindex
- [ ] Real 404 status for missing pages (today every address returns 200) and 301 redirects for moved ones
- [ ] Keep the madebyjimbob.onrender.com preview out of search (noindex) until the real domain is chosen (ADR-011), then redirect it to the canonical domain
- [ ] Speed: split the JavaScript bundle (currently one ~500 KB file), long cache headers for hashed assets, lazy images; check Core Web Vitals
- [ ] Google Search Console and Bing Webmaster Tools verified; sitemap submitted

### MBJ-816 — Search-friendly content

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** M · **Depends on:** MBJ-815, MBJ-605, MBJ-609

As a fan searching Google for a debate, guest, or topic, I want to land on JimBob's platform.

Acceptance criteria:
- [ ] Readable URLs with slugs (e.g. /watch/4/evolution-debate, /playlist/5/debates); old numeric URLs redirect
- [ ] Each video page has a unique written summary and chapters (from MBJ-605) and an indexable transcript section (public videos only)
- [ ] Topic and guest pages (MBJ-609) as landing pages: "JimBob on evolution", "JimBob vs <guest>", with every related moment
- [ ] Internal links between related videos, topics, guests, playlists, and posts
- [ ] YouTube and social descriptions link back to the matching platform page (distribution, not just SEO)
- [ ] Track which searches bring people in (Search Console) in the Studio dashboard

### MBJ-817 — Friends of the channel

**Status:** To do · **Phase 1 — VOD platform** · **Priority:** Should · **Size:** S

As JimBob, I want to point my audience to the creators, guests, and partners I recommend.

Acceptance criteria:
- [ ] Studio: add, edit, reorder, and remove friends: name, photo, one-line description, and links (YouTube, X, Rumble, website, store)
- [ ] Friends page, plus a short row on the Videos banner and a link in the navigation (MBJ-810)
- [ ] Each friend links to the streams they appear in once guests are tagged (MBJ-608, MBJ-609)
- [ ] Sponsors and affiliate links clearly labeled as such; external links open in a new tab
- [ ] Friends can be shown in the stream notes and on topic/guest pages

### MBJ-812 — JimBob's brand on the platform

**Status:** Done · **Phase 1 — VOD platform** · **Priority:** Must · **Size:** S

As JimBob, I want the platform to look like my brand, not a template.

Acceptance criteria:
- [x] Store teal (#27717A) as the accent color; MADEbyJIMBOB wordmark in Jost (the store's font)
- [x] JimBob's illustrated avatar in the header and as the app icon; his banner art on the Videos page
- [x] Stream schedule and social links on the Videos banner
- [x] Brand assets copied from madebyjimbob.com into web/public/brand with JimBob's approval
