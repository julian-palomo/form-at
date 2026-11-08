// Ticket sales queries, shared by apps/web (checkout and the Stripe webhook)
// and apps/admin (the door list). Tables and their reasoning: the ticket block
// at the end of apps/web/schema.sql. Decision record:
// docs/adr/2026-11-08-stripe-checkout-and-signed-ticket-token.md.
//
// Two rules hold every function here together. Keep both:
// - Capacity is counted from `ticket_orders`, never cached in a counter. A
//   seat is held by an order that is `paid`, or `pending` and not yet past
//   `expires_at` (SEAT_HELD below).
// - Every state change is one conditional statement (`WHERE status =
//   'pending'`, `WHERE checked_in_at IS NULL`) whose `meta.changes` says
//   whether it happened. Never split one into a read followed by a write:
//   two requests can both pass the read, which is how overselling and
//   double counting happen.

/** SQL condition for "this order holds a seat". Binds one parameter: now (unix ms). */
const SEAT_HELD = "(status = 'paid' OR (status = 'pending' AND expires_at > ?))";

export type TicketTier = {
  id: string;
  eventId: string;
  name: string;
  pricePence: number;
  cap: number;
  sortOrder: number;
  /** Orders paid for in this tier. */
  paid: number;
  /** Unpaid orders still holding a seat (checkout open). */
  held: number;
};

export type ActiveTier = {
  /** The first tier by sort order with a free seat; null when every tier is full. */
  active: TicketTier | null;
  /** Every tier of the event, in selling order, with its counts. */
  tiers: TicketTier[];
};

type TierRow = {
  id: string;
  event_id: string;
  name: string;
  price_pence: number;
  cap: number;
  sort_order: number;
  paid: number;
  held: number;
};

export async function getActiveTier(
  db: D1Database,
  eventId: string,
  now: number,
): Promise<ActiveTier> {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.event_id, t.name, t.price_pence, t.cap, t.sort_order,
         (SELECT COUNT(*) FROM ticket_orders o WHERE o.tier_id = t.id AND o.status = 'paid') AS paid,
         (SELECT COUNT(*) FROM ticket_orders o WHERE o.tier_id = t.id AND o.status = 'pending' AND o.expires_at > ?) AS held
       FROM ticket_tiers t
       WHERE t.event_id = ?
       ORDER BY t.sort_order`,
    )
    .bind(now, eventId)
    .all<TierRow>();

  const tiers = results.map(
    (r): TicketTier => ({
      id: r.id,
      eventId: r.event_id,
      name: r.name,
      pricePence: r.price_pence,
      cap: r.cap,
      sortOrder: r.sort_order,
      paid: r.paid,
      held: r.held,
    }),
  );
  return { active: tiers.find((t) => t.paid + t.held < t.cap) ?? null, tiers };
}

/** Unpaid holds one connection may have open at once. */
export const MAX_LIVE_HOLDS_PER_IP = 3;

/** Unpaid holds this connection still has open. Only for telling the buyer why a reservation was refused. */
export async function countLiveHoldsForIp(
  db: D1Database,
  ipHash: string,
  now: number,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM ticket_orders WHERE ip_hash = ? AND status = 'pending' AND expires_at > ?",
    )
    .bind(ipHash, now)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export type ReservedSeat = {
  orderId: string;
  tierId: string;
  eventId: string;
  /** The tier's price, copied onto the order; charge exactly this. */
  amountPence: number;
};

/**
 * Holds one seat in `tierId` by creating a `pending` order, if the tier has a
 * free seat. The only way a pending order is created.
 *
 * `expiresAt` is when the hold lapses if nobody pays: set it a few minutes
 * after the Stripe Checkout Session's own `expires_at`, so the seat is never
 * handed on while its first buyer can still pay.
 *
 * `ipHash` identifies the buyer's connection without storing the IP (the
 * caller HMACs it). Unpaid holds per hash are capped at MAX_LIVE_HOLDS_PER_IP,
 * because each abandoned checkout keeps a seat in a tier of 15 for its whole
 * hold. Use `countLiveHoldsForIp` to tell that refusal apart from a full tier.
 *
 * Returns null when the tier is full, doesn't exist, or the hash is at its
 * cap. One INSERT … SELECT whose WHERE counts the tier's held seats and the
 * hash's live holds, so two requests can't both take the last seat or the
 * last allowed hold.
 */
export async function reserveSeat(
  db: D1Database,
  input: { tierId: string; orderId: string; ipHash: string; now: number; expiresAt: number },
): Promise<ReservedSeat | null> {
  const result = await db
    .prepare(
      `INSERT INTO ticket_orders (id, event_id, tier_id, amount_pence, status, created_at, expires_at, ip_hash)
       SELECT ?, t.event_id, t.id, t.price_pence, 'pending', ?, ?, ?
       FROM ticket_tiers t
       WHERE t.id = ?
         AND (SELECT COUNT(*) FROM ticket_orders WHERE tier_id = t.id AND ${SEAT_HELD}) < t.cap
         AND (SELECT COUNT(*) FROM ticket_orders
              WHERE ip_hash = ? AND status = 'pending' AND expires_at > ?) < ${MAX_LIVE_HOLDS_PER_IP}`,
    )
    .bind(
      input.orderId,
      input.now,
      input.expiresAt,
      input.ipHash,
      input.tierId,
      input.now,
      input.ipHash,
      input.now,
    )
    .run();
  if (result.meta.changes !== 1) return null;

  const order = await db
    .prepare("SELECT event_id, amount_pence FROM ticket_orders WHERE id = ?")
    .bind(input.orderId)
    .first<{ event_id: string; amount_pence: number }>();
  if (!order) return null;
  return {
    orderId: input.orderId,
    tierId: input.tierId,
    eventId: order.event_id,
    amountPence: order.amount_pence,
  };
}

/**
 * Records the Checkout Session created for a reserved order. The session is
 * created after the seat is held, so its id arrives second. Returns false if
 * the order isn't pending or already has a session.
 */
export async function attachStripeSession(
  db: D1Database,
  orderId: string,
  stripeSessionId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE ticket_orders SET stripe_session_id = ?
       WHERE id = ? AND status = 'pending' AND stripe_session_id IS NULL`,
    )
    .bind(stripeSessionId, orderId)
    .run();
  return result.meta.changes === 1;
}

