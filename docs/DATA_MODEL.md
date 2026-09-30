# Data model

Postgres is the system of record. Current tables exist in `server/db/schema.sql`; planned tables and
columns are added by the story noted.

## Current

### users
| column | type | notes |
|---|---|---|
| id | bigserial PK | |
| username | text unique | 3–32 chars `[A-Za-z0-9_]` |
| tier | text | `free | plus | premium` — derived from entitlements after MBJ-104 |
| youtube_channel_id | text | set when user links YouTube (MBJ-305) |
| xp | int | |
| session_token | text unique | MVP only; replaced by auth provider (MBJ-101) |
| password_hash | text | MVP only, `scrypt$salt$hash`; replaced by auth provider (MBJ-101) |
| created_at | timestamptz | |

### videos
| column | type | notes |
|---|---|---|
| id | bigserial PK | |
| youtube_id | text unique | |
| stream_uid | text | Cloudflare Stream video id |
| title, description | text | |
| duration_s | int | |
| published_at | timestamptz | |
| min_tier | text | access level |
| views | int | |
| created_at | timestamptz | |

### chat_messages
| column | type | notes |
|---|---|---|
| id | bigserial PK | |
| video_id | FK videos | cascade delete |
| source | text | `youtube | rumble | native` |
| external_id | text | platform message id; `UNIQUE(source, external_id)` |
| user_id | FK users | native posts and linked YouTube posts |
| author_name, author_channel_id, author_photo | text | |
| kind | text | `text | paid | membership` |
| body | text | |
| amount_text | text | display amount for paid |
| mentions | text[] | GIN index |
| offset_ms | int | position in video; index `(video_id, offset_ms)` |
| sent_at | timestamptz | original send time |
| hidden | boolean | moderation; never hard-delete |
| created_at | timestamptz | |

## Planned

| Change | Story |
|---|---|
| `videos.status` (`processing | live | archived | ready`), `videos.source` (`stream | youtube | owned`), `videos.live_started_at`, `videos.offset_adjust_ms` | MBJ-301 |
| `entitlements (user_id, tier, provider, provider_ref, expires_at)` | MBJ-104 |
| `auth_*` tables from auth provider; drop `users.session_token` | MBJ-101 |
| `users.role` (`viewer | mod | admin`) | MBJ-102 |
| `chat_votes (message_id, user_id, created_at)` | MBJ-203 |
| `chat_messages.amount_cents, currency, pinned_until` | MBJ-207 |
| `mod_actions (id, actor_id, target_user_id, target_author_channel_id, message_id, action, duration_s, reason, created_at)` | MBJ-204 |
| `room_settings (video_id, mode, slow_mode_s)` | MBJ-204 |
| `banned_terms (term)` | MBJ-206 |
| `notifications (id, user_id, type, message_id, read_at)` | MBJ-202 |
| `ingest_cursors (video_id, source, page_token, updated_at)` | MBJ-302 |
| `api_quota_usage (day, api, units)` | MBJ-305 |
| `watch_sessions (user_id, video_id, seconds, mode)` for XP and analytics | MBJ-601 |
| `xp_events (user_id, kind, amount, ref_id, created_at)`, `badges`, `user_badges` | MBJ-602 |
| `transcripts (video_id, vtt, text)`, `recaps (video_id, summary_md, chapters_json)` | MBJ-604 |
