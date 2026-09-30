# ADR-007: RevenueCat as the entitlement layer

- **Status:** Accepted
- **Date:** 2026-09-29

## Context
Subscriptions will come from Stripe (web), Apple, and Google. Each has different webhooks and states.

## Decision
RevenueCat unifies all three. Its webhooks update an `entitlements` table; the API derives `users.tier` from active entitlements. Stripe remains the web processor.

## Consequences
One source of truth for access. Keep a backup processor evaluated in case Stripe drops the account.
