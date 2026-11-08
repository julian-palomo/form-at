# Tickets live on the device and in emailed links, with no buyer accounts

- **Status:** Accepted
- **Date:** 2026-11-08

## Context

A paid order has one signed token per ticket (`<ticketId>.<signature>`, see
[the first ticketing ADR](2026-11-08-stripe-checkout-and-signed-ticket-token.md)).
The buyer has to be able to show that token as a QR at the door of a basement
with no signal, weeks after paying, on whichever phone they bring, and get it
back if they lose it. The site has no user accounts and we don't want to add
them for a 150-ticket night: a login is friction at the door and a password
reset flow is more code than the tickets themselves.

Stripe emails a receipt, but that receipt isn't the ticket, and Stripe doesn't
email a link we control.

## Decision

The token is both the ticket and the key to it, so wherever the token is seen,
the ticket is kept:

- **`/tickets/<token>`** verifies the signature before reading D1, shows the QR
  and the facts, and stores the ticket in the app's persisted store on that
  device. A forged or mistyped token is a plain 404.
- **`/tickets`** draws every stored ticket's QR from the store alone, with no
  loader, so it works offline. The QR is drawn in the browser from the token
  with `uqr` (MIT, no dependencies, small), loaded lazily.
- **One email per paid order**, sent from the Stripe webhook when it creates
  the order's tickets, with one link per ticket so the buyer can forward each
  one. The provider is **Resend** (free tier about 3,000 emails a month and
  100 a day at the time of writing, verified sending domain
  `formatglasgow.com`), called with plain `fetch` behind one function and an
  idempotency key per order. The email carries links only, no inline QR.
- **"Recover my tickets"** on `/tickets` re-sends the links for every paid
  order with that email for an upcoming night. The answer is the same whether
  or not anything matched; attempts are counted per connection and per order
  in `ticket_email_sends`.

## Alternatives considered

- **Buyer accounts** (email + magic link): the same email flow plus a session
  layer, for a page the token already unlocks. Lost.
- **A QR image generated on the server** and attached to the email: Gmail
  blocks `data:` images, CID attachments need multipart assembly, and the
  image would still have to exist offline on the phone. The link-plus-page
  gets the ticket onto the device in one tap instead.
- **Storing the ticket in Stripe's receipt** (custom fields): the receipt is
  Stripe's page, not ours, and isn't available offline.
- **Postmark** as the provider: a free tier of about 100 emails a month at the
  time of writing, too tight for 150 tickets plus recoveries. MailChannels is
  no longer free from Workers.
- **Encoding the ticket facts in the token** so the page needs no D1 read:
  it would still need D1 for the check-in state, and a longer token makes a
  denser QR.

## Consequences

- A ticket is as safe as the device and inbox that hold it. Anyone with the
  link has the ticket, which is also what lets a buyer hand one to a friend.
  The door scans each ticket once, so a shared link admits one person.
- Clearing the browser's site data loses the stored tickets; the email and
  the recover form bring them back. Private-mode browsers never keep them.
- `TICKET_SIGNING_SECRET` must be identical on the web and admin Pages
  projects, and can't be rotated while tickets are valid.
- A failed send leaves the order paid and a `sent = 0` row in
  `ticket_email_sends`; the admin's sales list resends it. Without
  `RESEND_API_KEY` set, every send is recorded as failed and sales still work.
- `uqr` joins the web bundle as a lazy chunk; `jsqr` is a dev dependency that
  decodes the drawn QR in a unit test so the page and the door's scanner agree.
