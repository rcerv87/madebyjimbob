"""Single source for the backlog. Run: python3 docs/backlog_source.py
Writes BACKLOG.md (repo root) and docs/backlog.csv."""
import csv, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

EPICS = {
    "0": ("Foundation", "Make the POC a safe base: tests, CI, migrations, shared types."),
    "1": ("Accounts & memberships", "Real users, tiers, payments, and server-enforced access."),
    "2": ("Chat & moderation", "The core chat experience and the tools to keep it usable."),
    "3": ("Live via YouTube", "Watch live in-platform with YouTube/Rumble chat merged in, then auto-archive."),
    "4": ("Mobile apps", "iOS and Android with background audio, PiP, gestures, and IAP."),
    "5": ("Owned live & audio", "Platform-independent live, audio-only, and podcast feeds."),
    "6": ("Engagement & AI", "XP, badges, captions, recaps, call-ins."),
    "7": ("Studio & analytics", "Creator tools and audience insight."),
}

# id, phase, priority, size, title, user story, acceptance criteria, depends on
S = [
# ---------------- 0 Foundation ----------------
("001", 0, "Must", "M", "Test harness",
 "As the developer, I want automated tests so Claude Code can change things safely.",
 ["`npm test` runs server and web tests from the repo root",
  "Server tests run against a disposable Postgres (`DATABASE_URL_TEST`) and reset it per run",
  "Covered: sign-in, tier gating on `/videos/:id`, chat window query, chat post + rate limit, WS broadcast",
  "Web: at least one render test each for Home, Watch (locked + unlocked), ChatPanel"], []),
("002", 0, "Must", "S", "Lint and format",
 "As the developer, I want consistent code style enforced automatically.",
 ["ESLint + Prettier configured for server and web", "`npm run lint` and `npm run format` at root", "Existing code passes lint"], []),
("003", 0, "Must", "M", "Database migrations",
 "As the developer, I want versioned schema changes so production data is never at risk.",
 ["node-pg-migrate installed; baseline migration equals current `schema.sql`",
  "Migrations run as Render pre-deploy command, not on app boot",
  "`npm run migrate:create <name>` documented in CLAUDE.md", "`schema.sql` removed or marked historical"], []),
("004", 0, "Should", "L", "TypeScript and shared package",
 "As the developer, I want shared types across server, web, and mobile so contracts can't drift.",
 ["`packages/shared` exports types for User, Video, ChatMessage, WS events, and a typed API client",
  "Server and web compile with `tsc --noEmit` in CI", "No behavior change; all tests pass"], ["001", "002"]),
("005", 0, "Must", "S", "CI pipeline",
 "As the developer, I want every PR checked before merge.",
 ["GitHub Actions runs lint, test (with Postgres service), and build on PRs to main", "Status check required to merge"], ["001", "002"]),
("006", 0, "Must", "S", "Extract YouTube replay parser",
 "As the developer, I want the chat replay parser as a tested module so live ingest can reuse it.",
 ["Parser lives in `server/src/ingest/youtubeReplay.js` with pure functions",
  "Fixture-based tests cover text, emoji, super chat, membership, negative offsets",
  "Import script uses the module; behavior unchanged"], ["001"]),
("007", 0, "Should", "S", "Structured logging",
 "As the operator, I want useful logs when something breaks in production.",
 ["pino logger with request id per HTTP request", "Errors logged with stack; no secrets or tokens logged"], []),
("008", 0, "Should", "S", "Staging environment",
 "As the product owner, I want to review changes before they reach JimBob's audience.",
 ["Separate Render service + database for staging deployed from `staging` branch", "Documented in README"], ["003"]),

# ---------------- 1 Accounts & memberships ----------------
("101", 1, "Must", "L", "Real authentication",
 "As a viewer, I want a real account so my identity, tier, and history are mine.",
 ["Self-hosted auth (ADR-006) with email + password, magic link, Google, and Apple sign-in",
  "Users choose a unique username at signup (3–32 `[A-Za-z0-9_]`)",
  "POC `/session` endpoint and `session_token` column removed",
  "Tier can no longer be self-selected"], ["003"]),
("102", 1, "Must", "S", "Roles and Studio access",
 "As JimBob, I want only me and my mods to reach Studio and mod tools.",
 ["`users.role` = viewer | mod | admin", "`/api/studio/*` and `/api/mod/*` return 403 for viewers",
  "Studio nav hidden for viewers", "Admin can promote/demote mods in Studio"], ["101"]),
("103", 1, "Must", "M", "Signed playback URLs",
 "As JimBob, I want paid videos to be unwatchable without the right tier, even with a copied link.",
 ["Gated videos have `requireSignedURLs` enabled on Stream",
  "API returns a short-lived signed token URL only to entitled users",
  "Free videos stay unsigned", "Import script sets the flag based on `--tier`"], ["101"]),
("104", 1, "Must", "L", "Web subscriptions and entitlements",
 "As a viewer, I want to subscribe to Plus or Premium on the web.",
 ["Stripe Checkout for Plus and Premium (monthly; annual optional)",
  "RevenueCat receives Stripe purchases; webhook updates `entitlements`",
  "`users.tier` derived from active entitlements; expires correctly on cancel/lapse",
  "Webhooks verified by signature and idempotent"], ["101"]),
("105", 1, "Must", "M", "Pricing page and upsell",
 "As a free viewer, I want to see what paid tiers include and upgrade in one step.",
 ["Pricing page shows the tier matrix from the PRD", "Locked video screen links to upgrade with that tier preselected",
  "After purchase, the user returns to the video and it plays"], ["104"]),
("106", 1, "Should", "M", "Account page",
 "As a member, I want to manage my subscription and profile.",
 ["Change username (once per 30 days), manage subscription via Stripe customer portal",
  "Shows tier, renewal date, linked accounts"], ["104"]),
("107", 1, "Must", "S", "Owned email list",
 "As JimBob, I want my audience's contact info so no platform can take my audience away.",
 ["Marketing opt-in checkbox at signup, stored with timestamp",
  "Admin can export opted-in users as CSV from Studio", "Unsubscribe link handling documented"], ["101", "102"]),

# ---------------- 2 Chat & moderation ----------------
("201", 1, "Should", "M", "Chat replay polish",
 "As a viewer, I want chat that feels as good as YouTube's.",
 ["\"Jump to latest\" button appears when scrolled up; resumes auto-scroll",
  "Hovering a message shows its video timestamp; clicking seeks the player there",
  "On WebSocket reconnect, missed messages are fetched since the last id"], []),
("202", 1, "Should", "M", "@mention autocomplete and notifications",
 "As a member, I want to know when someone mentions me.",
 ["Typing `@` suggests recent chatters in this video", "Mentioned native users get an in-app notification (bell with count)",
  "Clicking a notification opens the video at that message's timestamp"], ["101"]),
("203", 1, "Should", "M", "Upvotes and top questions",
 "As a viewer, I want to upvote good messages; as JimBob, I want the best questions surfaced.",
 ["One vote per user per message; toggle to remove", "Vote counts update live via WS `vote` event",
  "\"Top questions\" tab lists messages containing `?` ordered by votes"], ["101"]),
("204", 1, "Must", "L", "Moderation tools",
 "As a mod, I want to hide messages and remove bad actors quickly.",
 ["Mods can hide a message, time out a user (1/5/60 min), or ban a user",
  "Room modes: open, slow (N seconds), members-only; broadcast via WS `room`",
  "Hidden messages disappear for all viewers in real time (WS `hide`) but remain in the database",
  "Every action logged in `mod_actions` and visible in Studio"], ["102"]),
("205", 3, "Should", "M", "Redis pub/sub and rate limits",
 "As the operator, I want chat to work across multiple instances and a separate ingest worker.",
 ["Render Key Value added to `render.yaml`", "Room fan-out via Redis pub/sub", "Rate limits stored in Redis",
  "Works with 2 web instances in a load test of 1,000 sockets"], ["001"]),
("206", 1, "Should", "M", "Managed filters and spam detection",
 "As a mod, I want to manage banned terms and have obvious spam held automatically.",
 ["`banned_terms` editable in Studio replaces the env var", "Automated classifier holds likely spam/toxicity for review",
  "Mods can approve or reject held messages"], ["204"]),
("207", 1, "Should", "L", "Native tipped messages (web)",
 "As a member, I want to tip with a highlighted message like a Super Chat.",
 ["Fixed tip amounts via Stripe", "Message posts only after payment confirmation (webhook)",
  "Paid message pinned for a duration scaled by amount; WS `pin` event", "Tips appear in Studio revenue"], ["104"]),
("208", 1, "Could", "M", "Chat search in Studio",
 "As JimBob, I want to find what people said.",
 ["Search by text, author, source, date range, video", "Results link to the video at that timestamp"], ["102"]),
("209", 1, "Should", "S", "Tier-based chat limits",
 "As JimBob, I want free chatters slowed down and members rewarded.",
 ["Free users: slow mode per PRD; Plus/Premium: normal rate", "Tier badge shown next to native usernames"], ["104"]),

# ---------------- 3 Live via YouTube ----------------
("301", 3, "Must", "M", "Live video model and live page",
 "As a viewer, I want to watch JimBob live without leaving the platform.",
 ["`videos.status` and `videos.source` added (see DATA_MODEL)", "Live page embeds the YouTube IFrame player for the active broadcast",
  "\"Live now\" banner on Home while a stream is live", "`GET /api/live/current` returns the live video or null"], ["003"]),
("302", 3, "Must", "L", "YouTube live chat ingest worker",
 "As a viewer, I want YouTube chat in the platform in real time.",
 ["Render background worker; JimBob authorizes his channel once via OAuth",
  "Detects live broadcast start/end", "Polls chat at YouTube's interval; inserts with `offset_ms = publishedAt − actualStartTime`",
  "Idempotent; persists page token in `ingest_cursors`; survives restarts without gaps or duplicates",
  "Publishes new messages to the video's room"], ["301", "205", "006"]),
("303", 3, "Must", "M", "Live chat mode in the UI",
 "As a viewer, I want live chat to behave like live chat, not replay.",
 ["Live videos render all incoming messages (no playhead filtering)", "Native posts use server-computed `offset_ms`",
  "After the stream is archived, the same chat replays in sync"], ["302"]),
("304", 3, "Must", "M", "Auto-archive finished streams",
 "As JimBob, I want every live stream saved to my own storage automatically.",
 ["When a broadcast ends, a job downloads the VOD and uploads it to Stream",
  "Video row switches to archived; tier default configurable", "Failure retries and alerts in logs"], ["302"]),
("305", 3, "Should", "L", "Post to YouTube chat from the platform",
 "As a member with a YouTube account, I want my messages to appear in YouTube's chat too.",
 ["User links YouTube via Google OAuth", "Posts go to YouTube via `liveChatMessages.insert` and to native chat, de-duplicated",
  "Quota usage tracked daily; when exhausted, posts fall back to native-only with a notice"], ["101", "302", "306"]),
("306", 3, "Must", "S", "Google API verification and quota request",
 "As the product owner, I want Google approvals in place before live features need them.",
 ["OAuth consent screen verified for YouTube scopes", "Quota increase requested with expected usage",
  "Non-code task — owner: Ruben. Start during Phase 1."], []),
("307", 3, "Should", "M", "Rumble chat and Rants ingest",
 "As a viewer, I want Rumble chat merged into the same feed.",
 ["Worker polls Rumble Live Stream API with JimBob's key", "Messages stored with `source = rumble`; Rants as `kind = paid`",
  "Rumble tag shown in chat"], ["302"]),
("308", 3, "Should", "M", "Moderation reaches YouTube",
 "As a mod, I want one set of tools for both chats.",
 ["Hiding a YouTube-sourced message also deletes it on YouTube", "Banning a YouTube author bans them on YouTube",
  "Actions use JimBob's OAuth token and are logged"], ["204", "302"]),
("309", 3, "Should", "S", "Configurable live source",
 "As JimBob, I want to switch live platforms without an app update.",
 ["Live source per video: youtube | rumble | owned", "Clients pick the player from the API response"], ["301"]),

# ---------------- 4 Mobile ----------------
("401", 2, "Must", "L", "Expo app scaffold",
 "As a viewer, I want the platform as a phone app.",
 ["`mobile/` Expo app in the workspace using `packages/shared`", "Sign-in, Home, Watch, Account screens",
  "Runs on iOS simulator and Android emulator"], ["004", "101"]),
("402", 2, "Must", "M", "Mobile player and gestures",
 "As a mobile viewer, I want YouTube-quality player controls.",
 ["expo-video HLS playback", "Double-tap left/right ±10s with visual feedback", "Long-press 2× while held",
  "Pinch to zoom (1×–3×)"], ["401"]),
("403", 2, "Must", "M", "Background audio, lock screen, PiP",
 "As a passive listener, I want to lock my phone and keep listening.",
 ["Audio continues with screen locked and app backgrounded", "Lock-screen/notification controls with title and artwork",
  "PiP starts automatically when leaving the app while playing", "Listen-only toggle hides video"], ["402"]),
("404", 2, "Must", "M", "Mobile chat",
 "As a mobile viewer, I want to read and post chat.",
 ["Chat panel synced to playback (replay) and live mode", "Catch-up fetch after returning from background"], ["401"]),
("405", 2, "Should", "M", "Push notifications",
 "As a member, I want to know when JimBob goes live or someone mentions me.",
 ["Expo push for: live now, @mentions, tip replies", "Per-type opt-out in Account"], ["401", "202"]),
("406", 2, "Must", "L", "In-app subscriptions and tips",
 "As a mobile viewer, I want to subscribe and tip in the app.",
 ["RevenueCat offerings for Plus and Premium on iOS and Android", "Consumable tip products",
  "Entitlements shared with web purchases"], ["104", "401"]),
("407", 2, "Must", "M", "Store release",
 "As JimBob, I want the app in both stores.",
 ["EAS Build/Submit configured", "TestFlight and Play internal testing live", "Store listings and privacy disclosures complete"], ["403", "406"]),

# ---------------- 5 Owned live & audio ----------------
("501", 4, "Must", "L", "Owned live ingest to R2",
 "As JimBob, I want a live stream no platform can shut off.",
 ["MediaMTX on a VPS accepts RTMP/SRT from OBS", "ffmpeg outputs 720p/480p + audio-only HLS to R2",
  "Served via a Cloudflare domain; plays in web and mobile", "Runbook in `docs/runbooks/owned-live.md`"], ["309"]),
("502", 4, "Must", "M", "Audio-only renditions",
 "As a passive listener, I want listen mode to use far less data.",
 ["Live: audio-only HLS from 501", "VOD: job produces AAC HLS per video to R2", "Listen-only mode switches to the audio playlist"], ["501"]),
("503", 4, "Should", "M", "Podcast feeds",
 "As a listener, I want streams in my podcast app.",
 ["Public RSS feed of free episodes", "Private per-member tokenized feed including paid episodes; revoked on lapse",
  "Feeds validate in Apple Podcasts"], ["502", "104"]),
("504", 4, "Should", "M", "Restream to YouTube and Rumble",
 "As JimBob, I want to stream once and reach every platform.",
 ["Ingest forwards to YouTube and Rumble RTMP targets", "Targets configurable in Studio"], ["501"]),
("505", 4, "Should", "M", "Owned live recordings",
 "As JimBob, I want owned streams archived automatically.",
 ["Live segments assembled into a VOD after the stream", "Chat replays in sync"], ["501"]),

# ---------------- 6 Engagement & AI ----------------
("601", 5, "Must", "S", "Watch and listen tracking",
 "As JimBob, I want to know who actually watches and listens.",
 ["Client heartbeat every 60s while playing (video or listen-only)", "Stored in `watch_sessions` with mode"], ["101"]),
("602", 5, "Should", "M", "XP, levels, badges",
 "As a regular, I want my loyalty visible in chat.",
 ["XP from watch/listen time, messages, and upvotes received; tier multipliers per PRD",
  "Level and badge shown next to name in chat", "Anti-farming: idle tabs and duplicate messages earn nothing"], ["601"]),
("603", 5, "Could", "S", "Leaderboards",
 "As a regular, I want to see where I rank.",
 ["Per-stream and all-time leaderboards", "Shown on watch page and in Studio"], ["602"]),
("604", 5, "Should", "M", "Captions",
 "As a viewer, I want captions on stored videos.",
 ["Captions generated for each VOD (Stream captions or Whisper)", "Selectable in web and mobile players", "Transcript stored"], []),
("605", 5, "Should", "M", "AI recaps and chapters",
 "As a viewer, I want a quick summary and jump points.",
 ["After archive, a job generates recap notes and chapters from transcript + chat", "Shown on the watch page; chapters seek the player",
  "JimBob can edit before publishing"], ["604"]),
("606", 5, "Could", "XL", "Call-ins",
 "As a Premium member, I want to call in to the live show.",
 ["Premium users request to call; LiveKit green room", "Producer screens and approves", "Approved caller appears in OBS via browser source"], ["104", "301"]),
("607", 5, "Could", "L", "Polls and predictions",
 "As a viewer, I want to spend points and play along.",
 ["Mods create polls/predictions during a stream", "Viewers vote with points; results broadcast live"], ["602"]),

# ---------------- 7 Studio & analytics ----------------
("701", 1, "Should", "M", "Content management",
 "As JimBob, I want to manage videos without a terminal.",
 ["Edit title, description, tier, and thumbnail", "Start a YouTube import from a URL in Studio (background job with status)"], ["102"]),
("702", 5, "Should", "M", "Chat analytics",
 "As JimBob, I want to see what landed with my audience.",
 ["Messages-per-minute chart per stream with busiest moments linked to timestamps",
  "Top questions and per-stream sentiment summary"], ["102"]),
("703", 1, "Should", "M", "Members and revenue dashboard",
 "As JimBob, I want to see who pays and how much I earn.",
 ["Active members by tier, churn, MRR, tip totals by source"], ["104", "102"]),
("704", 1, "Should", "S", "Data export",
 "As JimBob, I want a copy of everything that's mine.",
 ["CSV export of chat (per video or all), members, and tips"], ["102"]),
]