/**
 * Marks the order paid and creates its ticket, for the verified
 * `checkout.session.completed` webhook only. Never mark an order paid
 * anywhere else.
 *
 * Both statements run in one batch (one transaction). The ticket insert
 * selects orders that are `paid`, not just the one this call changed, so a
 * retry repairs an order left paid without a ticket; `tickets.order_id` is
 * UNIQUE, so it can never create a second one.
 *
 * Returns the new ticket's id when this call created it, and null when the
 * ticket already existed (a webhook delivered twice) or the session is unknown.
 */
export async function confirmOrder(
  db: D1Database,
  input: { stripeSessionId: string; email: string | null; name: string | null; paidAt: number },
): Promise<string | null> {
  const ticketId = crypto.randomUUID();
  const [, insert] = await db.batch([
    db
      .prepare(
        `UPDATE ticket_orders SET status = 'paid', email = ?, name = ?, paid_at = ?
         WHERE stripe_session_id = ? AND status = 'pending'`,
      )
      .bind(input.email, input.name, input.paidAt, input.stripeSessionId),
    db
      .prepare(
        `INSERT OR IGNORE INTO tickets (id, order_id)
         SELECT ?, id FROM ticket_orders WHERE stripe_session_id = ? AND status = 'paid'`,
      )
      .bind(ticketId, input.stripeSessionId),
  ]);
  return insert?.meta.changes === 1 ? ticketId : null;
}

/**
 * Gives back the seat of an order whose Checkout Session was never created
 * (Stripe refused or was unreachable). Only matches a pending order with no
 * session, so it can't cancel a checkout the buyer can still pay.
 */
export async function releaseUnstartedOrder(db: D1Database, orderId: string): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE ticket_orders SET status = 'expired' WHERE id = ? AND status = 'pending' AND stripe_session_id IS NULL",
    )
    .bind(orderId)
    .run();
  return result.meta.changes === 1;
}

/**
 * Marks a pending order expired, for the `checkout.session.expired` webhook.
 * Returns false when the order isn't pending (already paid, already expired,
 * or unknown), so a repeated webhook changes nothing.
 */
export async function expireOrder(db: D1Database, stripeSessionId: string): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE ticket_orders SET status = 'expired' WHERE stripe_session_id = ? AND status = 'pending'",
    )
    .bind(stripeSessionId)
    .run();
  return result.meta.changes === 1;
}

