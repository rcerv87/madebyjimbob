# ADR-006: Self-hosted authentication

- **Status:** Proposed
- **Date:** 2026-09-29

## Context
The platform's purpose is independence. A hosted auth vendor can suspend an account and take the user list with it.

## Decision
Use a self-hosted auth library backed by our Postgres (recommended: Better Auth) with email + password, magic link, Google (also enables YouTube linking), and Apple sign-in.

## Consequences
User records stay in our database. We own session security and must keep the library patched.
