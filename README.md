# MadeByJimBob — proof of concept

YouTube-style site for JimBob's past streams: videos on Cloudflare Stream, the original
YouTube live chat replaying in sync, and members posting new chat at their point in the video.

Planning docs: `CLAUDE.md` (start here), `BACKLOG.md`, and `docs/`.

## What's in here

```
render.yaml                        Render blueprint: one web service + Postgres
server/src/index.js                API, WebSocket chat rooms, serves the web app
server/db/schema.sql               users, videos, chat_messages (runs automatically on boot)
server/scripts/import-youtube.js   Past stream -> Cloudflare Stream + chat replay -> Postgres
web/                               React app: home grid, watch page + chat, Studio dashboard
```

## 1. Cloudflare Stream

1. Enable Stream in your Cloudflare dashboard.
2. Create an API token with **Stream: Edit**.
3. Note your **Account ID** and your **customer code** (from any Stream video URL:
   `customer-<CODE>.cloudflarestream.com`).

## 2. Deploy to Render

1. Push this repo to GitHub.
2. Render → **New → Blueprint** → pick the repo. It creates the web service and Postgres.
3. Set `CF_STREAM_CUSTOMER_CODE` and `ADMIN_USERNAMES` (e.g. `jimbob`) on the web service. Optionally `BANNED_WORDS`.
4. Open the site and sign up with an admin username first, so nobody else can claim it.

## 3. Import past streams (run on your machine)

Needs Node 20+, [yt-dlp](https://github.com/yt-dlp/yt-dlp), and ffmpeg.

```bash
cp .env.example .env      # DATABASE_URL = Render's *External* URL, PGSSL=true, CF_* values
npm install
npm run import:youtube -- "https://www.youtube.com/watch?v=VIDEO_ID"
npm run import:youtube -- "https://www.youtube.com/watch?v=VIDEO_ID" --tier plus
```

Options:
- `--tier free|plus|premium` who can watch it (also editable in Studio)
- `--stream-uid <uid>` video is already on Stream; only import metadata + chat
- `--chat-only` re-import chat for a video already in the database

Re-running is safe: chat is de-duplicated by YouTube message ID.
Stream takes a few minutes to process an upload before it plays.

## 4. Run locally

`.env` lives at the repo root. Any Postgres works. To run a throwaway one with the
PostgreSQL install on Windows (no password, port 5544, data in `.localdb/`):

```bash
"/c/Program Files/PostgreSQL/18/bin/initdb.exe" -D .localdb -U postgres -A trust -E UTF8 --no-locale
"/c/Program Files/PostgreSQL/18/bin/pg_ctl.exe" -D .localdb -o "-p 5544 -h 127.0.0.1" -l .localdb/server.log start
"/c/Program Files/PostgreSQL/18/bin/createdb.exe" -h 127.0.0.1 -p 5544 -U postgres madebyjimbob
# .env: DATABASE_URL=postgres://postgres@127.0.0.1:5544/madebyjimbob  PGSSL=false
```

```bash
npm install
npm run dev:server     # API on :3000 (uses .env)
npm run dev:web        # app on :5173, proxies /api and /ws
```

Set `ALLOW_TEST_TIERS=true` locally to get a tier picker at sign-in.

## How chat sync works

Every message stores `offset_ms`, its position in the video. YouTube's replay file already
has it; native posts use the viewer's current playback time. The watch page loads chat in
2-minute windows around the playhead and shows everything up to the current time. New posts
are broadcast over WebSocket to everyone watching that video.

## POC shortcuts to replace before launch

- **Sign-in** is username + password built in-house, with no email or password reset. Swap for real auth + Stripe/RevenueCat (MBJ-101, MBJ-104).
  Until payments exist, everyone is Free unless `ALLOW_TEST_TIERS=true`, so set paid videos' access only when you're ready.
- **Studio** is gated by the `ADMIN_USERNAMES` list. Replace with roles (MBJ-102).
- **Paid video protection**: the API hides the playback URL from lower tiers, but Stream URLs
  are public until you turn on `requireSignedURLs` and mint signed tokens in `server/src/stream.js`.
- **Rate limit** is in-memory (fine for one instance; move to Redis when scaling out).