/**
 * - `checked_in`: this call let the ticket in.
 * - `already_used`: an earlier check-in did; the door shows when and who.
 * - `not_valid`: no such ticket, or its order isn't paid (e.g. refunded).
 */
export type CheckInResult =
  | { status: "checked_in"; checkedInAt: number }
  | { status: "already_used"; checkedInAt: number; checkedInBy: string | null }
  | { status: "not_valid" };

/**
 * Lets a ticket in once. The UPDATE only matches a ticket of a paid order
 * that hasn't been checked in, so two door phones scanning the same QR at
 * once can't both admit it. The admin route that calls this must call
 * `verifyAccessJwt` first.
 */
export async function checkIn(
  db: D1Database,
  input: { ticketId: string; by: string; now: number },
): Promise<CheckInResult> {
  const result = await db
    .prepare(
      `UPDATE tickets SET checked_in_at = ?, checked_in_by = ?
       WHERE id = ? AND checked_in_at IS NULL
         AND order_id IN (SELECT id FROM ticket_orders WHERE status = 'paid')`,
    )
    .bind(input.now, input.by, input.ticketId)
    .run();
  if (result.meta.changes === 1) return { status: "checked_in", checkedInAt: input.now };

  const existing = await db
    .prepare(
      `SELECT k.checked_in_at, k.checked_in_by FROM tickets k
       JOIN ticket_orders o ON o.id = k.order_id
       WHERE k.id = ? AND o.status = 'paid'`,
    )
    .bind(input.ticketId)
    .first<{ checked_in_at: number | null; checked_in_by: string | null }>();
  if (existing?.checked_in_at == null) return { status: "not_valid" };
  return {
    status: "already_used",
    checkedInAt: existing.checked_in_at,
    checkedInBy: existing.checked_in_by,
  };
}

export type PaidOrder = {
  orderId: string;
  ticketId: string | null;
  name: string | null;
  email: string | null;
  tierName: string;
  amountPence: number;
  paidAt: number | null;
  checkedInAt: number | null;
  checkedInBy: string | null;
};

type PaidOrderRow = {
  order_id: string;
  ticket_id: string | null;
  name: string | null;
  email: string | null;
  tier_name: string;
  amount_pence: number;
  paid_at: number | null;
  checked_in_at: number | null;
  checked_in_by: string | null;
};

/** Every paid order of an event, by buyer name, for the door list and the sales list. */
export async function listPaidOrders(db: D1Database, eventId: string): Promise<PaidOrder[]> {
  const { results } = await db
    .prepare(
      `SELECT o.id AS order_id, k.id AS ticket_id, o.name, o.email, t.name AS tier_name,
         o.amount_pence, o.paid_at, k.checked_in_at, k.checked_in_by
       FROM ticket_orders o
       JOIN ticket_tiers t ON t.id = o.tier_id
       LEFT JOIN tickets k ON k.order_id = o.id
       WHERE o.event_id = ? AND o.status = 'paid'
       ORDER BY o.name COLLATE NOCASE, o.paid_at`,
    )
    .bind(eventId)
    .all<PaidOrderRow>();

  return results.map((r) => ({
    orderId: r.order_id,
    ticketId: r.ticket_id,
    name: r.name,
    email: r.email,
    tierName: r.tier_name,
    amountPence: r.amount_pence,
    paidAt: r.paid_at,
    checkedInAt: r.checked_in_at,
    checkedInBy: r.checked_in_by,
  }));
}

export type OrderStatus = {
  status: "pending" | "paid" | "expired" | "refunded";
  eventId: string;
  tierName: string;
  amountPence: number;
  name: string | null;
};

/** One order by its Checkout Session id, for the page Stripe returns the buyer to; null when unknown. */
export async function getOrderBySession(
  db: D1Database,
  stripeSessionId: string,
): Promise<OrderStatus | null> {
  const row = await db
    .prepare(
      `SELECT o.status, o.event_id, t.name AS tier_name, o.amount_pence, o.name
       FROM ticket_orders o JOIN ticket_tiers t ON t.id = o.tier_id
       WHERE o.stripe_session_id = ?`,
    )
    .bind(stripeSessionId)
    .first<{
      status: OrderStatus["status"];
      event_id: string;
      tier_name: string;
      amount_pence: number;
      name: string | null;
    }>();
  if (!row) return null;
  return {
    status: row.status,
    eventId: row.event_id,
    tierName: row.tier_name,
    amountPence: row.amount_pence,
    name: row.name,
  };
}
