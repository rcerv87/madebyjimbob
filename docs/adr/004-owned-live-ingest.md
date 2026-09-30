# ADR-004: Owned live ingest to R2 as the independence path

- **Status:** Proposed
- **Date:** 2026-09-29

## Context
Platform independence requires a live path that doesn't depend on YouTube or Rumble. Cloudflare Stream live delivery is costly at ~1,000 viewers.

## Decision
Run MediaMTX (or Owncast) on a VPS, transcode to an HLS ladder plus an audio-only rendition with ffmpeg, write segments to Cloudflare R2, and serve through Cloudflare's CDN. YouTube/Rumble become simulcast targets.

## Consequences
Much lower delivery cost and full control; we operate the ingest box. Enables background audio, PiP, and audio-only for live.
