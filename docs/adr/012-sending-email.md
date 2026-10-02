# ADR-012: Send account email through Resend

- **Status:** Accepted (sending domain DNS pending, see STATUS.md)
- **Date:** 2026-09-30

## Context

Registration, password reset, email change, sign-in alerts, and account deletion (MBJ-108, 113, 110, 118)
all need email that arrives from JimBob's own domain and stays out of spam. Render has no mail service, and
sending from our own server would land in spam, so we need a transactional email provider.

Volume estimate: about 3 account emails per member per month once email notifications exist (verification
and security mail is less; notification digests are more). Prices checked 2026-09-30 on each provider's
pricing page:

| Members | Emails/month | Resend | Postmark | Amazon SES |
|---|---|---|---|---|
| 1,000 | ~3,000 | $0 (free: 3,000/month but only 100/day), realistically $20 | $15 | ~$0.30 |
| 10,000 | ~30,000 | $20 (Pro, 50,000 included) | ~$42.50 (Pro $16.50 + overage $1.30/1,000) | ~$3 |
| 50,000 | ~150,000 | ~$80 (Pro 100,000 for $35 + $0.90/1,000) | ~$199 on overage | ~$15 |

SES is cheapest but needs an AWS account, a manual request to leave its sandbox (can take days and be
refused), and SNS topics for bounces. Postmark has excellent deliverability but costs the most at scale.

## Decision

Use **Resend** through its HTTPS API (no SDK, so no new dependency), sending from an address on JimBob's
domain (e.g. `hello@madebyjimbob.com`) with SPF, DKIM, and DMARC records.

- `server/src/email.js` is the only code that talks to the provider: `sendEmail({ to, template, data })`.
- Templates live in our code (`server/src/emailTemplates.js`), not in the provider's dashboard.
- Every send is logged in `emails`; hard bounces and spam complaints arrive on a signed webhook
  (`POST /api/webhooks/resend`) and go into `email_suppressions`, which `sendEmail` checks first.
- Without `RESEND_API_KEY` and `EMAIL_FROM`, email is off: nothing is sent and each attempt is logged as `off`.

## Consequences

- $0 while building; plan on $20/month (Resend Pro) from launch, since the free plan's 100/day cap is easy to
  hit on a stream day.
- Templates, the send log, and the do-not-mail list are ours, so moving to SES later (worth it past roughly
  100,000 emails a month, saving about $65/month at 150,000) means rewriting one function and pointing the
  webhook at SNS.
- JimBob's domain needs three or four DNS records (sending subdomain MX and SPF, DKIM, DMARC). If the domain's
  DNS moves (ADR-011 option A), these records move with it.

## Update 2026-10-01

Ruben bought Resend Pro ($20/month) for his own projects and shares it with MadeByJimBob, so account email adds no cost for now. The sending domain will be madebyjimbob.app during the beta (ADR-011).
