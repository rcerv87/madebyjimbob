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
3. Set `CF_STREAM_CUSTOMER_CODE` (and optionally `BANNED_WORDS`) on the web service.

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

```bash
npm install
npm run dev:server     # API on :3000 (uses .env)
npm run dev:web        # app on :5173, proxies /api and /ws
```

## How chat sync works

Every message stores `offset_ms`, its position in the video. YouTube's replay file already
has it; native posts use the viewer's current playback time. The watch page loads chat in
2-minute windows around the playhead and shows everything up to the current time. New posts
are broadcast over WebSocket to everyone watching that video.

## POC shortcuts to replace before launch

- **Sign-in** is username-only with a self-selected test tier. Swap for real auth + Stripe/RevenueCat.
- **Studio** has no access control. Gate it to JimBob and mods.
- **Paid video protection**: the API hides the playback URL from lower tiers, but Stream URLs
  are public until you turn on `requireSignedURLs` and mint signed tokens in `server/src/stream.js`.
- **Rate limit** is in-memory (fine for one instance; move to Redis when scaling out).
