# Data model

Postgres is the system of record. Current tables are defined by the migrations in `server/migrations/` (baseline: `1790726400000_baseline.sql`); planned tables and
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
| kind | text | `video \| short \| live`; set on import (was live → live; vertical and ≤ 3 min → short) |
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
| posted_live | boolean | sent during the live stream (YouTube imports, live native) vs. posted while watching later |
| reply_to_id | FK chat_messages | the exact message answered; shown as a quote |
| created_at | timestamptz | |

### comments
| column | type | notes |
|---|---|---|
| id | bigserial PK | |
| video_id | FK videos | cascade delete |
| source | text | `youtube \| rumble \| native` |
| external_id | text | platform comment id; `UNIQUE(source, external_id)` |
| parent_id | FK comments | null for top-level; replies are one level deep (YouTube reply-to-reply is attached to the thread) |
| user_id | FK users | native comments |
| author_name, author_channel_id, author_photo | text | |
| author_is_creator | boolean | YouTube `author_is_uploader` |
| body | text | line breaks kept |
| like_count | int | YouTube likes (refreshed on re-import) |
| pinned | boolean | |
| posted_at | timestamptz | |
| hidden | boolean | moderation; never hard-delete |
| offset_ms | int | optional moment in the video; timestamped comments appear in the chat feed. YouTube imports take the first time typed in the comment |
| reply_to_id | FK comments | the exact comment answered (thread start or another reply); shown as a quote |

### watch_progress
| column | type | notes |
|---|---|---|
| user_id, video_id | PK | |
| position_ms | int | where the viewer stopped; resume if past 10s and not in the last 30s |
| updated_at | timestamptz | |

Signed-out viewers keep their position in the browser (`localStorage`).

### playlists
| column | type | notes |
|---|---|---|
| id | bigserial PK | |
| source | text | `youtube` (imported, read-only in Studio) or `native` (made in Studio) |
| youtube_id | text unique | YouTube playlist id |
| title, description | text | |

### playlist_items
| column | type | notes |
|---|---|---|
| playlist_id, position | PK | order within the playlist |
| youtube_id | text | imported items; matched to `videos.youtube_id`, so videos imported later appear automatically |
| video_id | FK videos | items added in Studio |

### notifications
| column | type | notes |
|---|---|---|
| id | bigserial PK | |
| user_id | FK users | recipient |
| type | text | `mention \| reply` (a reply that also mentions you is one `reply`) |
| video_id | FK videos | |
| chat_message_id / comment_id | FK | exactly the message or comment that triggered it |
| actor_id, actor_name | | who did it |
| excerpt | text | first 140 chars |
| offset_ms | int | moment in the video, for "jump to it" |
| read_at | timestamptz | null = unread |

### push_subscriptions
| column | type | notes |
|---|---|---|
| user_id | FK users | |
| endpoint | text unique | from the browser's push service; deleted when it returns 404/410 |
| p256dh, auth | text | encryption keys from the subscription |

Comments are separate from `chat_messages`: they aren't tied to a playback position and they thread.

### transcripts
| column | type | notes |
|---|---|---|
| video_id | FK videos | cascade delete; PK with language + source |
| language | text | e.g. `en` |
| source | text | `cloudflare \| whisper \| manual` |
| label | text | e.g. "English (auto-generated)" |
| vtt | text | the original caption file (WebVTT), so captions survive a move off Stream |
| text | text | plain transcript: duplicates dropped, paragraphs at 4s+ pauses |
| cue_count | int | |
| fetched_at | timestamptz | |

Filled by `npm run captions:fetch`. Auto captions can invent text during silence or music; keep the original and regenerate or correct rather than editing `text` alone.

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
| `ingest_cursors (video_id, source, page_token, updated_at)` | MBJ-302 |
| `api_quota_usage (day, api, units)` | MBJ-305 |
| `watch_sessions (user_id, video_id, seconds, mode)` for XP and analytics | MBJ-601 |
| `xp_events (user_id, kind, amount, ref_id, created_at)`, `badges`, `user_badges` | MBJ-602 |
| `recaps (video_id, summary_md, chapters_json)` | MBJ-605 |
