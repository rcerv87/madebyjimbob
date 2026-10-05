# ADR-013: Memberships and super chats through Stripe

Status: accepted (2026-10-03). Covers MBJ-104, MBJ-105, MBJ-109 (first part); MBJ-112 is the wider fee comparison.

## Context

The platform must take money itself: memberships (Plus, Premium) and super chats, so JimBob stops giving YouTube its
cut (about 30% of super chats and memberships). Other creators already send viewers off YouTube to pay: Jay Dyer to a
Streamlabs tip page and The Crucible to dono.chat, both "any time", both shown on stream through an overlay. Ruben wants
people onboarded as soon as possible.

The strategy meeting compared Stripe, PayPal, Shopify and Helcim: Stripe is the easiest to build and the most familiar
to pay with (cards, Apple Pay, Google Pay, Link); Helcim is cheaper on large payments and a backup if Stripe ever drops
the account.

## Decision

- **Stripe for both**, through its REST API with `fetch` (no SDK), in JimBob's Stripe account in production.
- **Stripe's hosted pages**: Checkout for paying (subscriptions and one-off super chats) and the Customer Portal for
  changing card, switching plan, cancelling and receipts. Card details never reach our servers.
- **Prices live in Stripe** (Product catalog), referenced by id in settings (`STRIPE_PRICE_PLUS_MONTHLY`,
  `…_PLUS_YEARLY`, `…_PREMIUM_MONTHLY`, `…_PREMIUM_YEARLY`), so JimBob can change them without a deploy.
- **Webhooks keep the site in step** (`/api/webhooks/stripe`, signature checked, each event applied once):
  checkout completed, subscription created/updated/deleted, checkout expired, charge refunded.
- **`users.tier` = the higher of `manual_tier` and any live subscription** (active, trialing, past_due while Stripe
  retries the card). Tiers given by hand (testers, comps) sit in `manual_tier` and are never removed by billing.
- **Super chats any time**: `madebyjimbob.app/superchat` (and a button on /live). Once paid they go into the live chat
  when JimBob is live on the site, and always into Studio → Super chats; the OBS overlay (MBJ-223) will put them on
  screen for YouTube and Rumble viewers. $2 to $500; signing in first (each super chat makes a member).
- **No RevenueCat on the web** (MBJ-104 had it): it's only needed once the phone apps sell in-app; until then Stripe is
  the record.

## Update 2026-10-05: checkout inside the site, saved cards

- With `STRIPE_PUBLISHABLE_KEY` set, Join and super chats open Stripe's checkout in a window on our page (embedded,
  `ui_mode: embedded_page`, `redirect_on_completion: never`): nobody leaves the live stream, closing the window keeps
  the message, and once paid the super chat leaves the chat box and a thank-you shows. Joining goes to the welcome screen
  and, once the membership is on, straight back to where the viewer was. Without the key: Stripe's own page as before
  (a cancelled super chat comes back to the chat box).
- Every checkout offers "save my card for next time" (`saved_payment_method_options.payment_method_save`); cards saved
  that way are offered again, so a returning member just confirms (Face ID, Touch ID, or their bank's check) and pays.
  Cards saved only by a membership (no box ticked) aren't offered again: Stripe's rule for card networks.
- Upgrades (Plus → Premium) already charge the card on file with one click.

## Consequences

- Fees: about 2.9% + 30¢ per payment (a $5 super chat keeps about $4.55, against about $3.50 through YouTube).
- Moving to JimBob's account is new keys and price ids (MIGRATION.md); subscriptions made in a test account don't move.
- A second processor (Helcim) can sit behind the same tables (`subscriptions.provider`) later.
- Still to build: payment history in the site, Studio revenue, a wallet for small super chats (MBJ-111), annual-plan
  promotion, and the overlay.
