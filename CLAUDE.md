# CLAUDE.md

Guidance for Claude Code working in this repo. Read this first, then the doc relevant to your task.

## Start here

- **`docs/STATUS.md` is the source of truth for where things stand**: what's built, what's live, decisions,
  what's waiting on Ruben, the ordered next steps, and a Reference section (environments, services, video ids
  local vs live, JimBob's channel/store/socials, verification routine). Read it before starting work.
- Live site: https://madebyjimbob.onrender.com (Render; deploys on every push to `main`).
  Code: https://github.com/rcerv87/madebyjimbob. Ruben (product owner) tests in real Chrome and on his phone.
- The person you're working with is Ruben; JimBob is the creator the platform is for. Ruben wants visible
  progress, numbered click-by-click steps for anything he must do, costs in dollars per month, and a single
  recommendation when there's a choice.

## What this is

MadeByJimBob: a creator platform that makes JimBob independent of any single platform.
Web + iOS/Android. Stored and live video, a YouTube/Discord-style chat that merges YouTube,
Rumble, and native messages, tiered memberships (Free / Plus / Premium), and engagement features.

- Product requirements: `docs/PRD.md`
- Architecture and phases: `docs/ARCHITECTURE.md`
- Chat system (the core of the product): `docs/CHAT.md`
- Data model: `docs/DATA_MODEL.md`
- API + WebSocket contract: `docs/API.md`
- Mobile app: `docs/MOBILE.md`
- Decisions: `docs/adr/`
- Work items: `BACKLOG.md` (also `docs/backlog.csv` for Jira/GitHub import)

## Stack

- `server/` Node 20+ (22 on Render), Express, `ws`, `pg`, `node-pg-migrate`, `pino`, `web-push` (ESM).
  Serves the API, WebSockets, and the built web app.
- `web/` React 18 + Vite + react-router + hls.js. Installable PWA (`web/public/manifest.webmanifest`, `sw.js`).
- Store apps: not started. Decide Capacitor (wrap this web app) vs Expo (ADR-008) before MBJ-401.
- Account email via Resend (ADR-012). Postgres on Render. Video on Cloudflare Stream (R2 proposed, ADR-010). Shop and Art read JimBob's Shopify
  store (ADR-011). Deploy via `render.yaml`.

## Commands

```bash
npm install                    # all workspaces
npm run dev:server             # API on :3000 (reads .env)
npm run dev:web                # web on :5173, proxies /api and /ws
npm run build                  # builds web
npm test                       # server (node:test, needs DATABASE_URL_TEST) + web (vitest)
npm run lint                   # ESLint (flat config, eslint.config.js)
npm run migrate                # apply pending migrations (`-- down` rolls back one)
npm run captions:fetch         # save finished Stream captions into transcripts (`-- --generate` requests missing ones)
npm run import:playlists -- <playlist or channel URL>   # YouTube playlists (order kept)
npm run migrate:create -- <name>   # new SQL migration in server/migrations/
npm run format                 # Prettier; `format:check` to verify only
npm run import:youtube -- <url> [--tier plus] [--stream-uid <uid>] [--chat-only] [--no-comments]
```

Run `npm test`, `npm run lint`, and `npm run format:check` before finishing any story. CI (`.github/workflows/ci.yml`) runs the same checks plus the build on every PR to `main`.

- Server tests live in `server/test/` and run against `DATABASE_URL_TEST`, which is wiped on every run. `test/helpers.js` refuses any database without "test" in its name.
- `server/src/app.js` builds the app and WebSocket server; `server/src/index.js` only listens.
- Web tests live in `web/src/test/`; `setup.js` provides `mockApi()` and a fake WebSocket.

## How to work a story

1. Find the story in `BACKLOG.md`. Check its dependencies are done.
2. Branch: `mbj-<id>-<short-slug>` (e.g. `mbj-105-chat-upvotes`).
3. Implement to the acceptance criteria exactly. If a criterion is unclear or conflicts with the docs, stop and ask rather than guessing.
4. Add or update tests for the behavior you changed.
5. Update docs in the same change:
   - new/changed endpoint or WS message → `docs/API.md`
   - schema change → migration + `docs/DATA_MODEL.md`
   - architectural choice → new ADR in `docs/adr/`
6. Mark the story `Done` in the `STATUS` dict in `docs/backlog_source.py`, re-run it (regenerates `BACKLOG.md` and `docs/backlog.csv`), and note anything deferred.

## Conventions

