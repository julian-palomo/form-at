import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_LIVE_HOLDS_PER_IP,
  attachStripeSession,
  checkIn,
  confirmOrder,
  countLiveHoldsForIp,
  expireOrder,
  getActiveTier,
  getOrderBySession,
  listPaidOrders,
  releaseUnstartedOrder,
  reserveSeat,
} from "~/tickets";
import { type TestD1, createTestD1 } from "../helpers/sqliteD1";

// Runs the shared ticket queries against real SQLite built from
// apps/web/schema.sql (see the helper for what that can and can't prove).
// These lock the rules that stop overselling and double counting: capacity is
// counted from orders, and every state change is conditional on the current
// state, so a Stripe webhook delivered twice changes nothing the second time.

const EVENT = "test-event";
const NOW = 1_800_000_000_000;
const HOLD = 35 * 60 * 1000;

let db: TestD1;

function addTier(id: string, cap: number, sortOrder: number, pricePence = 800) {
  db.raw
    .prepare(
      "INSERT INTO ticket_tiers (id, event_id, name, price_pence, cap, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(id, EVENT, id, pricePence, cap, sortOrder);
}

// Each order gets its own IP hash unless a test passes one, so the per-IP
// hold cap only applies where a test means it to.
async function reserve(tierId: string, orderId: string, now = NOW, ipHash = `ip-${orderId}`) {
  return reserveSeat(db, { tierId, orderId, ipHash, now, expiresAt: now + HOLD });
}

/** Reserves, attaches a session and confirms: one paid order with a ticket. */
async function buy(tierId: string, orderId: string) {
  await reserve(tierId, orderId);
  await attachStripeSession(db, orderId, `cs_${orderId}`);
  const ticketId = await confirmOrder(db, {
    stripeSessionId: `cs_${orderId}`,
    email: `${orderId}@example.com`,
    name: `Buyer ${orderId}`,
    paidAt: NOW + 1000,
  });
  if (!ticketId) throw new Error("confirmOrder returned null");
  return ticketId;
}

beforeEach(() => {
  db = createTestD1();
});

describe("schema seed", () => {
  it("seeds Form:at 004's three tiers: 15 at £8, 15 at £10, 120 at £12", () => {
    const rows = db.raw
      .prepare(
        "SELECT id, price_pence, cap, sort_order FROM ticket_tiers WHERE event_id = 'format-004' ORDER BY sort_order",
      )
      .all();
    expect(rows.map((r) => ({ ...r }))).toEqual([
      { id: "format-004-early", price_pence: 800, cap: 15, sort_order: 1 },
      { id: "format-004-second", price_pence: 1000, cap: 15, sort_order: 2 },
      { id: "format-004-general", price_pence: 1200, cap: 120, sort_order: 3 },
    ]);
  });
});

describe("reserveSeat", () => {
  it("creates a pending order at the tier's price", async () => {
    addTier("a", 2, 1, 1000);
    const seat = await reserve("a", "o1");
    expect(seat).toEqual({ orderId: "o1", tierId: "a", eventId: EVENT, amountPence: 1000 });
    const row = db.raw
      .prepare("SELECT status, amount_pence, expires_at FROM ticket_orders WHERE id = 'o1'")
      .get();
    expect({ ...row }).toEqual({ status: "pending", amount_pence: 1000, expires_at: NOW + HOLD });
  });

  it("lets only one of two reservations take the last seat", async () => {
    addTier("a", 1, 1);
    const results = await Promise.all([reserve("a", "o1"), reserve("a", "o2")]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const count = db.raw.prepare("SELECT COUNT(*) AS n FROM ticket_orders").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("refuses a seat in a full tier, counting paid and unexpired pending orders", async () => {
    addTier("a", 2, 1);
    await buy("a", "paid");
    await reserve("a", "held");
    expect(await reserve("a", "late")).toBeNull();
  });

  it("frees the seat of a pending order once its expires_at has passed", async () => {
    addTier("a", 1, 1);
    await reserve("a", "abandoned");
    expect(await reserve("a", "o2", NOW + HOLD - 1)).toBeNull();
    expect(await reserve("a", "o2", NOW + HOLD)).not.toBeNull();
  });

  it("frees the seat of an expired order", async () => {
    addTier("a", 1, 1);
    await reserve("a", "o1");
    await attachStripeSession(db, "o1", "cs_o1");
    await expireOrder(db, "cs_o1");
    expect(await reserve("a", "o2")).not.toBeNull();
  });

  it("returns null for a tier that doesn't exist", async () => {
    expect(await reserve("missing", "o1")).toBeNull();
  });
});

describe("reserveSeat per-IP hold cap", () => {
  it("refuses a hold once one IP hash has the maximum unpaid holds open", async () => {
    addTier("a", 50, 1);
    for (let i = 0; i < MAX_LIVE_HOLDS_PER_IP; i++) {
      expect(await reserve("a", `o${i}`, NOW, "same-ip")).not.toBeNull();
    }
    expect(await reserve("a", "one-too-many", NOW, "same-ip")).toBeNull();
    expect(await countLiveHoldsForIp(db, "same-ip", NOW)).toBe(MAX_LIVE_HOLDS_PER_IP);
    expect(await reserve("a", "other-ip", NOW, "another-ip")).not.toBeNull();
  });

  it("stops counting a hold once it expires or is paid", async () => {
    addTier("a", 50, 1);
    for (let i = 0; i < MAX_LIVE_HOLDS_PER_IP; i++) await reserve("a", `o${i}`, NOW, "same-ip");
    expect(await reserve("a", "later", NOW + HOLD, "same-ip")).not.toBeNull();

    await attachStripeSession(db, "later", "cs_later");
    await confirmOrder(db, {
      stripeSessionId: "cs_later",
      email: null,
      name: null,
      paidAt: NOW + HOLD,
    });
    expect(await countLiveHoldsForIp(db, "same-ip", NOW + HOLD)).toBe(0);
  });
});

describe("releaseUnstartedOrder", () => {
  it("frees the seat of an order that never got a Checkout Session", async () => {
    addTier("a", 1, 1);
    await reserve("a", "o1");
    expect(await releaseUnstartedOrder(db, "o1")).toBe(true);
    expect(await reserve("a", "o2")).not.toBeNull();
  });

  it("leaves an order with a session alone", async () => {
    addTier("a", 1, 1);
    await reserve("a", "o1");
    await attachStripeSession(db, "o1", "cs_o1");
    expect(await releaseUnstartedOrder(db, "o1")).toBe(false);
  });
});

describe("getOrderBySession", () => {
  it("returns the order's status and tier, or null for an unknown session", async () => {
    addTier("a", 1, 1, 1200);
    await buy("a", "o1");
    expect(await getOrderBySession(db, "cs_o1")).toEqual({
      status: "paid",
      eventId: EVENT,
      tierName: "a",
      amountPence: 1200,
      name: "Buyer o1",
    });
    expect(await getOrderBySession(db, "cs_none")).toBeNull();
  });
});

describe("attachStripeSession", () => {
  it("attaches once and refuses to overwrite a session", async () => {
    addTier("a", 1, 1);
    await reserve("a", "o1");
    expect(await attachStripeSession(db, "o1", "cs_1")).toBe(true);
    expect(await attachStripeSession(db, "o1", "cs_2")).toBe(false);
  });
});

describe("confirmOrder", () => {
  it("marks the order paid and creates exactly one ticket when delivered twice", async () => {
    addTier("a", 1, 1);
    await reserve("a", "o1");
    await attachStripeSession(db, "o1", "cs_o1");
    const input = { stripeSessionId: "cs_o1", email: "a@example.com", name: "A", paidAt: NOW + 5 };

    const first = await confirmOrder(db, input);
    const second = await confirmOrder(db, input);

    expect(first).toEqual(expect.any(String));
    expect(second).toBeNull();
    const order = db.raw
      .prepare("SELECT status, email, name, paid_at FROM ticket_orders WHERE id = 'o1'")
      .get();
    expect({ ...order }).toEqual({
      status: "paid",
      email: "a@example.com",
      name: "A",
      paid_at: NOW + 5,
    });
    const tickets = db.raw.prepare("SELECT id FROM tickets WHERE order_id = 'o1'").all();
    expect(tickets.map((t) => t.id)).toEqual([first]);
  });

  it("creates the missing ticket for an order already paid without one", async () => {
    addTier("a", 1, 1);
    await reserve("a", "o1");
    await attachStripeSession(db, "o1", "cs_o1");
    db.raw
      .prepare("UPDATE ticket_orders SET status = 'paid', paid_at = ? WHERE id = 'o1'")
      .run(NOW);

    const ticketId = await confirmOrder(db, {
      stripeSessionId: "cs_o1",
      email: "a@example.com",
      name: "A",
      paidAt: NOW,
    });

    expect(ticketId).toEqual(expect.any(String));
    const count = db.raw.prepare("SELECT COUNT(*) AS n FROM tickets").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("returns null for an unknown session", async () => {
    expect(
      await confirmOrder(db, { stripeSessionId: "cs_none", email: null, name: null, paidAt: NOW }),
    ).toBeNull();
  });
});

describe("expireOrder", () => {
  it("expires a pending order once", async () => {
    addTier("a", 1, 1);
    await reserve("a", "o1");
    await attachStripeSession(db, "o1", "cs_o1");
    expect(await expireOrder(db, "cs_o1")).toBe(true);
    expect(await expireOrder(db, "cs_o1")).toBe(false);
  });

  it("changes nothing after the order is paid", async () => {
    addTier("a", 1, 1);
    await buy("a", "o1");
    expect(await expireOrder(db, "cs_o1")).toBe(false);
    const order = db.raw.prepare("SELECT status FROM ticket_orders WHERE id = 'o1'").get() as {
      status: string;
    };
    expect(order.status).toBe("paid");
  });
});

describe("getActiveTier", () => {
  it("returns the first tier with a free seat, then the next, then null when sold out", async () => {
    addTier("early", 1, 1, 800);
    addTier("second", 1, 2, 1000);

    expect((await getActiveTier(db, EVENT, NOW)).active?.id).toBe("early");
    await buy("early", "o1");
    expect((await getActiveTier(db, EVENT, NOW)).active?.id).toBe("second");
    await reserve("second", "o2");
    const soldOut = await getActiveTier(db, EVENT, NOW);
    expect(soldOut.active).toBeNull();
    expect(soldOut.tiers.map((t) => ({ id: t.id, paid: t.paid, held: t.held }))).toEqual([
      { id: "early", paid: 1, held: 0 },
      { id: "second", paid: 0, held: 1 },
    ]);
  });

  it("returns no tiers for an event without any", async () => {
    expect(await getActiveTier(db, "no-such-event", NOW)).toEqual({ active: null, tiers: [] });
  });
});

describe("checkIn", () => {
  it("checks a ticket in once and reports the first time on the second scan", async () => {
    addTier("a", 1, 1);
    const ticketId = await buy("a", "o1");

    expect(await checkIn(db, { ticketId, by: "door@example.com", now: NOW + 10 })).toEqual({
      status: "checked_in",
      checkedInAt: NOW + 10,
    });
    expect(await checkIn(db, { ticketId, by: "other@example.com", now: NOW + 20 })).toEqual({
      status: "already_used",
      checkedInAt: NOW + 10,
      checkedInBy: "door@example.com",
    });
  });

  it("rejects an unknown ticket", async () => {
    expect(await checkIn(db, { ticketId: "nope", by: "door@example.com", now: NOW })).toEqual({
      status: "not_valid",
    });
  });

  it("rejects the ticket of a refunded order", async () => {
    addTier("a", 1, 1);
    const ticketId = await buy("a", "o1");
    db.raw.prepare("UPDATE ticket_orders SET status = 'refunded' WHERE id = 'o1'").run();
    expect(await checkIn(db, { ticketId, by: "door@example.com", now: NOW })).toEqual({
      status: "not_valid",
    });
  });
});

describe("listPaidOrders", () => {
  it("lists paid orders only, with their tier and check-in state", async () => {
    addTier("a", 3, 1, 800);
    const ticketId = await buy("a", "o1");
    await reserve("a", "pending");
    await checkIn(db, { ticketId, by: "door@example.com", now: NOW + 50 });

    expect(await listPaidOrders(db, EVENT)).toEqual([
      {
        orderId: "o1",
        ticketId,
        name: "Buyer o1",
        email: "o1@example.com",
        tierName: "a",
        amountPence: 800,
        paidAt: NOW + 1000,
        checkedInAt: NOW + 50,
        checkedInBy: "door@example.com",
      },
    ]);
  });
});
