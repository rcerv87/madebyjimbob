# ADR-003: Live streaming via YouTube first, not from the app

- **Status:** Accepted
- **Date:** 2026-09-29

## Context
JimBob already streams to YouTube. Building in-app broadcasting adds cost and complexity without clear benefit.

## Decision
JimBob keeps streaming from OBS to YouTube. The platform embeds the YouTube live player, ingests YouTube live chat via the Data API, and merges it with native chat. Streams are archived to Cloudflare Stream after they end.

## Consequences
Fast path to live. Embedded YouTube can't provide background audio or PiP, and a YouTube ban would interrupt live until owned ingest (ADR-004) is in place. Keep the live source configurable per video.
