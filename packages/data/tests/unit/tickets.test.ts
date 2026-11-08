import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_LIVE_HOLDS_PER_IP,
  MAX_TICKETS_PER_ORDER,
  attachStripeSession,
  checkIn,
  confirmOrder,
  countLiveHoldsForIp,
  countRecoverRequests,
  expireOrder,
  findPaidOrdersByEmail,
  getActiveTier,
  getOrderBySession,
  getTicket,
  listOrderTickets,
  listOrders,
  listPaidOrders,
  recordTicketEmail,
  releaseUnstartedOrder,
  reserveSeat,
  wasOrderEmailedSince,
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
async function reserve(
  tierId: string,
  orderId: string,
  now = NOW,
  ipHash = `ip-${orderId}`,
  quantity = 1,
) {
  return reserveSeat(db, { tierId, orderId, quantity, ipHash, now, expiresAt: now + HOLD });
}

/** Reserves, attaches a session and confirms: one paid order and its tickets' ids, in seat order. */
async function buyMany(tierId: string, orderId: string, quantity: number) {
  await reserve(tierId, orderId, NOW, `ip-${orderId}`, quantity);
  await attachStripeSession(db, orderId, `cs_${orderId}`);
  const ticketIds = await confirmOrder(db, {
    stripeSessionId: `cs_${orderId}`,
    email: `${orderId}@example.com`,
    name: `Buyer ${orderId}`,
    paidAt: NOW + 1000,
  });
  if (ticketIds.length !== quantity) throw new Error("confirmOrder created the wrong number");
  return ticketIds;
}

