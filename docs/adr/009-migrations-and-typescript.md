# ADR-009: Migrations and TypeScript

- **Status:** Migrations accepted and done (MBJ-003); TypeScript still proposed
- **Date:** 2026-09-29

## Context
The POC runs `schema.sql` on boot and is plain JavaScript. Mobile will share types with server and web.

## Decision
Adopt `node-pg-migrate` for schema changes (baseline = current schema). Move server, web, and a new `packages/shared` to TypeScript before Phase 2 starts.

## Consequences
Safer schema evolution and shared contracts across three clients. One-time conversion cost.
