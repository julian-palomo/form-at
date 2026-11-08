# Sell tickets with Stripe Checkout, counted capacity and a signed ticket token

Partly superseded by [2026-11-08-several-tickets-per-order.md](2026-11-08-several-tickets-per-order.md): an order now holds 1 to 10 tickets, one `tickets` row per seat.

- **Status:** Accepted
- **Date:** 2026-11-08

## Context

Form:at 004 (Sat 5 Dec 2026, Stereo) is the first night we sell tickets
ourselves, from `formatglasgow.com/events/format-004`, instead of only through
Resident Advisor. Tiers sell in order: 15 at £8, 15 at £10, then 120 at £12,
150 online in all. The collective runs the door, possibly with no signal in
the basement.

What's true now and shapes the choice:

- Both apps run on Cloudflare Pages Workers and share one D1 database
  (`form-at-analytics`). Shared queries live in `packages/data`; apps never
  import each other.
- D1 has no long-running transactions. It has single statements, which SQLite
  runs atomically, and `batch()`, which runs a list of statements as one
  transaction.
- Payment webhooks can arrive twice, late, or not at all, and a Worker can die
  between two writes.
- No one on the team can review a custom card form for PCI compliance.

## Decision

1. **Stripe Checkout, the hosted payment page.** The site creates a Checkout
   Session on the server and redirects to Stripe; a signature-verified webhook
   (`checkout.session.completed` / `.expired`) is the only thing that marks an
   order paid or expired.
2. **Capacity is counted, not cached.** `ticket_tiers` has no `sold` or
   `reserved` column. A seat is held by an order that is `paid`, or `pending`
   with `expires_at` in the future. Reserving is one `INSERT … SELECT … WHERE
   (count of held seats) < cap`; confirming and expiring are each one `UPDATE …
   WHERE status = 'pending'`. Confirming also inserts the ticket in the same
   batch, with `INSERT OR IGNORE` over `tickets.order_id UNIQUE`. The queries
   are in `packages/data/src/tickets.ts`.
3. **The ticket token is `<ticketId>.<base64url(HMAC-SHA256(ticketId,
   TICKET_SIGNING_SECRET))>`**, with no padding and one canonical spelling.
   It's computed with Web Crypto in `packages/data/src/ticketToken.ts` and
   derived on demand, never stored.

## Alternatives considered

- **Resident Advisor only.** Zero build, RA Scan at the door, and payout the
  Tuesday after the event, but RA's fees on every ticket. It stays the
  fallback: if the minimum scope isn't working in Stripe test mode by Sun 15
  Nov 2026, 004 sells on RA.
- **A custom card form (Stripe Elements or Payment Element).** More control of
  the page, but more code and more of the PCI surface on us, for no gain at
  150 tickets.
- **`sold`/`reserved` counters on the tier.** Cheaper to read, but each order
  then needs two writes that must stay in step. A duplicate webhook or a Worker
  dying between them leaves the counter wrong, with nothing to repair it.
- **A random, unsigned ticket code checked only against D1.** Simpler, but
  the door couldn't reject an invented code without a database read, which
  matters when the basement has no signal.
- **A JWT as the token.** Self-describing, but longer (a denser QR) and it adds
  a header and claims we don't need. The ticket id is the only claim.
- **The Stripe Node SDK.** It can run on Workers, but the source for that is a
  2021 post. Calling the REST API with `fetch` and checking the webhook's HMAC
  ourselves is small and has no version risk. The webhook phase makes the final
  call.

## Consequences

- Overselling and double counting are prevented by the SQL, not by the caller.
  Every new state change must stay one conditional statement (or one batch).
  A read followed by a write reintroduces the race.
- An unpaid checkout holds a seat until `expires_at`, which the checkout sets a
  few minutes after the Stripe session's own expiry. With tiers of 15,
  abandoned checkouts can make a tier look full for that long, so reservations
  need a per-request limit (the checkout phase's job).
- A lost `expired` webhook no longer leaks a seat, because the count ignores
  pending orders past `expires_at`.
- `TICKET_SIGNING_SECRET` must stay the same for as long as tickets are valid.
  Rotating it invalidates every QR already sent. The helpers refuse a secret
  shorter than 32 characters.
- One ticket per order. Several tickets per order and refunds from the admin
  are deliberately out of scope (`TECH_DEBT.md`).
- The race tests run on real SQLite (`node:sqlite`). They prove the conditional
  WHERE clauses, not D1's own concurrency, which relies on SQLite's per-statement
  atomicity.
