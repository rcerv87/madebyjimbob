# API

Base path `/api`. JSON in and out. Errors: `{ "error": "Human-readable message." }` with a 4xx/5xx status.
Auth: `Authorization: Bearer <token>` (POC session token; replaced in MBJ-101).

## Current

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/session` | — | POC sign-in `{ username, tier }` → `{ token, user }` |
| GET | `/me` | optional | `{ user | null }` |
| GET | `/videos` | — | List video cards |
| GET | `/videos/:id` | optional | Video detail; `hls` only if tier allows, else `locked: true` |
| POST | `/videos/:id/view` | — | Increment views |
| GET | `/videos/:id/chat?from=&to=` | — | Chat window by `offset_ms` (max 3,000) |
| POST | `/videos/:id/chat` | required | `{ text, offsetMs }` → `{ message }`; broadcast to room |
| GET | `/studio/overview` | none yet (MBJ-102) | Totals, per-video stats, top chatters |
| PATCH | `/studio/videos/:id` | none yet (MBJ-102) | `{ minTier }` |
| GET | `/health` | — | Liveness |

### Chat message shape
```json
{
  "id": "123", "source": "youtube", "kind": "paid",
  "author": "@BigSue", "authorPhoto": "https://…",
  "body": "Love the show @jimbob", "amount": "$20.00",
  "mentions": ["jimbob"], "offsetMs": 12000
}
```

## WebSocket

Endpoint `/ws`.

Client → server:
| type | payload |
|---|---|
| `join` | `{ videoId }` — leave previous room, join this one |

Server → client:
| type | payload |
|---|---|
| `chat` | `{ message }` |
| `vote` (MBJ-203) | `{ messageId, votes }` |
| `hide` (MBJ-204) | `{ messageId }` |
| `pin` (MBJ-207) | `{ message, until }` |
| `room` (MBJ-204) | `{ mode, slowModeS }` |
| `live` (MBJ-301) | `{ status }` |

## Planned endpoints

| Method | Path | Story |
|---|---|---|
| POST | `/billing/checkout` | MBJ-104 |
| POST | `/webhooks/stripe`, `/webhooks/revenuecat` | MBJ-104 |
| POST | `/videos/:id/chat/:messageId/vote` | MBJ-203 |
| POST | `/mod/messages/:id/hide`, `/mod/users/:id/timeout`, `/mod/users/:id/ban` | MBJ-204 |
| PATCH | `/mod/videos/:id/room` | MBJ-204 |
| POST | `/videos/:id/tips` | MBJ-207 |
| GET | `/notifications` | MBJ-202 |
| GET | `/live/current` | MBJ-301 |
| POST | `/account/youtube/link` | MBJ-305 |
| GET | `/podcast/:feedToken.xml` | MBJ-503 |
