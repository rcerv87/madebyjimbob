# ADR-002: Cloudflare Stream for stored video

- **Status:** Accepted
- **Date:** 2026-09-29

## Context
Need upload, transcoding, HLS delivery, thumbnails, captions, and signed URLs without running video infrastructure.

## Decision
Use Cloudflare Stream for VOD. The app stores only the Stream UID; the player receives an HLS URL.

## Consequences
Per-minute stored and delivered pricing. Acceptable for VOD; live delivery at scale moves to owned ingest + R2 (ADR-004). The player only depends on an HLS URL, so the source can change without client changes.
