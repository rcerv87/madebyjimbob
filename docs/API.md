# API

Base path `/api`. JSON in and out. Errors: `{ "error": "Human-readable message." }` with a 4xx/5xx status. Every response has an `X-Request-Id` header (a safe incoming one is reused); 500 errors quote it so reports can be matched to logs. Malformed JSON bodies are 400, bodies over 50 KB are 413.
Auth (MBJ-101): Better Auth under `/auth/*`. The web app uses the `mbj.session_token` httpOnly cookie; apps and tests can send
`Authorization: Bearer <token>` with the token from the `set-auth-token` response header of sign-up/sign-in. State-changing
auth requests need an `Origin` header (browsers send it). Admins are users with `role = 'admin'` (set with `npm run set-role`) or whose **verified** email is in `ADMIN_EMAILS`;
they get `isAdmin: true` and see every tier.

## Current

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/sign-up/email` | — | `{ email, username, name, password, callbackURL? }`. Username 3–32 `[A-Za-z0-9_]`, unique ignoring case, not reserved or rude; password 10–128 chars and not in a known breach. Signs in and emails a verification link (to `callbackURL`, e.g. `/?verified=1`). Errors are `{ code, message }`: `USERNAME_IS_ALREADY_TAKEN`, `USER_ALREADY_EXISTS`, `USERNAME_RESERVED`, `INVALID_USERNAME`, `PASSWORD_TOO_SHORT`, `PASSWORD_COMPROMISED`, … |
| POST | `/auth/sign-in/username` | — | `{ username, password }` (any case). 401 `INVALID_USERNAME_OR_PASSWORD` |
| POST | `/auth/sign-in/email` | — | `{ email, password }`. 401 `INVALID_EMAIL_OR_PASSWORD` |
| POST | `/auth/sign-out` | session | Ends this session |
| GET | `/auth/verify-email?token=&callbackURL=` | — | The emailed link: marks the email verified, signs in, redirects to `callbackURL` |
| POST | `/auth/send-verification-email` | — | `{ email, callbackURL? }` resends the link |
| POST | `/auth/request-password-reset` | — | `{ email, redirectTo: '/reset-password' }`; always 200 (never reveals whether the email has an account). The emailed link redirects to `/reset-password?token=` (or `?error=INVALID_TOKEN`) |
| POST | `/auth/reset-password` | — | `{ newPassword, token }`; one use, 1 hour; signs out every other session |
| POST | `/auth/change-email` | session | `{ newEmail, callbackURL? }`, only for accounts without a confirmed email (they change right away and get a verification link); confirmed accounts get 403 `USE_ACCOUNT_SETTINGS` and use `/account/email` |
| POST | `/auth/change-password` | session | `{ currentPassword, newPassword, revokeOtherSessions: true }`; logged in the security history. 400 `INVALID_PASSWORD` |
| GET | `/auth/list-sessions` | session | This member's signed-in devices `[{ id, token, userAgent, ipAddress, createdAt, … }]` |
| POST | `/auth/revoke-session`, `/auth/revoke-other-sessions` | session | `{ token }` signs out one device; the other signs out every device but this one |
| GET | `/account/notifications` | session | `{ prefs: { mention: { site, push }, reply: { site, push } } }` (all on until turned off) |
| PUT | `/account/notifications` | session | `{ prefs }` with any subset of those booleans → the full `{ prefs }`. With `site` off the notification skips the bell (push still works); with both off none is made |
| GET | `/account/security` | session | `{ events }`: last 20 `{ id, type, ip, userAgent, detail, createdAt }`; types `account_created`, `signed_in`, `password_changed`, `password_reset`, `email_change_requested`, `email_changed`, `email_change_undone` |
| POST | `/account/email` | session | `{ newEmail, password }` → `{ ok, sentTo }`. Emails a 24-hour confirmation link to the new address (none if it already has an account; same answer). 400 wrong password, 429 over 5 an hour |
| GET | `/account/email/confirm?token=` | — | The link in that email: switches the email (confirmed), emails the old address a 7-day undo link, redirects to `/account?email=changed` (or `expired` / `taken`) |
| GET | `/account/email/undo?token=` | — | "This wasn't me": restores the old email, signs out every device, emails a password-reset link, redirects to `/?email=restored` (or `undo-expired`) |
| GET | `/account/links` | session | `{ youtube, rumble }`, each null or `{ id, status: pending\|verified, handle, verifiedBy, verifiedAt }` (MBJ-215) |
| POST | `/account/links/:platform` | session | `youtube` or `rumble`, `{ name }` (a YouTube @handle or channel link, or a Rumble name) → pending until a moderator confirms in Studio. For YouTube the channel id is looked up from imported chat and comments by handle. 400 bad name, 409 linked to another member |
| DELETE | `/account/links/:platform` | session | Unlink, or cancel a request |
| GET | `/account/export` | session | Download my data: a JSON attachment (profile, comments, chat messages, likes, watch progress, notifications, devices, security history, emails sent, payments) with no password hashes or session tokens. 5 an hour |
| POST | `/account/delete` | session | `{ password, deleteContent? }` → `{ ok, eraseOn }`. Signs out every device, emails the date; the account is erased 30 days later unless they sign in (which cancels it). `deleteContent: true` blanks and hides their chat and comments instead of keeping them as "Deleted user". 400 wrong password |
| GET | `/me` | optional | `{ user | null }`; user is `{ id, username, displayName, tier, xp, isAdmin, email (null if none yet), emailVerified, confirmEmail, deletionCancelled }` (`confirmEmail`: unverified and the server can send email; `deletionCancelled`: signing in called off a pending deletion in the last 10 minutes) |
| — | other `/auth/*` | | Better Auth's standard endpoints (`get-session`, `list-sessions`, `revoke-session`, `change-password`, `is-username-available`, …); rate-limited per IP (sign-in 10/min, sign-up 5 per 10 min, reset and verification emails 3 per 10 min) |
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
| DELETE | `/studio/videos/:id` | admin | `{ removeFromStream? }` (default true). Deletes the video and its chat, comments, likes, progress, and notifications; keeps its spots in imported YouTube playlists (unlinked). Returns `{ ok, streamUid, stream: { deleted, reason } }`; `reason` is `not-configured` (no Cloudflare keys on the server), `shared` (another video uses the file), or a Cloudflare error |
| POST | `/studio/videos/:id/replacement` | admin | `{ size, name }` → `{ uploadUrl, uid }`: a one-time Cloudflare tus URL the browser uploads the new file to directly (pieces of 50 MB). 503 without Cloudflare keys |
| GET | `/studio/videos/:id/replacement` | admin | `{ state: none \| queued \| inprogress \| error \| swapped, pct? }`. Once Cloudflare has processed the file it's swapped in (chat and comments kept, length updated) and the old file deleted |
| DELETE | `/studio/videos/:id/replacement` | admin | Cancels a replacement and deletes the uploaded file |
| GET | `/studio/imports` | admin | `{ jobs, helper }`: the last 100 imports `{ id, url, youtubeId, tier, status: queued\|running\|done\|failed\|cancelled, step, title, error, videoId, … }` and the import helper `{ name, lastSeen, online }` |
| POST | `/studio/imports` | admin | `{ urls (one per line, or an array), tier, withComments }` → `{ queued, skipped: [{ url, reason }] }`; skips bad links, ones already queued, and videos already on the site (reason "You already have this", with its `videoId`). The helper on Ruben's PC (`npm run import:worker`) does the work |
| GET | `/studio/channel?url=&show=new\|all&kind=all\|video\|live\|short&q=&offset=&limit=` | admin | From the channel (MBJ-706): `{ channel, listing, apiKey, counts: { all, onsite, queued, new }, total, offset, videos: [{ youtubeId, title, kind, publishedAt, durationS, availability, thumbnail, state: onsite\|queued\|new, videoId }], helper }`. `url` defaults to JimBob's channel; `show=new` (default) leaves out what's on the site or queued; 100 per page (max 500) |
| POST | `/studio/channel/refresh` | admin | `{ url? }` → `{ listing }`: a fresh list, made right away with `YOUTUBE_API_KEY`, otherwise by the import helper (`status: queued` until it does). One request per channel at a time |
| POST | `/studio/imports/:id/retry` | admin | Puts a failed or cancelled import back in the queue |
| DELETE | `/studio/imports/:id` | admin | Cancels a queued import or clears a finished one (409 while it's running) |
| GET | `/studio/playlists` | admin | All playlists with their videos (including empty ones) |
| POST | `/studio/playlists` | admin | `{ title, description? }` → `{ playlist }` (source `native`) |
| PATCH | `/studio/playlists/:id` | admin | `{ title?, description? }`; 409 for YouTube playlists |
| DELETE | `/studio/playlists/:id` | admin | Native playlists only |
| PUT | `/studio/playlists/:id/items` | admin | `{ videoIds }` replaces the playlist's videos in that order |
| GET | `/studio/links` | admin | `{ links }`: requests waiting first (YouTube ones with `messagesSeen`, how much that handle has posted), then every confirmed link, with the member's `username` |
| POST | `/studio/links/:id/approve` | admin | Confirms a request (409 if that account is linked to another member) |
| DELETE | `/studio/links/:id` | admin | Turns down or unlinks |
| GET | `/studio/email` | admin | `{ enabled, from, templates: [{ id, label }], suppressed, recent }`; `recent` is the last 20 sends `{ id, to (masked), template, status, error, createdAt }` |
| GET | `/studio/email/preview/:template` | admin | `{ subject, html, text }` rendered with sample data |
| POST | `/studio/email/test` | admin | `{ to, template }` → `{ status: sent \| off \| suppressed \| failed }`: sends that template with sample data |
| POST | `/webhooks/resend` | Resend signature | Bounce and spam-complaint events (Svix-signed: `svix-id`, `svix-timestamp`, `svix-signature`, checked against `RESEND_WEBHOOK_SECRET`, 5-minute window). Permanent bounces and complaints add the address to `email_suppressions`. 401 on a bad signature |
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

Chat messages and comments from a linked YouTube/Rumble account also carry `platformName` (the name there) and
`memberTier`, and `author` is the member's site username (MBJ-215).

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
| POST | `/auth/sign-in/social`, `/auth/sign-in/magic-link`, passkeys | MBJ-110 |
| GET | `/podcast/:feedToken.xml` | MBJ-503 |