/** One paid order of one ticket; returns the ticket's id. */
async function buy(tierId: string, orderId: string) {
  const [ticketId] = await buyMany(tierId, orderId, 1);
  if (!ticketId) throw new Error("confirmOrder created no ticket");
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
    expect(seat).toEqual({
      orderId: "o1",
      tierId: "a",
      eventId: EVENT,
      quantity: 1,
      unitPence: 1000,
      amountPence: 1000,
    });
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

describe("reserveSeat with several tickets", () => {
  it("holds quantity seats in one order and charges price × quantity", async () => {
    addTier("a", 10, 1, 800);
    const seat = await reserve("a", "o1", NOW, "ip-o1", 3);
    expect(seat).toMatchObject({ quantity: 3, unitPence: 800, amountPence: 2400 });
    const row = db.raw
      .prepare("SELECT quantity, amount_pence FROM ticket_orders WHERE id = 'o1'")
      .get();
    expect({ ...row }).toEqual({ quantity: 3, amount_pence: 2400 });
    const { tiers } = await getActiveTier(db, EVENT, NOW);
    expect(tiers[0]).toMatchObject({ held: 3, paid: 0, left: 7 });
  });

  it("refuses more seats than the tier has left, and takes exactly what's left", async () => {
    addTier("a", 5, 1);
    await reserve("a", "first", NOW, "ip-1", 3);
    expect(await reserve("a", "too-many", NOW, "ip-2", 3)).toBeNull();
    expect(await reserve("a", "exact", NOW, "ip-2", 2)).not.toBeNull();
    expect((await getActiveTier(db, EVENT, NOW)).active).toBeNull();
  });

  it("lets only one of two reservations take seats the tier can hold once", async () => {
    addTier("a", 4, 1);
    const results = await Promise.all([
      reserve("a", "o1", NOW, "ip-1", 3),
      reserve("a", "o2", NOW, "ip-2", 3),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const held = db.raw.prepare("SELECT SUM(quantity) AS n FROM ticket_orders").get() as {
      n: number;
    };
    expect(held.n).toBe(3);
  });

  it(`refuses 0, a fraction or more than ${MAX_TICKETS_PER_ORDER} tickets`, async () => {
    addTier("a", 50, 1);
    for (const quantity of [0, 1.5, MAX_TICKETS_PER_ORDER + 1]) {
      expect(await reserve("a", `o${quantity}`, NOW, "ip", quantity)).toBeNull();
    }
    expect(await reserve("a", "max", NOW, "ip", MAX_TICKETS_PER_ORDER)).not.toBeNull();
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
      orderId: "o1",
      status: "paid",
      eventId: EVENT,
      tierName: "a",
      quantity: 1,
      amountPence: 1200,
      name: "Buyer o1",
      email: "o1@example.com",
    });
    expect(await getOrderBySession(db, "cs_none")).toBeNull();
  });
});

describe("getTicket and listOrderTickets", () => {
  it("returns a paid order's ticket with its seat and order, in seat order", async () => {
    addTier("a", 5, 1, 1000);
    const [first, , third] = await buyMany("a", "o1", 3);
    if (!first || !third) throw new Error("expected three tickets");
    expect(await getTicket(db, third)).toEqual({
      ticketId: third,
      orderId: "o1",
      seq: 2,
      quantity: 3,
      eventId: EVENT,
      tierName: "a",
      name: "Buyer o1",
      checkedInAt: null,
    });
    await checkIn(db, { ticketId: first, by: "door@example.com", now: NOW + 5000 });
    expect((await getTicket(db, first))?.checkedInAt).toBe(NOW + 5000);
    expect((await listOrderTickets(db, "o1")).map((t) => t.seq)).toEqual([0, 1, 2]);
    expect(await listOrderTickets(db, "none")).toEqual([]);
  });

  it("returns null for an unknown ticket or one of a refunded order", async () => {
    addTier("a", 1, 1);
    const ticketId = await buy("a", "o1");
    expect(await getTicket(db, "nope")).toBeNull();
    db.raw.prepare("UPDATE ticket_orders SET status = 'refunded' WHERE id = 'o1'").run();
    expect(await getTicket(db, ticketId)).toBeNull();
  });
});

describe("findPaidOrdersByEmail", () => {
  it("groups a buyer's paid orders with their tickets, matching the email in any case", async () => {
    addTier("a", 10, 1);
    await buyMany("a", "o1", 2);
    await buyMany("a", "o2", 1);
    // o3 belongs to someone else; o4 is this buyer's but never paid.
    await buy("a", "o3");
    await reserve("a", "o4");
    db.raw.prepare("UPDATE ticket_orders SET email = 'O1@Example.com' WHERE id = 'o2'").run();

    const orders = await findPaidOrdersByEmail(db, "o1@EXAMPLE.com");
    expect(orders.map((o) => [o.orderId, o.quantity, o.tickets.map((t) => t.seq)])).toEqual([
      ["o1", 2, [0, 1]],
      ["o2", 1, [0]],
    ]);
    expect(await findPaidOrdersByEmail(db, "nobody@example.com")).toEqual([]);
  });
});

describe("ticket email records", () => {
  it("counts a connection's recovery requests, matched or not, since a time", async () => {
    addTier("a", 1, 1);
    await buy("a", "o1");
    await recordTicketEmail(db, {
      orderId: null,
      kind: "recover",
      ipHash: "ip",
      sent: false,
      now: NOW,
    });
    await recordTicketEmail(db, {
      orderId: "o1",
      kind: "recover",
      ipHash: "ip",
      sent: true,
      now: NOW + 1,
    });
    await recordTicketEmail(db, {
      orderId: "o1",
      kind: "purchase",
      ipHash: null,
      sent: true,
      now: NOW + 2,
    });
    await recordTicketEmail(db, {
      orderId: null,
      kind: "recover",
      ipHash: "other",
      sent: false,
      now: NOW + 3,
    });
    expect(await countRecoverRequests(db, "ip", NOW)).toBe(2);
    expect(await countRecoverRequests(db, "ip", NOW + 1)).toBe(1);
    expect(await countRecoverRequests(db, "ip", NOW + 2)).toBe(0);
  });

  it("says whether an order was emailed since a time, counting only accepted sends", async () => {
    addTier("a", 1, 1);
    await buy("a", "o1");
    await recordTicketEmail(db, {
      orderId: "o1",
      kind: "recover",
      ipHash: "ip",
      sent: false,
      now: NOW,
    });
    expect(await wasOrderEmailedSince(db, "o1", NOW - 1)).toBe(false);
    await recordTicketEmail(db, {
      orderId: "o1",
      kind: "purchase",
      ipHash: null,
      sent: true,
      now: NOW,
    });
    expect(await wasOrderEmailedSince(db, "o1", NOW - 1)).toBe(true);
    expect(await wasOrderEmailedSince(db, "o1", NOW + 1)).toBe(false);
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

    expect(first).toEqual([expect.any(String)]);
    expect(second).toEqual([]);
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
    expect(tickets.map((t) => t.id)).toEqual(first);
  });

  it("creates one ticket per seat, numbered from 0, and none on a replay", async () => {
    addTier("a", 10, 1);
    const ids = await buyMany("a", "o1", 3);
    expect(new Set(ids).size).toBe(3);
    const replay = await confirmOrder(db, {
      stripeSessionId: "cs_o1",
      email: null,
      name: null,
      paidAt: NOW,
    });
    expect(replay).toEqual([]);
    const rows = db.raw
      .prepare("SELECT id, seq FROM tickets WHERE order_id = 'o1' ORDER BY seq")
      .all();
    expect(rows.map((r) => ({ ...r }))).toEqual(ids.map((id, seq) => ({ id, seq })));
  });

  it("fills in only the missing seats of an order paid with some tickets", async () => {
    addTier("a", 10, 1);
    await reserve("a", "o1", NOW, "ip-o1", 3);
    await attachStripeSession(db, "o1", "cs_o1");
    db.raw
      .prepare("UPDATE ticket_orders SET status = 'paid', paid_at = ? WHERE id = 'o1'")
      .run(NOW);
    db.raw.prepare("INSERT INTO tickets (id, order_id, seq) VALUES ('kept', 'o1', 0)").run();

    const created = await confirmOrder(db, {
      stripeSessionId: "cs_o1",
      email: null,
      name: null,
      paidAt: NOW,
    });

    expect(created).toHaveLength(2);
    const seqs = db.raw
      .prepare("SELECT id, seq FROM tickets WHERE order_id = 'o1' ORDER BY seq")
      .all()
      .map((r) => ({ ...r }));
    expect(seqs).toEqual([
      { id: "kept", seq: 0 },
      { id: created[0], seq: 1 },
      { id: created[1], seq: 2 },
    ]);
  });

  it("creates the missing ticket for an order already paid without one", async () => {
    addTier("a", 1, 1);
    await reserve("a", "o1");
    await attachStripeSession(db, "o1", "cs_o1");
    db.raw
      .prepare("UPDATE ticket_orders SET status = 'paid', paid_at = ? WHERE id = 'o1'")
      .run(NOW);

    const ticketIds = await confirmOrder(db, {
      stripeSessionId: "cs_o1",
      email: "a@example.com",
      name: "A",
      paidAt: NOW,
    });

    expect(ticketIds).toEqual([expect.any(String)]);
    const count = db.raw.prepare("SELECT COUNT(*) AS n FROM tickets").get() as { n: number };
    expect(count.n).toBe(1);
  });

  it("creates nothing for an unknown session", async () => {
    expect(
      await confirmOrder(db, { stripeSessionId: "cs_none", email: null, name: null, paidAt: NOW }),
    ).toEqual([]);
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
    expect(
      soldOut.tiers.map((t) => ({ id: t.id, paid: t.paid, held: t.held, left: t.left })),
    ).toEqual([
      { id: "early", paid: 1, held: 0, left: 0 },
      { id: "second", paid: 0, held: 1, left: 0 },
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
        seq: 0,
        quantity: 1,
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

describe("listPaidOrders with several tickets", () => {
  it("lists one row per ticket, in seat order, each checked in on its own", async () => {
    addTier("a", 10, 1, 800);
    const ids = await buyMany("a", "o1", 3);
    await checkIn(db, { ticketId: ids[1] as string, by: "door@example.com", now: NOW + 50 });

    const rows = await listPaidOrders(db, EVENT);
    expect(
      rows.map((r) => ({
        ticketId: r.ticketId,
        seq: r.seq,
        quantity: r.quantity,
        amountPence: r.amountPence,
        checkedInAt: r.checkedInAt,
      })),
    ).toEqual([
      { ticketId: ids[0], seq: 0, quantity: 3, amountPence: 2400, checkedInAt: null },
      { ticketId: ids[1], seq: 1, quantity: 3, amountPence: 2400, checkedInAt: NOW + 50 },
      { ticketId: ids[2], seq: 2, quantity: 3, amountPence: 2400, checkedInAt: null },
    ]);
  });
});

describe("listOrders", () => {
  it("lists every order once whatever its status, newest first, with tickets in", async () => {
    addTier("a", 10, 1, 800);
    const ids = await buyMany("a", "o1", 3);
    await checkIn(db, { ticketId: ids[0] as string, by: "door@example.com", now: NOW + 50 });
    await checkIn(db, { ticketId: ids[2] as string, by: "door@example.com", now: NOW + 60 });
    await reserve("a", "o2", NOW + 10, "ip-o2", 2);
    await reserve("a", "o3", NOW + 20);
    await attachStripeSession(db, "o3", "cs_o3");
    await expireOrder(db, "cs_o3");

    const orders = await listOrders(db, EVENT);

    expect(
      orders.map((o) => ({
        orderId: o.orderId,
        status: o.status,
        quantity: o.quantity,
        amountPence: o.amountPence,
        createdAt: o.createdAt,
        ticketsIn: o.ticketsIn,
      })),
    ).toEqual([
      {
        orderId: "o3",
        status: "expired",
        quantity: 1,
        amountPence: 800,
        createdAt: NOW + 20,
        ticketsIn: 0,
      },
      {
        orderId: "o2",
        status: "pending",
        quantity: 2,
        amountPence: 1600,
        createdAt: NOW + 10,
        ticketsIn: 0,
      },
      {
        orderId: "o1",
        status: "paid",
        quantity: 3,
        amountPence: 2400,
        createdAt: NOW,
        ticketsIn: 2,
      },
    ]);
    expect(orders[2]).toMatchObject({
      name: "Buyer o1",
      email: "o1@example.com",
      tierName: "a",
      paidAt: NOW + 1000,
      expiresAt: NOW + HOLD,
    });
  });

  it("lists only the event's own orders", async () => {
    addTier("a", 10, 1);
    await buy("a", "o1");
    expect(await listOrders(db, "other-event")).toEqual([]);
  });
});
