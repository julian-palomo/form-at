# Architecture decision records

This folder keeps a short record of every decision that shapes the project
from here on: what we chose, what else we looked at, and what the choice costs
us. Open an old codebase and the question is always "why is it like this?";
these files are the answer, written down at the time.

Decisions taken before this folder existed live in `PWA_PROGRESS.md`, whose
dated entries stay as they are. New decisions go here.

## How it works

- **One file per decision**, named with the date first and a short slug, for
  example `2026-11-10-stripe-checkout-and-signed-qr.md`. Sorting by name sorts
  by date.
- **Use [`template.md`](template.md)**: context, decision, alternatives
  considered, consequences.
- **Records are history.** Once a decision is accepted, its file isn't
  rewritten. If we change our minds, a new ADR explains the new decision and
  the old one gets a single line at the top: `Superseded by <new file>`, or
  `Partly superseded by <new file>: <what changed>` when the new ADR replaces
  only part of it.
- **Short is fine.** A good ADR is a page, not an essay.
- **Write it before the code when the decision is expensive to undo** (a
  payment provider, a token format, a table layout); otherwise in the same PR
  as the change.

## Decisions so far

| Date | Decision |
|---|---|
| 2026-11-08 | [Sell tickets with Stripe Checkout, counted capacity and a signed ticket token](2026-11-08-stripe-checkout-and-signed-ticket-token.md) |
| 2026-11-08 | [Several tickets per order, one ticket row per seat](2026-11-08-several-tickets-per-order.md) |
