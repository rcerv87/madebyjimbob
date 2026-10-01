# ADR-011: Keep the Shopify store; decide which address the platform uses

- **Status:** Proposed (store part accepted; domain choice needs Ruben and JimBob)
- **Date:** 2026-09-30

## Context

madebyjimbob.com is JimBob's Shopify store today: about 150 products (books, shirts, stickers, mugs,
art prints, original and digital art), checkout, fulfilment, customer accounts, and a newsletter list.
It also sells **Bob Chats**, his paid chat messages. The platform (videos, chat, comments, community)
runs on Render at madebyjimbob.onrender.com and needs a real address before launch.

## Decision

**Store:** keep Shopify for catalog, checkout, and fulfilment. The platform shows the store's products in
its Shop and Art sections (read live from the store's public product JSON, cached 10 minutes); Buy opens
the product in the store. Later, cart and checkout can move inside the platform with Shopify's Storefront
API without replacing Shopify (MBJ-807).

**Domain (choose one):**

| Option | Platform | Store | Notes |
|---|---|---|---|
| A (recommended) | madebyjimbob.com | shop.madebyjimbob.com | The brand's main address becomes the place to watch and talk; Shopify supports a shop subdomain directly. Existing product links need redirects (Shopify handles its own URLs on the new subdomain; old madebyjimbob.com/products/... links need a redirect rule on the platform). |
| B | watch.madebyjimbob.com (or app.) | madebyjimbob.com | No change to the store or its links; the platform is one step removed from the main address. |

Either way, the platform's navigation links to the store and the store's menu links back, so they read as
one site.

## Beta address (2026-09-30)

Until JimBob decides, the platform runs its beta on **madebyjimbob.app**, registered by Ruben with JimBob's OK
and handed over later; account email is verified on it in Resend. At the switch to madebyjimbob.com:

- Render: add the custom domain, set `SITE_URL` and `ALLOW_INDEXING=true`; add madebyjimbob.com in Resend and
  change `EMAIL_FROM`. No code changes.
- Keep madebyjimbob.app redirecting to madebyjimbob.com permanently (old Home Screen icons, emailed links, shares).
- Everyone signs in again and turns push back on (both are tied to the address); accounts and history carry over.
- Publish the phone apps on the .com address if possible: app links are tied to one domain.
- During the beta, .app stays out of search (`ALLOW_INDEXING` unset).

## Consequences

- No rebuilding of products, payments, or shipping; JimBob keeps using the Shopify admin he knows.
- Option A needs a DNS change at the domain registrar (Render custom domain + Shopify subdomain) and a
  redirect for old product links; do it during a quiet time and test checkout afterwards.
- The Shopify newsletter list seeds the owned email list (MBJ-107); Bob Chats feed tipped messages (MBJ-207).
