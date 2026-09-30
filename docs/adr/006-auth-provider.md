# ADR-006: Self-hosted authentication

- **Status:** Accepted (2026-09-30, MBJ-101)
- **Date:** 2026-09-29

## Context
The platform's purpose is independence. A hosted auth vendor can suspend an account and take the user list with it.

## Decision
Use a self-hosted auth library backed by our Postgres (recommended: Better Auth) with email + password, magic link, Google (also enables YouTube linking), and Apple sign-in.

## Consequences
User records stay in our database. We own session security and must keep the library patched.

## Implementation (2026-09-30)

- Better Auth 1.7 with its Kysely adapter on our `pg` pool, mapped onto snake_case tables (`users`, `sessions`,
  `accounts`, `verifications`) with serial ids, so every existing foreign key to `users.id` keeps working.
- Email + password with the username plugin (username chosen at sign-up, sign in by username or email), the
  bearer plugin (apps and tests), and the Have I Been Pwned plugin (refuses breached passwords).
- Sessions last 90 days and renew daily while used; httpOnly `mbj.session_token` cookie, `Secure` on https.
- Admins are verified emails in `ADMIN_EMAILS` (a username could be claimed by anyone); reserved names
  (jimbob, admin, mod, …) can only be taken by those emails.
- Rate limits in memory (one server); move to Redis with MBJ-205.
- Google and Apple sign-in, magic links, and passkeys are the same library's plugins, added in MBJ-110.
