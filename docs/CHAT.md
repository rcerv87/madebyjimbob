# Chat system

Chat is the product's center of gravity. This doc covers how messages get in, how they are stored,
how they are delivered, and how they are moderated.

## Sources

| Source | Stored video | Live | Can we post to it? |
|---|---|---|---|
| **native** | Posted at viewer's playhead | Posted in real time | Yes (our own) |
| **youtube** | Imported from chat replay (yt-dlp) | Polled via `liveChatMessages.list` | Yes, for users who linked YouTube (quota-bound) |
| **rumble** | — | Polled via Rumble Live Stream API | No (API is read-only) |

## The sync key: `offset_ms`

Every message stores its position in the video in milliseconds.

- **YouTube replay import:** `replayChatItemAction.videoOffsetTimeMsec` (clamped to ≥ 0).
- **YouTube live:** `publishedAt − broadcast.actualStartTime`.
- **Native:** client's current playback time when posting (live: server time − stream start).

If the archived VOD is trimmed relative to the live broadcast, store the trim as `videos.offset_adjust_ms` and apply it at read time rather than rewriting messages.

## Delivery

- REST: `GET /api/videos/:id/chat?from&to` returns a window (max 3,000 rows), ordered by `offset_ms, id`.
- WebSocket: clients `join` a video room; server pushes `chat`, and later `vote`, `delete`, `pin` events.
- Stored video: client loads the current and next 2-minute windows, renders messages with `offset_ms ≤ playhead`, keeps the last 150 in the DOM.
- Live: client renders everything it receives; on reconnect it fetches messages since the last seen `id`.

## Ingest worker (Phase 3)

- One process per active live video. Never poll per client.
- Respects `pollingIntervalMillis` from YouTube.
- Idempotent inserts via `UNIQUE (source, external_id)`.
- Publishes new rows to the API (Redis pub/sub once multi-instance; direct internal call before that).
- Persists its `nextPageToken` so a restart doesn't replay or skip messages.

## Posting to YouTube (Phase 3)

- User links YouTube via Google OAuth (`youtube.force-ssl` scope). Requires Google OAuth app verification — start early.
- Server calls `liveChatMessages.insert` with the user's token. The message also returns through ingest; de-dupe by YouTube message ID and link it to the native user.
- Quota: each insert is expensive relative to the default daily quota. Track usage in `api_quota_usage`, fall back to native-only posting when the budget is exhausted, and request a quota increase (MBJ-306).

## Moderation

Layers, applied in order on native posts:
1. Rate limit (per user, per tier; slow mode overrides).
2. Room mode: `open | slow | members_only | emote_only`.
3. Banned-word masking (`BANNED_WORDS` → later a `banned_terms` table editable in Studio).
4. Automated classifier for spam/toxicity (hold for review above threshold).

Mod actions: hide message, timeout user (N minutes), ban user. For YouTube-sourced authors, the same actions call `liveChatMessages.delete` / `liveChatBans.insert` with JimBob's OAuth token. All actions are logged in `mod_actions`.

Hidden messages are never deleted from the database — `hidden = true` keeps the archive complete for analytics.

## Tipped messages

- YouTube Super Chats (`superChatEvent` / `liveChatPaidMessageRenderer`) and Rumble Rants arrive as `kind = 'paid'` with `amount_text`.
- Native tips: Stripe PaymentIntent on web, consumable IAP via RevenueCat on mobile. Webhook confirms payment, then the message is inserted as `kind = 'paid'` with `amount_cents` and `currency`, and pinned for a duration scaled by amount.

## @mentions

Parsed on insert into `mentions TEXT[]` (lowercased, GIN-indexed). Native users whose username is mentioned get an in-app notification; push notification on mobile.

## Upvotes

`chat_votes (message_id, user_id)` unique pair. Live counts in memory/Redis, persisted to Postgres. Studio shows a "Top questions" list: messages containing `?` ordered by votes.
