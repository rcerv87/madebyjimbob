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
