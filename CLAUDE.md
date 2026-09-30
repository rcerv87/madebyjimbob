# CLAUDE.md

Guidance for Claude Code working in this repo. Read this first, then the doc relevant to your task.

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

- `server/` Node 20+, Express, `ws`, `pg` (ESM). Serves the API, WebSockets, and the built web app.
- `web/` React 18 + Vite + react-router + hls.js.
- `mobile/` (planned, MBJ-401) Expo + expo-video.
- Postgres on Render. Video on Cloudflare Stream. Deploy via `render.yaml`.

## Commands

```bash
npm install                    # all workspaces
npm run dev:server             # API on :3000 (reads .env)
npm run dev:web                # web on :5173, proxies /api and /ws
npm run build                  # builds web
npm test                       # server (node:test, needs DATABASE_URL_TEST) + web (vitest)
npm run lint                   # ESLint (flat config, eslint.config.js)
npm run format                 # Prettier; `format:check` to verify only
npm run import:youtube -- <url> [--tier plus] [--stream-uid <uid>] [--chat-only]
```

Run `npm test`, `npm run lint`, and `npm run format:check` before finishing any story.

- Server tests live in `server/test/` and run against `DATABASE_URL_TEST`, which is wiped on every run. `test/helpers.js` refuses any database without "test" in its name.
- `server/src/app.js` builds the app and WebSocket server; `server/src/index.js` only migrates and listens.
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
- Schema: after MBJ-003, all changes go through migrations. Don't edit `schema.sql` in place.
- Chat messages always carry `offset_ms` (position in the video). That field is what makes replay sync work — never drop it.
- Chat `source` is one of `youtube | rumble | native`. New sources get a new enum value, not a new table.
- Tier checks happen on the server. The client only hides UI.
- Secrets live in env vars. Add every new var to `.env.example` and `render.yaml` (`sync: false`).
- UI copy: sentence case, plain verbs, errors say what happened and how to fix it.
- Keep dependencies lean; mention any new dependency and why in the PR description.

## Known POC shortcuts (tracked in backlog)

- Username + password sign-in built in-house; tier picker when `ALLOW_TEST_TIERS=true` → MBJ-101
- Studio access is the `ADMIN_USERNAMES` env list, not roles → MBJ-102
- Stream URLs unsigned → MBJ-103
- In-memory rate limit → MBJ-205 (Redis)
