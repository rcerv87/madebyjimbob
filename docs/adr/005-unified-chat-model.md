# ADR-005: One chat table for all sources, keyed by offset_ms

- **Status:** Accepted
- **Date:** 2026-09-29

## Context
Chat comes from YouTube, Rumble, and native users, both live and replayed.

## Decision
Store all messages in `chat_messages` with a `source` enum, `UNIQUE(source, external_id)` for idempotent ingest, and `offset_ms` as the position in the video.

## Consequences
One query path for replay, analytics, and moderation. New sources are an enum value, not a new table.
