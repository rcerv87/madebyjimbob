# ADR-004: Owned live ingest to R2 as the independence path

- **Status:** Proposed
- **Date:** 2026-09-29

## Context
Platform independence requires a live path that doesn't depend on YouTube or Rumble. Cloudflare Stream live delivery is costly at ~1,000 viewers.

## Decision
Run MediaMTX (or Owncast) on a VPS, transcode to an HLS ladder plus an audio-only rendition with ffmpeg, write segments to Cloudflare R2, and serve through Cloudflare's CDN. YouTube/Rumble become simulcast targets.

## Consequences
Much lower delivery cost and full control; we operate the ingest box. Enables background audio, PiP, and audio-only for live.

## Update 2026-10-01: Ruben's direction

- **Server:** Owncast (free, open source) on Hetzner Cloud, in Ruben's account (project `MadeByJimBob`). Estimate: a **CPX31**
  in Ashburn (4 vCPU, 8 GB, $0.118/hour) running only during streams. About 110 hours a month (5 h × 22 weekdays) ≈ $13,
  plus ~$1 for a Primary IP and a snapshot, so **≈ $15/month**. Left on all month it would be $73.49. Confirm the size with a
  1-hour test (~12¢) using JimBob's real OBS settings (resolution, bitrate). A CX33 (EU, $10.59/month) is the alternative if
  it's back in stock.
- **Delivery:** HLS segments go to Cloudflare R2, which is free to watch. Live uses R2 even though the archive is on B2
  (ADR-010). Owncast has no viewer limit when it serves from object storage; the server uploads one copy of each
  quality (~6.5 Mbps) whatever the audience. Owncast's own chat isn't used; the site's chat merges YouTube and Rumble.
  Past a few thousand viewers, the site's chat needs MBJ-205.
- **Go Live from Studio or the app:** the site calls the Hetzner API to create the server from a saved snapshot
  (ready in ~2 minutes) and shows Starting… / Ready. OBS keeps one address every time, through a Primary IP or a DNS name.
  The server is **deleted**, not just stopped, 30 minutes after the stream ends, because stopped Hetzner servers are still
  billed. It can also start itself 15 minutes before a scheduled stream (MBJ-813).
- **Safety limits:** one streaming server at most; a daily hour cap (e.g. 8 h), after which it shuts off and alerts
  Ruben; a nightly sweep that deletes a streaming server left running when nobody is live; Studio shows hours and cost
  so far this month. The Hetzner API token (Read & Write) goes on Render as `HETZNER_API_TOKEN` and is never put in chat.
- **Order:** live indicator with a Rumble embed as the free backup player → recorded premieres → this owned live
  feed, sent at the same time as YouTube and Rumble (StreamYard/OBS) → video calls and going live from the app.
- **OBS from Studio (decided 2026-10-01): build option 2 and plan for option 3.**
  - Option 1 comes with it: Studio gives a one-click OBS settings file with the server address, stream key, NVENC/x264,
    CBR 6,000 kbps, 1080p30 and a 2-second keyframe interval, so OBS is set up correctly once.
  - Option 2: control OBS from Studio and the app (start and stop the stream, switch scenes, see dropped frames and
    CPU) through OBS's built-in WebSocket (port 4455, password). On JimBob's PC, Studio talks to OBS directly. From a
    phone or another computer, a small helper on his PC connects out to our server and passes commands along, the same
    pattern as the import helper. No ports are opened at his house.
  - Plan for option 3, a browser studio with no OBS: webcam and screen in the browser, guests by link, sent over
    WebRTC (WHIP). Keep the server side ready for it: the ingest accepts both RTMP (OBS) and WHIP. Owncast takes RTMP,
    so add MediaMTX in front, or swap to it, when option 3 is built. Go Live and the safety limits stay the same
    for both. Option 3 pairs with video calls (model D) and the phone app's go-live (model E).
- **Local test (2026-10-01):** Owncast 0.3.0 in Docker on Ruben's PC (i7-8700), capped at 4 CPUs and 8 GB. OBS sent
  1080p30 at 6,000 kbps CBR (QuickSync, keyframe 1 s, B-frames 0). Owncast made three qualities: 1080p passthrough,
  720p at 2,500 kbps and 360p at 800 kbps.
  - At Owncast's default CPU level, the CPU ran about 70% of 4 cores. At the lowest CPU level (`cpuUsageLevel` 1) it ran
    about 55–60%, the picture still looked great, and memory stayed about 370 MB. So a CPX31 (4 vCPU) fits with some
    headroom; confirm with a 12¢ test on Hetzner's shared vCPUs.
  - Delay: about 15 s with Owncast's defaults; about **4 s** with latency level 0 (1-second segments), a 1-second OBS
    keyframe interval, and a player kept 2 segments behind (hls.js `liveSyncDurationCount: 2`,
    `liveMaxLatencyDurationCount: 4`). These are the settings to ship.
- **Rewind and replay (MBJ-310, built 2026-10-02):** instead of MediaMTX, a small Node recorder (`server/live-recorder`,
  no packages, SigV4 uploads) runs in a `node:22-alpine` container next to Owncast, reading Owncast's local
  `data/hls/<n>/` pieces. It joins them into ~6 s segments and writes `dvr/<id>/<n>/index.m3u8` (EVENT) plus
  `dvr/current.json` to R2. Live viewers stay on Owncast's ~5 s feed; rewinding switches to the recording, which
  keeps playlists small (6 s segments) and leaves live latency alone. End stream closes the playlists (`#EXT-X-ENDLIST`)
  if the recorder hasn't, and the site saves the recording as a video (`videos.hls_url`, `live_recording_id`).
  MediaMTX remains the plan for browser/WebRTC ingest (option 3).