PHASES = {0: "Phase 0 — Foundation", 1: "Phase 1 — VOD platform", 2: "Phase 2 — Mobile",
          3: "Phase 3 — Live via YouTube", 4: "Phase 4 — Owned live + audio", 5: "Phase 5 — Engagement"}

SPRINTS = [
    ("Sprint 1", "Foundation", ["001", "002", "003", "005", "006", "306"]),
    ("Sprint 2", "Real users", ["101", "102", "007", "201"]),
    ("Sprint 3", "Paid tiers", ["103", "104", "105", "107"]),
    ("Sprint 4", "Chat that scales socially", ["204", "203", "202", "209"]),
    ("Sprint 5", "Shared types + mobile start", ["004", "401", "402"]),
    ("Sprint 6", "Mobile core", ["403", "404", "406"]),
    ("Sprint 7", "Go live", ["301", "205", "302", "303"]),
]

# Story status lives here, not in BACKLOG.md (that file is regenerated). Example: {"001": "Done"}
STATUS = {"001": "Done", "002": "Done"}

def main():
    rows = [dict(id=f"MBJ-{i}", epic=EPICS[i[0]][0], phase=p, priority=pr, size=sz, title=t,
                 story=st, ac=ac, deps=[f"MBJ-{d}" for d in dp], status=STATUS.get(i, "To do"))
            for i, p, pr, sz, t, st, ac, dp in S]

    out = ["# Backlog — MadeByJimBob", "",
           "Generated from `docs/backlog_source.py` — edit there and re-run `python3 docs/backlog_source.py`.",
           "", "**Priority:** Must / Should / Could.  **Size:** S (≤1 day), M (2–3 days), L (~1 week), XL (>1 week).",
           "", "## Done (POC)", "",
           "- Stored video playback from Cloudflare Stream with gestures, mini player, listen-only, lock-screen metadata",
           "- YouTube import: video → Stream, chat replay → Postgres with `offset_ms`",
           "- Chat replay synced to playback; native posting at playhead with WebSocket broadcast",
           "- Rate limiting, banned-word masking, @mention highlighting",
           "- Tier-gated video detail endpoint; Studio dashboard with per-video access control",
           "", "## Done (MVP hardening)", "",
           "- Username + password sign-in (scrypt); taken names need their password. Replaced by MBJ-101",
           "- Tier picker only when `ALLOW_TEST_TIERS=true`; Studio restricted to `ADMIN_USERNAMES`",
           "- Chat read, post, and WebSocket join enforce the video's tier",
           "- Malformed or unknown video ids return 400/404 instead of 500",
           "", "## Suggested sprint plan", "", "| Sprint | Goal | Stories |", "|---|---|---|"]
    for name, goal, ids in SPRINTS:
        out.append(f"| {name} | {goal} | {', '.join('MBJ-' + i for i in ids)} |")
    out += ["", "## Summary", "", "| ID | Title | Epic | Phase | Priority | Size | Depends on |", "|---|---|---|---|---|---|---|"]
    for r in sorted(rows, key=lambda r: (r["phase"], r["id"])):
        out.append(f"| {r['id']} | {r['title']} | {r['epic']} | {r['phase']} | {r['priority']} | {r['size']} | {', '.join(r['deps']) or '—'} |")

    for key, (epic, desc) in EPICS.items():
        out += ["", f"## Epic {key}xx — {epic}", "", desc]
        for r in [r for r in rows if r["epic"] == epic]:
            out += ["", f"### {r['id']} — {r['title']}", "",
                    f"**Status:** {r['status']} · **{PHASES[r['phase']]}** · **Priority:** {r['priority']} · **Size:** {r['size']}"
                    + (f" · **Depends on:** {', '.join(r['deps'])}" if r['deps'] else ""),
                    "", r["story"], "", "Acceptance criteria:"]
            box = "x" if r["status"] == "Done" else " "
            out += [f"- [{box}] {a}" for a in r["ac"]]
    with open(ROOT / "BACKLOG.md", "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out) + "\n")

    with open(ROOT / "docs" / "backlog.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Issue ID", "Summary", "Epic", "Phase", "Priority", "Size", "Status", "Description", "Acceptance Criteria", "Depends On"])
        for r in rows:
            w.writerow([r["id"], r["title"], r["epic"], PHASES[r["phase"]], r["priority"], r["size"], r["status"],
                        r["story"], "\n".join(f"- {a}" for a in r["ac"]), ", ".join(r["deps"])])
    print(f"{len(rows)} stories written")

if __name__ == "__main__":
    main()
