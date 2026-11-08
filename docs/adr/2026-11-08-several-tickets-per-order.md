# Several tickets per order, one ticket row per seat

- **Status:** Accepted
- **Date:** 2026-11-08

## Context

The first ticket design sold one ticket per order: `tickets.order_id` was
UNIQUE, and a buyer who wanted two checked out twice
([2026-11-08-stripe-checkout-and-signed-ticket-token.md](2026-11-08-stripe-checkout-and-signed-ticket-token.md)).
That was a shortcut to reach test mode by 15 Nov, not a product choice. Form:at
is a small collective whose buyers mostly come in groups of friends, and
resale isn't a concern for it. Test mode worked end to end on 8 Nov, before
any live sale, so the tables could still change cheaply.

## Decision

An order holds 1 to 10 tickets (`ticket_orders.quantity`,
`MAX_TICKETS_PER_ORDER`), all in the tier on sale, at its price;
`amount_pence` is the order's total. Seats are counted as `SUM(quantity)`.
Each seat gets its own `tickets` row, numbered by `seq` from 0, with
`UNIQUE (order_id, seq)` in place of `UNIQUE (order_id)`, so each person gets
their own ticket (and, later, their own QR) and is checked in on their own.

## Alternatives considered

- **No cap on quantity.** One abandoned checkout of 30 would keep a whole tier
  of 15 off sale for about 36 minutes. Ten bounds that without getting in a
  group's way.
- **One ticket row per order, with a count of people let in.** Simpler tables,
  but one QR for a whole group means the group must arrive together, and a
  partial check-in needs its own counter.
- **Splitting one purchase across two tiers** (2 at £8, 2 at £10). Stripe
  takes it as two line items, but every place that shows an order's tier and
  price would need to handle a mix. A buyer who asks for more than a tier has
  left is told what's left instead.

## Consequences

- Every seat count sums `quantity`; a `COUNT(*)` over orders is now a bug.
- `confirmOrder` creates up to `quantity` tickets in its batch, one
  conditional INSERT per seat, and returns the ids it created, so a replayed
  webhook still creates nothing and a half-written order is repaired.
- The `tickets` table had to be rebuilt in D1 (SQLite can't drop a UNIQUE
  constraint): create, copy as seat 0, drop, rename. It was done before live
  sales, while a failed webhook in the gap was harmless.
- The door list and its CSV are one row per ticket ("2 of 3").
