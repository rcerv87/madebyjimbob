# Moving MADEbyJIMBOB to JimBob's accounts

During the beta the platform runs on Ruben's accounts with a small library (about 50 videos). Before launch, everything
moves to accounts JimBob owns, so the platform, the archive, and the money are his: the cancel-proof idea applied to
ownership. This guide lists every account, what it holds, the settings that point at it, and how to move it.

Keep it current: when a new service or setting is added, add it here.

## Principles

- **JimBob owns the accounts and pays the bills.** Ruben (or any developer) works through access he grants: team seats
  or API keys scoped to one bucket or project. Leaving means revoking a key, not moving data.
- **Every service is reached through settings only** (environment variables on Render, `.env` locally). Moving a service
  is copying data plus changing settings; no code changes. If a move would need a code change, fix that first.
- **Move one service at a time**, verify it, then the next. The old account stays untouched until the new one is
  verified, so going back is changing the settings back.
- **Secrets are never written in docs or chat.** They live in Render's Environment and the local `.env`.

## What lives where (beta)

| Service | Holds | Owner now | Settings | Effort to move |
|---|---|---|---|---|
| **GoDaddy** | Domain `madebyjimbob.app` (registration only) | Ruben | none (nameservers point to Cloudflare) | Easy |
| **Cloudflare** | DNS for `madebyjimbob.app` (zone on the free plan), including `live.madebyjimbob.app` (the R2 bucket's custom domain) and the Cache Rule "Live video pieces" (`.ts` and `.m3u8` on `live.`); recordings under `DVR_PREFIX` (`dvr`); **R2** bucket `madebyjimbob-live` (live streams, every recording and replay kept, and the library once imported: ~0.5 TB more each month of streaming); **Stream** (imported videos) | Ruben | `R2_*`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_STREAM_CUSTOMER_CODE` | Medium (data copy) |
| **Backblaze B2** | Development only since 2026-10-03 (production keeps everything on R2); Ruben's bucket `Jimbob-beta` (US East, `s3.us-east-005.backblazeb2.com`) | Ruben (stays his) | `B2_ENDPOINT`, `B2_BUCKET`, `B2_KEY_ID`, `B2_APPLICATION_KEY` | Medium (data copy) |
| **Render** | The site (web service `madebyjimbob`) and the **Postgres** database `madebyjimbob-db` (accounts, chat, comments, videos, settings) | Ruben | all of the below; `DATABASE_URL` comes from Render | Medium |
| **Hetzner** | Streaming server, created per stream and deleted after; saved server image; fixed IP | Ruben (project `MadeByJimBob`) | `HETZNER_API_TOKEN` | Easy (nothing stored) |
| **Resend** | Account email sending for `madebyjimbob.app` | Ruben (shared Pro plan) | `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `RESEND_WEBHOOK_SECRET` | Easy |
| **GitHub** | The code (`rcerv87/madebyjimbob`, private) | Ruben | none | Easy |
| **Google Cloud** | YouTube Data API key (channel list) | Ruben | `YOUTUBE_API_KEY` | Easy |
| **Shopify** | JimBob's store, read publicly | JimBob already | `SHOP_URL` | none |
| **Stripe** | Memberships and super chats (ADR-013): customers, subscriptions, saved cards, prices, payouts | **Ruben's account in live mode since 2026-10-05** (real-money tests); moves to JimBob's before launch | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | New account: nothing moves (customers, subscriptions and saved cards stay in Ruben's). See step 9 |
| **Apple / Google developer accounts** | Phone apps | Ruben (by choice) | — | Apps can be transferred between developer accounts later |

## Before moving anything

1. Agree the date and freeze changes for that day (no deploys during the move).
2. JimBob creates each account below with his own email, two-factor login, and his card.
3. He invites Ruben as a team member where the service supports it (Cloudflare, Render, GitHub, Backblaze groups) or
   creates scoped keys and shares them privately (password manager, never chat or email).
4. Note the current values of every setting (Render → Environment) so you can go back.
5. Post a short notice on the site if anything will be offline (the database move is the only step that needs one).

## Order

Easiest and least risky first; each step is independent unless noted.

1. Resend (email)
2. Hetzner (streaming server)
3. Google Cloud (YouTube key)
4. B2 (archive), if in use
5. Cloudflare R2 (live recordings and replays), then Cloudflare Stream (imported videos)
6. Domain and DNS (Cloudflare zone, GoDaddy registration)
7. Render (site and database)
8. GitHub (code)
9. Stripe (payments): before real members pay, so the money and the members start in JimBob's account

## Steps

### 1. Resend
1. JimBob creates a Resend account (free until launch, $20/month at launch volume).
2. Add domain `madebyjimbob.app` there; Resend shows DKIM/SPF records. Add them in Cloudflare DNS (they can sit next
   to the old ones for a day).
3. Create an API key (Sending access) and a webhook (`email.bounced`, `email.complained` →
   `https://<site>/api/webhooks/resend`), copy its signing secret.
4. Render → Environment: replace `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`. Save.
5. Verify: Studio → Account email → Send test. Then remove the domain from Ruben's Resend.

### 2. Hetzner
1. JimBob creates a Hetzner account and a project `MadeByJimBob`; generates an API token (Read & Write).
2. Make sure no stream is live, then Render → Environment: replace `HETZNER_API_TOKEN`. Save.
3. The first Go Live creates a new fixed IP in his project, so **OBS's server address changes once**: copy the new
   one from Studio → Live → OBS settings. The stream key stays the same (it's in the database).
4. The first End stream saves a new server image in his project (a couple of minutes).
5. In Ruben's project, delete the old image and the old Primary IP (about $0.60/month).

### 3. Google Cloud (YouTube Data API)
1. JimBob creates a Google Cloud project, enables YouTube Data API v3, creates an API key restricted to it.
2. Replace `YOUTUBE_API_KEY` (Render, and the import helper's `.env`). Delete the old key.

### 4. Backblaze B2 (archive)
**Not needed (2026-10-03):** production keeps everything on R2, and B2 stays Ruben's for development. The steps below
are kept in case a second copy is ever wanted.
1. JimBob creates a Backblaze account and a private bucket (e.g. `madebyjimbob-archive`, lifecycle "Keep only the last
   version"), and a regular application key for that bucket only (Read and Write). Not the master key: B2's S3 API
   refuses it. A key ID is 25 characters; the secret starts with `K`.
2. Copy the bucket: `rclone sync ruben-b2:madebyjimbob-archive jimbob-b2:madebyjimbob-archive --progress`
   (rclone remotes set up with each account's key). B2's free downloads (3× stored per month) usually cover it.
3. Compare counts and sizes (`rclone size` on both), then replace `B2_*` settings and save. Copy the bucket's CORS rules
   (site origins, S3 Compatible API) too, or replays from B2 won't play in browsers. Replays in B2 are served as
   `/replay/<id>/…` (the database stores no B2 address), so nothing else changes.
4. Keep Ruben's bucket a week, then delete it.

### 5. Cloudflare R2 and Stream
**R2 (live recordings, replays, the library):** move it early. It grows about half a terabyte every month JimBob
streams on the site, so the copy takes longer the longer it waits (R2 doesn't charge for the downloads).
1. JimBob's Cloudflare account: create bucket `madebyjimbob-live`, the same CORS policy (site origins, GET/HEAD), and
   an API token with Object Read & Write on that bucket only.
2. Copy: `rclone sync ruben-r2:madebyjimbob-live jimbob-r2:madebyjimbob-live --progress` (R2 doesn't charge for
   downloads).
3. Connect the custom domain to the new bucket. Since the domain moves in step 6, either move the domain first and
   connect `live.madebyjimbob.app` there, or connect a temporary one.
4. Replace `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (and `R2_PUBLIC_URL` if the
   address changes). Save.
5. **Replays store their full address** (`videos.hls_url`). If the public address stays `live.madebyjimbob.app`,
   nothing to do; if it changes, update them:
   `UPDATE videos SET hls_url = replace(hls_url, '<old address>', '<new address>') WHERE hls_url LIKE '<old address>%';`
6. Verify: Go Live, rewind, End stream, open the replay, Listen only.

**Stream (imported videos):** Stream can't move files between accounts. Either re-import the beta videos into his
account (Studio → Add videos re-runs the helper; or `--stream-uid` style re-uploads), or, if the archive has moved to
B2 by then, skip Stream for the library entirely (ADR-010). Replace `CF_ACCOUNT_ID`, `CF_API_TOKEN`,
`CF_STREAM_CUSTOMER_CODE`, and update `videos.stream_uid` to the new ids.

### 6. Domain and DNS
1. **DNS zone:** Cloudflare has a "move domain to another account" flow; otherwise add `madebyjimbob.app` to
   JimBob's Cloudflare, recreate the records (export a zone file from Ruben's: DNS → Import and Export), and switch the
   nameservers at GoDaddy to the ones his account shows.
2. **Registration:** GoDaddy → My Products → the domain → Transfer to another GoDaddy account (his customer number or
   email). Or transfer it out to the registrar he prefers (unlock, get the auth code; `.app` transfers take ~5 days).
3. The Cloudflare "move domain" flow keeps the zone's records and rules. If you recreate the zone instead, also
   recreate the Cache Rule "Live video pieces" (Caching → Cache Rules: hostname `live.madebyjimbob.app`, file
   extension `ts`, Eligible for cache) and reconnect `live.madebyjimbob.app` to the R2 bucket (R2 → bucket →
   Settings → Custom Domains).
4. Verify the site, `live.`, email (send a test), and that auto-renew is on in his account.

### 7. Render (site and database)
Render can transfer services between workspaces: invite JimBob's workspace, transfer `madebyjimbob` and
`madebyjimbob-db` (no data copy, no downtime). If that's not available, move the database:
1. JimBob's Render: create the database (same plan or larger) and the web service from this repo's `render.yaml`.
2. Copy every setting from the old service (Render → Environment). `BETTER_AUTH_SECRET` must be **the same value**,
   or everyone is signed out (not harmful, just annoying).
3. Maintenance notice on; stop the old service (or scale it to 0) so nothing writes.
4. `pg_dump --no-owner --format=custom "$OLD_DATABASE_URL" -f mbj.dump` then
   `pg_restore --no-owner --dbname "$NEW_DATABASE_URL" mbj.dump`.
5. Start the new service; check `/api/health`, sign in, a video, chat, Studio.
6. Point the custom domain at the new service (Render → Settings → Custom Domains; Cloudflare DNS record).
7. Keep the old database a week (read-only), then delete it.

### 8. GitHub
GitHub → repository → Settings → Transfer ownership → JimBob's account or organization. Then reconnect Render's
deploys to the new repository location, and re-add the branch rule and Actions settings.

### 9. Stripe (payments)
Stripe accounts can't be transferred, and customers, subscriptions and saved cards don't move between accounts. So
JimBob's account starts empty: do this **before real members join**. Anyone who paid in Ruben's account (tests) is
cancelled and refunded there first; their site accounts drop back to Free automatically (the site ends a membership
Stripe doesn't recognize).

In JimBob's Stripe account, **Test mode off** for every step:
- [ ] **Activate the account**: business details, his bank account for payouts, statement descriptor (e.g.
  "MADEBYJIMBOB"). The first payout is usually held about 7 days.
- [ ] **Product catalog**: "Plus" and "Premium" with the agreed prices (monthly, and yearly if offered). Copy each
  **price** id (`price_…`, not `prod_…`).
- [ ] **Developers → API keys**: the **Secret key** (`sk_live_…`) and the **Publishable key** (`pk_live_…`).
- [ ] **Developers → Webhooks → Add endpoint**: `https://<site>/api/webhooks/stripe` with events
  `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`. Copy its **Signing secret**
  (`whsec_…`, different from Ruben's).
- [ ] **Settings → Billing → Customer portal**: on; allow cancelling, updating the payment method, switching between
  Plus and Premium, and invoices.
- [ ] **Settings → Payment methods**: **Cards**, **Apple Pay** and **Google Pay** on (fingerprint / Face ID checkout).
  Leave bank payments, Klarna and Link off (the site only offers cards anyway).
- [ ] **Settings → Payment method domains**: add the site's domain(s) (`madebyjimbob.onrender.com`,
  `madebyjimbob.app`, and the final `.com` when it moves) so Apple Pay works in the checkout window on our pages.
- [ ] **Settings → Branding**: his logo, icon and teal (#27717A), so the checkout window looks like the site.
- [ ] Invite Ruben: **Settings → Team → Invite**, role **Developer** (or Administrator), so he can see logs and help.

Then on Render → `madebyjimbob` → Environment, replace `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
`STRIPE_WEBHOOK_SECRET`, and every `STRIPE_PRICE_*` with JimBob's values, and Save. Check:
- [ ] /membership shows the right prices (if the plans don't show, a price id and the key are from different accounts or
  modes: Render → Logs, search "Stripe price").
- [ ] One real Plus join, one $2 super chat (in the live chat during a stream), an upgrade, and a card added in Account →
  Payment methods; then cancel and refund in Stripe. The webhook events arrive (site shows the membership, the super chat).
- [ ] In Ruben's Stripe account: cancel anything left, refund the tests, and roll or delete the old keys and webhook.

## After the move

- [ ] Every service in the table shows JimBob as owner; Ruben has team access or scoped keys only.
- [ ] Render → Environment has no key from Ruben's accounts (compare with the notes from "Before moving anything").
- [ ] Local `.env` files updated (the import helper's PC especially).
- [ ] Old buckets, images, IPs, keys, and tokens deleted from Ruben's accounts after a week.
- [ ] Update this document's "What lives where" table.
