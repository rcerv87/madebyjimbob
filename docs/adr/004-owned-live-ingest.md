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