- SQL: parameterized queries only. Never interpolate user input into SQL.
- Schema: every change is a new migration in `server/migrations/` (`npm run migrate:create -- <name>`, plain SQL with `-- Up Migration` / `-- Down Migration` sections). Never edit a migration that has been deployed.
- Migrations run via `npm run migrate` (Render pre-deploy command, and before `dev:server`), never on app boot. `npm run migrate -- down` rolls back the latest one.
- Chat messages always carry `offset_ms` (position in the video). That field is what makes replay sync work — never drop it.
- Chat `source` is one of `youtube | rumble | native`. New sources get a new enum value, not a new table.
- Tier checks happen on the server. The client only hides UI.
- Accounts: Better Auth (`server/src/auth.js`, ADR-006) on our tables (`users`, `sessions`, `accounts`,
  `verifications`); its endpoints live under `/api/auth/*`. Get the signed-in user with `currentUser(req)` /
  `sessionUser(headers)`. The web app uses the session cookie; tests and apps use `Authorization: Bearer`
  (the `set-auth-token` header from sign-in). Tests sign up with `signIn(call, name, tier)` in `test/helpers.js`,
  which sets the tier in the database (users can't choose one). Better Auth refuses requests without an
  `Origin` header, so test clients send one.
- Notifications: call `notifyFor()` from `server/src/notify.js` after saving anything that can mention or reply to someone; it stores, sends over WebSocket, and pushes.
- Email: only through `sendEmail()` in `server/src/email.js` with a template from `emailTemplates.js` (never call
  the provider directly). It skips suppressed addresses and logs every send. Tests blank `RESEND_API_KEY` and
  record sends with `setTransport()`.
- The service worker (`web/public/sw.js`) must never cache `/api`, `/ws`, or video. Bump `CACHE` when changing what it caches.
- Status, decisions, and next steps live in `docs/STATUS.md`; update it when finishing a story.
- Logging: use `logger` / `req.log` from `server/src/logger.js`, never `console`. Credentials are redacted by path (`REDACT_PATHS`); add new sensitive fields there.
- Secrets live in env vars. Add every new var to `.env.example` and `render.yaml` (`sync: false`).
- UI copy: sentence case, plain verbs, errors say what happened and how to fix it.
- Keep dependencies lean; mention any new dependency and why in the PR description.

## Working notes (learned the hard way)

- Ship each release: branch → tests/lint/format/build → real-browser check → merge to `main` (`--no-ff`) →
  push → wait for the new `index-<hash>.js` on the live `/` → re-run data imports against the live database if
  the release needs them (see STATUS.md Reference) → update STATUS.md and the backlog `STATUS` dict.
- Real-browser checks use headless Chrome/Edge over the DevTools protocol (screenshots, DOM reads, device
  emulation for phones). A plain headless window can't go below ~500px, so phone "overflow" in plain
  screenshots is fake; use `Emulation.setDeviceMetricsOverride`. Keep `--user-data-dir` short (e.g.
  `%TEMP%\cw123`): a long profile path breaks Chrome's Cache Storage on Windows, so the service worker fails
  to install ("Entry already exists" / "Unexpected internal error") though the site is fine.
- The player reports its time ~4 times a second. Never keep that in the watch page's state (it re-renders the
  whole page); it lives in the clock from `web/src/clock.js`, and only what shows the time subscribes
  (`useClock`: the chat). Measure playback cost with `Performance.getMetrics` (ScriptDuration) over 20 s.
- Navigations run as transitions (React Router v7 flags in `web/src/routerFuture.js`). A handler that
  navigates and also sets state deciding what's mounted must do both in one `startTransition`, or React
  renders the in-between state first (it once unmounted the Mini player's video; see `keepPlaying.js`).
- After changing server code, restart the local server before browser-testing; a stale server returns old
  API shapes (this broke the dashboard once).
- Web tests that render `ChatPanel` need a router (`MemoryRouter`) because it reads `?chat=`.
- Server tests blank `VAPID_*` (no real pushes), turn off auth rate limits and the leaked-password check, and point `SHOP_URL` at a stub store; they never touch the
  real store or push services.
- Autoplay rules: browsers allow sound only after a user gesture on the site; the player then waits with a
  Play button (never muted). Phones pause `<video>` when locked; Listen only switches to `<audio>`, and the player does that on its own
  when a phone locks mid-video (back to video on unlock).

## Known POC shortcuts (tracked in backlog)

- Studio access is the `ADMIN_EMAILS` env list (verified emails), not roles → MBJ-102
- Google/Apple sign-in, magic links, passkeys, and the device list aren't built yet → MBJ-110
- Stream URLs unsigned → MBJ-103
- In-memory rate limit → MBJ-205 (Redis)
