# ADR-001: Render hosts the application

- **Status:** Accepted
- **Date:** 2026-09-29

## Context
Need managed hosting for a Node API, WebSockets, a background worker, Postgres, and later Redis, with low ops burden.

## Decision
Use Render: one web service (API + WS + web build), Postgres, and later a background worker and Key Value (Redis). Infrastructure is declared in `render.yaml`.

## Consequences
Simple deploys from Git. CPU-heavy work (video transcoding for owned live) should run elsewhere (e.g. a dedicated VPS) because Render CPU is expensive for encoding.