- **Reconnects (2026-10-02):** if OBS drops and comes back within 10 minutes, the recorder keeps adding to the same
  recording with `#EXT-X-DISCONTINUITY` at each join (Owncast's clock and file names restart), so viewers can still rewind
  to the start and it stays one replay. The site sets the video back to live (no length) and updates its length when
  the recording ends again. A stream of 5+ hours is ~3,000 playlist entries (~65 KB), fetched only by rewound viewers.
- **Listening (2026-10-02):** the recorder installs ffmpeg (`apk add` in `node:22-alpine`) and copies the audio of the
  smallest quality's segments (`-copyts -vn -c:a copy`) to `dvr/<id>/audio/`, listed in the master as
  `#EXT-X-MEDIA:TYPE=AUDIO … URI="audio/index.m3u8"` so the site's player finds it for Listen only on replays. /live tracks
  the viewer's spot in recording time (`gapS` subtracts time OBS was away) and switches video ↔ sound from that spot.
  Owncast rewrites its first pieces just after OBS connects; the recorder skips renumbered pieces that arrive with no
  pause in a stream's first 20 seconds, and treats a pause as a reconnect.
- **Isolation (2026-10-02):** recordings live under `DVR_PREFIX` (`dvr` on the live site; testing PCs set e.g.
  `dvr-test`), and the recorder tags `current.json` with its `LIVE_SERVER_ID`; /live and the replay job only use the running
  server's recording. A local test writing `dvr/current.json` once sent live viewers into a test recording. The reconnect
  window is 2 minutes (was 10): separate streams on one server stay separate recordings.
- **Saved image v2 (2026-10-03):** images from before kept the previous Owncast and recorder with `--restart
  unless-stopped`, so for the first seconds of every boot the old Owncast ran with the same stream key and OBS could
  connect to it (default settings, one 480p quality), then the fresh one took over. Containers now use `--restart
  on-failure` (nothing starts at boot), images are labeled `mbj=live-image-v2`, and the site deletes v1 images. The
  recorder starts a new recording if Owncast's qualities change, and only treats a renumbered piece as a rewrite if its
  timestamp falls within the last minute already recorded.

## Update 2026-10-03: 1,000-viewer load test

1,000 simulated viewers on /live for ~10 minutes, all watching video through `live.madebyjimbob.app` (a third at 720p, the rest 360p), with 5 bot accounts (`loadbot_1`–`5`) plus `chat_tester` chatting ~2 messages a second. 1,000/1,000 chat sockets, none dropped; 925 chat messages each reached every connected viewer within ~0.2 s; the bots' 744 posts all went through. Video: ~1.2 Gbps delivered by R2/Cloudflare, ~601,000 one-second pieces, typical piece ~0.25–0.44 s (p95), only 0.1% slower than real time (no buffering). About 7% of piece requests got 404 (a piece listed before it had finished uploading); players retry, but it's worth a look. Status checks (`/api/live`, every viewer every 10 s): 60,317, 1 timeout, but p95 rose from ~0.4 s to ~2.7 s, so `/api/live` now shares one answer for 2 s. Video pieces aren't cached by Cloudflare yet (`DYNAMIC`); a cache rule for `.ts` would take that load off R2. Hetzner's account limits (shared cores, Primary IPs) allowed only 4 load machines next to the stream server.

## Update 2026-10-03: running costs and what grows

Estimates for JimBob's schedule (~5 hours a weekday, ~110 streamed hours a month); confirm against the first month's
bills (Cloudflare → R2 → Metrics shows the operation counts).

| Item | Cost | Grows with |
|---|---|---|
| Streaming server (Hetzner CPX31, $0.118/h, on only while streaming + 30 min) | ~$15/month incl. fixed IP and saved image | streamed hours |
| R2 storage (recordings kept 14 days, ~4.7 GB per streamed hour) | ~$3–4/month | streamed hours |
| R2 writes (Owncast 1-second pieces + playlists, recorder 2-second segments + playlists: ~4–5 million a month; 1 million free, then $4.50/million) | ~$15/month | streamed hours |
| R2 reads while watching live (each viewer reads the playlist every second; pieces come from Cloudflare's cache since 2026-10-03; 10 million a month free, then $0.36/million) | ~$1.30 per 1,000 viewer-hours past the free ~2,800 viewer-hours (~$40/month at 300 viewers per stream) | viewers × hours |
| B2 archive (all three qualities + audio, ~4.7 GB per streamed hour, $6/TB-month) | starts ~$3, then +~$3/month for every month of streaming | streamed hours, forever |

Two changes keep this flat (MBJ-311, MBJ-312):
- **Watching:** video pieces are cached at Cloudflare (a free Cache Rule on `live.madebyjimbob.app`, `.ts` files; on
  since 2026-10-03, `MISS` then `HIT`). Playlists: the recorder re-publishes Owncast's as `dvr/live/<n>.m3u8` with
  `Cache-Control: public, max-age=1`, listing only pieces confirmed in R2 (a HEAD per new piece), and the site points
  live viewers at them once every quality is published (`current.json` `edge`). That also ends the ~7% of piece 404s
  seen in the load test (Owncast lists a piece before its upload finishes), which Cloudflare would otherwise cache.
  Costs ~1.3 million extra R2 writes a month (~$6) and adds ~0.5–1 s of delay; with `m3u8` added to the Cache Rule,
  reads stop growing with viewers: a 5-hour show at 1,000 viewers drops from ~$6.50 to cents.
- **Archive:** keep 1080p only for recent streams (e.g. 30 days) and 720p + 360p + audio after that (~1.6 GB per hour):
  the archive then grows ~$1/month per month instead of ~$3.
