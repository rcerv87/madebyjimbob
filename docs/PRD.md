# Product requirements — MadeByJimBob

## Vision

Give JimBob a home he owns. His videos, his audience, his chat history, his member list, and his
revenue live on infrastructure he controls. YouTube and Rumble become distribution outlets, not the
foundation. If any platform drops him, the community keeps watching, chatting, and paying without
interruption.

## Context

- About 1,000 concurrent live viewers with a very active chat.
- Currently streams to YouTube (and Rumble). Streaming *from* the app is not a goal.
- Built by Ruben as product owner; implementation largely via Claude Code.

## Users

| Persona | Needs |
|---|---|
| **Viewer (Free)** | Watch free content, read chat, try the community before paying. |
| **Member (Plus / Premium)** | Full library, background listening, chat with status, perks that make paying feel worth it. |
| **Passive listener** | Treats streams like talk radio or a podcast: phone locked, earbuds in, driving or working. |
| **JimBob (creator)** | Sees what his audience says and does, controls access, gets paid, doesn't lose anything if a platform bans him. |
| **Moderator** | Fast tools to keep chat usable across YouTube, Rumble, and native chat from one place. |

## Membership tiers (proposed — confirm pricing and perks with JimBob)

| | Free | Plus | Premium |
|---|---|---|---|
| Free-tier videos | ✓ | ✓ | ✓ |
| Full video library | | ✓ | ✓ |
| Premium-only streams / early access | | | ✓ |
| Read chat | ✓ | ✓ | ✓ |
| Post in chat | ✓ (slow mode) | ✓ | ✓ |
| Listen-only, background audio, mini player | | ✓ | ✓ |
| Member podcast feed | | ✓ | ✓ |
| Chat badge | | Plus | Premium |
| Call in to live shows | | | ✓ |
| XP multiplier | 1× | 1.5× | 2× |

## Functional requirements

### Video
- **V1** Play stored videos from Cloudflare Stream (HLS) on web and mobile.
- **V2** Play JimBob's live YouTube stream embedded in the platform.
- **V3** (Later) Play live streams from owned infrastructure (Owncast/MediaMTX → R2).
- **V4** Gestures: double-tap left/right ±10s, long-press for 2× while held, pinch to zoom (mobile).
- **V5** Picture-in-picture on web and mobile.
- **V6** Background audio with lock-screen controls on mobile; listen-only mode that drops video to save data.
- **V7** Tier-gated access enforced server-side, including signed playback URLs.
- **V8** Captions on stored videos.

### Chat
- **C1** Store every chat message from every source with its position in the video (`offset_ms`).
- **C2** Replay chat in sync with stored videos.
- **C3** Import chat replay from past YouTube streams.
- **C4** Ingest YouTube (and Rumble) live chat in real time and merge it with native chat into one feed.
- **C5** Members post native chat, visible live to all viewers and stored for replay.
- **C6** Members who link a YouTube account can post into YouTube live chat from the app.
- **C7** @mentions with highlighting and notifications.
- **C8** Upvotes on messages; top-voted questions surfaced for JimBob.
- **C9** Tipped messages (super chats): YouTube Super Chats and Rumble Rants mirrored in; native tips via Stripe / in-app purchase.
- **C10** Filtering: banned words, slow mode, members-only mode, AI-assisted spam/toxicity filtering.
- **C11** Moderation: delete, timeout, ban — across native and YouTube from one dashboard.
- **C12** Comments under each video: YouTube comments imported (with replies, likes, pinned, creator badge) alongside native comments and replies from members.

### Community and engagement
- **E1** XP from watch/listen time, chatting, and upvotes received; levels and badges shown in chat.
- **E2** Leaderboards per stream and all-time.
- **E3** Recap notes and chapter markers generated from transcript + chat.
- **E4** Premium members can call in to live shows via a screened green room.

### Creator tools (Studio)
- **S1** Dashboard: views, chatters, message volume by source, tip totals.
- **S2** Content management: set tier per video, edit metadata.
- **S3** Chat analytics: top chatters, questions, sentiment, busiest moments.
- **S4** Member management and revenue view.

### Distribution
- **D1** Web app (responsive), iOS app, Android app.
- **D2** Public podcast RSS feed plus private per-member feeds.

## Non-functional requirements

- **Scale:** 1,000 concurrent viewers and ~100 chat messages/minute at peak without degradation; design for 10×.
  Measured from two chat replays (Aug–Sep 2026, 31 and 150 min): 26–28 messages/min on average, busiest minute 78,
  bursts of ~5 messages/second, 150–390 chatters per stream, 11–57 super chats per stream in mixed currencies
  (USD, GBP, CAD, EUR). Streams typically run 2–6 hours.
- **Latency:** native chat delivered to viewers in under 1 second.
- **Ownership:** user accounts, email list, chat history, and payment relationships stored in systems JimBob controls. Avoid services that can unilaterally lock him out of his own data.
- **Resilience:** switching the live source (YouTube → Rumble → owned) is a configuration change, not a rebuild.
- **Security:** server-side authorization on every gated resource; parameterized SQL; secrets only in env.
- **Accessibility:** keyboard operable, visible focus, reduced-motion respected, captions available.

## Out of scope (for now)

- Streaming from inside the app.
- Multi-creator marketplace.
- Private DMs between users.

## Success metrics

- Paid member conversion rate from Free.
- Share of JimBob's audience that has an account on the platform (vs. YouTube-only).
- Weekly active chatters on the platform.
- Listen-only / background play minutes (validates the passive listener persona).

## Open questions for JimBob

1. Tier prices and final perk list.
2. Moderation policy and who the mods are.
3. Brand assets (logo, colors) and final domain.
4. Which past streams to import first, and which should be members-only.
5. Payment processor backup if Stripe drops him.
