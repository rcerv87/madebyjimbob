# ADR-010: Stored video on Cloudflare R2 instead of Cloudflare Stream

- **Status:** Proposed (needs a decision from Ruben / JimBob)
- **Date:** 2026-09-29

## Context

ADR-002 put stored video on Cloudflare Stream: no video infrastructure to run, and the MVP works on it
today (Starter bundle, $5/month, 1,000 minutes stored + 5,000 minutes delivered).

Real numbers since then:

- JimBob's past live streams run **2–6 hours each (~4 h average)**. The channel's Live tab lists 40+.
  The full library is on the order of **10,000+ minutes**.
- Stream bills **$5 per 1,000 minutes stored, every month**, plus **$1 per 1,000 minutes delivered**.
  The full library would cost roughly **$50+/month just to keep**, rising with every stream, before anyone
  watches. 500 viewers watching 2 hours each in a month adds about $60.
- Stream's format is tied to Cloudflare's service. If the account were closed, the library would have to be
  re-uploaded from YouTube (which may itself be gone). That cuts against the product's purpose (PRD vision).
- ADR-004 already plans owned live ingest writing HLS to R2. VOD on R2 means one video system, not two.

## Decision (proposed)

Transcode each imported stream to an HLS ladder (1080p/720p/480p + audio-only) with ffmpeg during import,
upload the segments and playlists to an R2 bucket, and serve them through a Cloudflare custom domain.
`videos` gets a `storage` column (`stream | r2`) so both work during the move; the player already only needs
an HLS URL. Paid-tier protection moves from Stream signed URLs to a short-lived token checked by a small
Cloudflare Worker (or signed cookies) in front of the bucket (replaces MBJ-103's approach).

## Consequences

- **Cost:** R2 charges ~$0.015/GB-month storage and **no egress fees**. A 4-hour stream as an HLS ladder is
  roughly 10–20 GB, so 40 streams ≈ 400–800 GB ≈ $6–12/month, flat with viewer count. Request fees are cents.
- **Ownership:** segments are plain files; copying them to any S3-compatible store or server is a one-off job.
- **Work:** about half a day to change the import script and playback URLs, plus the Worker for gated videos.
  Transcoding a 4-hour stream takes a while on the import machine (it's a one-time cost per stream).
- **Lost:** Stream's automatic thumbnails and captions; thumbnails come from ffmpeg, captions from MBJ-604.
- **Migration:** the two demo videos on Stream can be re-imported; nothing else is on Stream yet.

Prices are estimates as of this date; check current Cloudflare pricing before deciding.

## Update 2026-10-01: Ruben's direction

- **Cancel-proof is a core reason for the platform:** the whole archive must live on our own storage. Playing old streams
  through YouTube embeds is ruled out, because a YouTube takedown would remove them from our site too.
- **Versions per video:** 720p at an efficient bitrate (~0.7 GB/hour; streams are mostly talking), 360p for weak signal,
  and audio only (podcast mode, ~30 MB/hour). Full 1080p only for recent streams, if at all.
- **Cost target is tens of dollars, not hundreds:** about 2.2 TB for the 926-video listing (~2,325 hours) is ~$33/month on
  R2 (~$13 on Backblaze B2 served through Cloudflare). Stream would be ~$700/month for storage alone.
- **Originals:** keep a master copy off-platform as a cancel-proof backup (a USB drive at home, about $150 once), and
  consider a second cloud copy of the compressed versions.
- **Processing:** the helper on Ruben's PC encodes them (free, overnight).
- **Later:** downloads to watch offline in the phone apps (720p or audio, expiring), and audio downloads on the website.
- **Decided (Ruben, 2026-10-01):** keep a second cloud copy of the compressed versions on Backblaze B2 (~$13/month), so
  there are three copies (R2 for playback, B2, and the originals on a home drive), and losing one provider doesn't lose
  the archive. Total ≈ $46/month for the full library.
