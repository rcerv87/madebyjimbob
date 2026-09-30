# API

Base path `/api`. JSON in and out. Errors: `{ "error": "Human-readable message." }` with a 4xx/5xx status. Every response has an `X-Request-Id` header (a safe incoming one is reused); 500 errors quote it so reports can be matched to logs. Malformed JSON bodies are 400, bodies over 50 KB are 413.
Auth: `Authorization: Bearer <token>` (MVP session token from `/session`; replaced in MBJ-101).
Admins are the usernames in `ADMIN_USERNAMES`; they get `isAdmin: true` and see every tier.

## Current

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/config` | — | `{ allowTestTiers }` |
| POST | `/session` | — | Sign in or sign up `{ username, password, tier? }` → `{ token, user }`. Existing names need their password (case-insensitive name match). `tier` only honored when `ALLOW_TEST_TIERS=true`. 10 wrong passwords lock the name for 15 min |
| DELETE | `/session` | optional | Sign out; invalidates the token |
| GET | `/me` | optional | `{ user | null }`; user is `{ id, username, tier, xp, isAdmin }` |
| GET | `/videos?kind=&members=&q=&sort=` | optional | Dashboard: `kind` = `video\|short\|live`, `members=1` for paid-tier only, `q` searches titles and descriptions, `sort` = `new\|old\|views`. Returns `{ videos, counts: { all, video, short, live, members } }` (counts follow `q`). Cards include `kind` and, when signed in, `progressMs` |
| GET | `/playlists` | — | Playlists with at least one video on the site: `{ id, title, description, source, videoCount, durationS, thumbnail, firstVideoId }` |
| GET | `/playlists/:id` | optional | `{ playlist, videos }` in playlist order (only videos on the site) |
| GET | `/videos/:id` | optional | Video detail; `hls` only if tier allows, else `locked: true` |
| POST | `/videos/:id/view` | — | Increment views |
| GET | `/videos/:id/chat?from=&to=` | optional | Chat window by `offset_ms` (max 3,000). 403 if the viewer's tier can't watch the video |
| GET | `/videos/:id/comments/:commentId` | optional | The whole thread containing that comment: `{ comment }` with `replies` |
| POST | `/videos/:id/vote` | required | `{ value: 1 \| -1 \| 0 }` (0 clears) → `{ likes, myVote }`; tier-gated. Video detail includes `likes` and `myVote`; dislikes only appear in `/studio/overview` |
| PUT | `/videos/:id/progress` | required | `{ positionMs }`: save where the viewer is (resume on any device) |
| GET | `/videos/:id/chat?afterId=` | optional | Messages with `id > afterId`, ordered by id (max 3,000). Used to catch up after a WebSocket reconnect |
| POST | `/videos/:id/chat` | required | `{ text, offsetMs, replyToId? }` → `{ message }`; broadcast to room. Native posts are replay chat (`postedLive: false`) until live native chat exists. 403 below the video's tier; `offsetMs` clamped to the video's length |
| GET | `/videos/:id/comments?sort=top\|new&offset=` | optional | `{ total, comments, nextOffset }`: 20 top-level comments per page (top = pinned, then likes), each with all its `replies`. 403 below the video's tier |
| POST | `/videos/:id/comments` | required | `{ text, offsetMs?, replyToId? }` → `{ comment }`. `replyToId` can be any comment on the video; the reply joins its thread and quotes it. `offsetMs` puts the comment in the chat feed at that moment (broadcast as `comment`). Up to 2,000 chars, line breaks kept, banned words masked, one per 5s |
| GET | `/notifications` | required | `{ unread, notifications }`: latest 30 mentions/replies, each `{ id, type: mention\|reply, where: chat\|comment, videoId, videoTitle, actor, excerpt, offsetMs, commentId, read, createdAt }` |
| POST | `/notifications/read` | required | `{ ids? }`: mark those read, or all when omitted |
| GET | `/push/key` | — | `{ publicKey }` (null when push isn't configured) |
| POST | `/push/subscribe` | required | `{ subscription }` from `PushManager.subscribe()`; 503 when push isn't configured |
| DELETE | `/push/subscribe` | required | `{ endpoint }` |
| GET | `/studio/overview` | admin | Totals, per-video stats, top chatters (hidden messages excluded) |
| PATCH | `/studio/videos/:id` | admin | `{ minTier }` |
| GET | `/studio/playlists` | admin | All playlists with their videos (including empty ones) |
| POST | `/studio/playlists` | admin | `{ title, description? }` → `{ playlist }` (source `native`) |
| PATCH | `/studio/playlists/:id` | admin | `{ title?, description? }`; 409 for YouTube playlists |
| DELETE | `/studio/playlists/:id` | admin | Native playlists only |
| PUT | `/studio/playlists/:id/items` | admin | `{ videoIds }` replaces the playlist's videos in that order |
| GET | `/health` | — | Liveness |

### Comment shape
```json
{
  "id": "88", "parentId": null, "source": "youtube", "author": "@MadebyJimbob",
  "authorPhoto": "https://…", "isCreator": true, "body": "Thanks!
See you Friday",
  "likes": 104, "pinned": false, "postedAt": "2026-09-01T20:00:00Z", "replies": []
}
```

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
| `auth` | `{ token }` — receive this user's notifications on this socket |
| `join` | `{ videoId, token? }` — leave previous room, join this one. Refused with `error` if the token's tier can't watch the video |

Server → client:
| type | payload |
|---|---|
| `chat` | `{ message }` |
| `error` | `{ error }` — join refused |
| `comment` | `{ comment }` — a new timestamped comment, shown in the chat feed |
| `notify` | `{ notification }` — to the recipient's authed sockets: someone mentioned or replied to them |
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
| GET | `/live/current` | MBJ-301 |
| POST | `/account/youtube/link` | MBJ-305 |
| GET | `/podcast/:feedToken.xml` | MBJ-503 |
