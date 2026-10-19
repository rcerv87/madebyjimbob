# ADR-015: Jortlandia runs inside the platform as a server-side command game

- **Status:** Proposed
- **Date:** 2026-10-18

## Context

Ruben's game design (`docs/JORTLANDIA.md`, 2026-10-15) adds Jortlandia: a persistent, text-based strategy game where
a member's tier is their social class, watching JimBob's streams earns Jort Coin and XP, and treasure hides in the
streams themselves. It ties into nearly every part of the platform: accounts and tiers, watch time, live and replay
chat, the watch page, Studio, notifications and the phone apps. Much of it is hidden information (criminal status,
capstones, duel boards, buried treasure), and it has an economy that players will try to exploit.

## Decision

- **Inside the existing server, database and WebSocket**, not a separate service. Code lives in `server/src/game/`,
  tables are named `game_*`, and the screen is `/jortlandia` in the web app, so the website and both apps get it from
  one build (ADR-014). The page path goes in `server/src/pages.js`.
- **Every act is a command run on the server.** `POST /api/game/command` takes the command text and returns a
  screen: lines of text plus the next menu. Menus are numbered, BBS style; tapping an item sends the same command a
  player could type, so phones never need typing. Structured reads (the map, stat cards, the ticker) get their own
  `GET` endpoints. The server judges every result; chat never changes game state.
- **Server-only secrets.** Hidden state (criminal level, heat, capstones, battleship boards, buried treasure, hidden
  land traits) is never sent to a client that isn't allowed to see it. Randomness comes from the server
  (`crypto.randomInt`), never the browser.
- **Jort Coin is an append-only ledger.** Every movement is a `game_ledger` row (from, to, amount, reason, reference).
  Each player's balance is kept in a column updated in the same transaction (the pattern of chat counts: kept, never
  counted per request), and a nightly job compares balances with the ledger and logs any difference. Coin is never
  bought with money or cashed out (`docs/JORTLANDIA.md` rule 1).
- **A world tick** runs every 5 minutes in the server process, like the hourly account-deletion job, guarded by
  `pg_try_advisory_lock` so a second server copy (MBJ-205) never runs it twice. It pays wages, renews resources, ends
  deaths and jail terms, spreads plagues and runs seasons. Timers are stored as timestamps (`dead_until`,
  `cooldown_until`), so a late or missed tick never loses or doubles time.
- **One event log.** Everything that happens is a `game_events` row (kind, actors, place, public or private, text).
  The ticker, stat-card histories and lifetime records read from it; public events go out over the WebSocket.
- **Land:** all 100,000 lots are rows, made once from a seed. Parcels are rows only once something happens on them
  (owned, rented, built on, dug); a parcel with no row has its starting state, worked out from the seed.
- **Jortlandia chat** gets its own table keyed by room (Tavern, Market, kingdoms, fiefdoms, private group rooms),
  because `chat_messages` belongs to videos and needs `offset_ms`. It uses the same moderation: blocks, banned-word
  masking, reports, `refusedForTimeout()`, bans.
- **Game data is personal data:** `game_*` tables that reference `users` use `ON DELETE CASCADE`, or `SET NULL` where
  the world must keep the thing (land becomes abandoned, history shows "Deleted user"). Game data goes in
  `exportData()`, and the privacy policy and terms gain a Jortlandia section.

## Consequences

- No new service or monthly cost at beta scale; the game shares the web service's CPU and Postgres. If the tick or
  command load ever slows the site, the tick moves to a Render background worker with the same lock.
- Members, tiers, bans, timeouts and blocks apply in the game with no second copy of the rules.
- The command engine is plain JavaScript and testable with `node:test` like the rest of the server: each command gets
  tests for its result, its permissions and its hidden-information rules.
- The game's numbers (wages, prices, skill costs, race bonuses, job minimums) are Studio settings, not constants, so
  balancing doesn't need a release.
- A game bug can't corrupt the rest of the platform's data (separate tables), but it shares the deploy: a broken
  release breaks both.

## Alternatives considered

- **A separate game server** (its own service and database): isolates load but duplicates accounts, tiers and
  moderation, and adds a second Render service (~$7–25/month). Not needed until the game outgrows the web service.
- **A hosted game backend** (Nakama, PlayFab and the like): built for real-time action games, not a slow persistent
  economy, and it would put member data in another provider the PRD asks to avoid.
- **Game logic in the browser:** cheaper on the server, but hidden information and the economy can't be trusted to
  the client.
