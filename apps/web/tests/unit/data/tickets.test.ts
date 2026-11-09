import { signTicketToken } from "@form-at/data/ticketToken";
// @vitest-environment node
import { confirmOrder, listOrderTickets } from "@form-at/data/tickets";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECKOUT_SESSION_SECONDS,
  MAX_RECOVER_REQUESTS_PER_HOUR,
  RECOVER_COOLDOWN_MS,
  type TicketEnv,
  deliverOrderTickets,
  loadAvailability,
  loadOrderView,
  loadTicketPage,
  recoverTicketsFor,
  startCheckoutFor,
} from "~/data/tickets";
import { type TestD1, createTestD1 } from "../../../../../packages/data/tests/helpers/sqliteD1";

// The buyer's side of ticket sales against real SQLite built from schema.sql,
// which seeds Form:at 004's tiers. Stripe is a mocked fetch: no network.

const EVENT = "format-004";
const NOW = 1_800_000_000_000;
const ORIGIN = "https://preview.example.pages.dev";
/** 32+ characters, as signTicketToken requires. */
const SIGNING_SECRET = "test-signing-secret-of-at-least-32-chars";

let db: TestD1;
let env: TicketEnv;

function stripeOk(sessionId = "cs_test_ok") {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({ id: sessionId, url: `https://checkout.stripe.com/c/${sessionId}` }),
        {
          status: 200,
        },
      ),
  );
}

function stripeDown() {
  return vi.fn(
    async () => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 500 }),
  );
}

function setCap(tierId: string, cap: number) {
  db.raw.prepare("UPDATE ticket_tiers SET cap = ? WHERE id = ?").run(cap, tierId);
}

function orders() {
  return db.raw
    .prepare(
      "SELECT tier_id, status, stripe_session_id, expires_at FROM ticket_orders ORDER BY created_at",
    )
    .all() as Array<{
    tier_id: string;
    status: string;
    stripe_session_id: string | null;
    expires_at: number;
  }>;
}

function checkout(fetchImpl: typeof fetch, ip = "203.0.113.7", quantity = 1) {
  return startCheckoutFor(
    env,
    { eventId: EVENT, quantity, ip, origin: ORIGIN, now: NOW },
    fetchImpl,
  );
}

beforeEach(() => {
  db = createTestD1();
  env = {
    DB: db,
    STRIPE_SECRET_KEY: "test-key",
    STRIPE_WEBHOOK_SECRET: "test-webhook",
    TICKET_SIGNING_SECRET: SIGNING_SECRET,
  };
});

describe("startCheckoutFor", () => {
  it("holds a seat in the first tier and redirects to Stripe with return URLs on this origin", async () => {
    const fetchImpl = stripeOk();
    const result = await checkout(fetchImpl as unknown as typeof fetch);
    expect(result).toEqual({ status: "redirect", url: "https://checkout.stripe.com/c/cs_test_ok" });

    const [only] = orders();
    expect(only).toMatchObject({
      tier_id: "format-004-early",
      status: "pending",
      stripe_session_id: "cs_test_ok",
    });
    // The hold outlives Stripe's session, so the expired webhook frees it first.
    expect(only?.expires_at).toBeGreaterThan(NOW + CHECKOUT_SESSION_SECONDS * 1000);

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(body.get("success_url")).toBe(
      `${ORIGIN}/tickets/success?session_id={CHECKOUT_SESSION_ID}`,
    );
    expect(body.get("cancel_url")).toBe(`${ORIGIN}/events/${EVENT}`);
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("800");
  });

  it("moves on to the next tier when the first is full", async () => {
    setCap("format-004-early", 0);
    await checkout(stripeOk() as unknown as typeof fetch);
    expect(orders()[0]?.tier_id).toBe("format-004-second");
  });

  it("answers sold_out when every tier is full, without calling Stripe", async () => {
    for (const id of ["format-004-early", "format-004-second", "format-004-general"]) setCap(id, 0);
    const fetchImpl = stripeOk();
    expect(await checkout(fetchImpl as unknown as typeof fetch)).toEqual({ status: "sold_out" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("gives the seat back when Stripe fails", async () => {
    expect(await checkout(stripeDown() as unknown as typeof fetch)).toEqual({ status: "error" });
    expect(orders()[0]?.status).toBe("expired");
  });

  it("answers too_many_holds once one connection has three unpaid checkouts", async () => {
    for (let i = 0; i < 3; i++) {
      const result = await checkout(stripeOk(`cs_test_${i}`) as unknown as typeof fetch);
      expect(result.status).toBe("redirect");
    }
    expect(await checkout(stripeOk("cs_test_4") as unknown as typeof fetch)).toEqual({
      status: "too_many_holds",
    });
    // Another connection still gets a seat.
    expect(
      (await checkout(stripeOk("cs_test_5") as unknown as typeof fetch, "198.51.100.1")).status,
    ).toBe("redirect");
  });

  it("answers unavailable when a secret is missing or the event is unknown", async () => {
    const fetchImpl = stripeOk() as unknown as typeof fetch;
    env = { DB: db, STRIPE_SECRET_KEY: "test-key" };
    expect(await checkout(fetchImpl)).toEqual({ status: "unavailable" });
    env = {
      DB: db,
      STRIPE_SECRET_KEY: "test-key",
      STRIPE_WEBHOOK_SECRET: "test-webhook",
      TICKET_SIGNING_SECRET: "test-signing",
    };
    expect(
      await startCheckoutFor(
        env,
        { eventId: "no-such-event", quantity: 1, ip: null, origin: ORIGIN, now: NOW },
        fetchImpl,
      ),
    ).toEqual({ status: "unavailable" });
    expect(orders()).toHaveLength(0);
  });

  it("charges several tickets at the tier's unit price in one checkout", async () => {
    const fetchImpl = stripeOk();
    const result = await checkout(fetchImpl as unknown as typeof fetch, "203.0.113.7", 3);
    expect(result.status).toBe("redirect");

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    expect(body.get("line_items[0][quantity]")).toBe("3");
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("800");
    const row = db.raw.prepare("SELECT quantity, amount_pence FROM ticket_orders").get();
    expect({ ...row }).toEqual({ quantity: 3, amount_pence: 2400 });
  });

  it("answers fewer_left with what's on sale when the tier can't take the quantity, without calling Stripe", async () => {
    setCap("format-004-early", 2);
    const fetchImpl = stripeOk();
    expect(await checkout(fetchImpl as unknown as typeof fetch, "203.0.113.7", 3)).toEqual({
      status: "fewer_left",
      availability: {
        eventId: EVENT,
        active: { name: "early", pricePence: 800, maxQuantity: 2 },
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(orders()).toHaveLength(0);
  });
});

describe("loadAvailability", () => {
  it("shows the active tier's name and price", async () => {
    expect(await loadAvailability(env, EVENT, NOW)).toEqual({
      eventId: EVENT,
      active: { name: expect.any(String), pricePence: 800, maxQuantity: 10 },
    });
  });

  it("caps maxQuantity at what's left in the tier", async () => {
    setCap("format-004-early", 4);
    expect((await loadAvailability(env, EVENT, NOW))?.active?.maxQuantity).toBe(4);
  });

  it("shows sold out when every tier is full", async () => {
    for (const id of ["format-004-early", "format-004-second", "format-004-general"]) setCap(id, 0);
    expect(await loadAvailability(env, EVENT, NOW)).toEqual({ eventId: EVENT, active: null });
  });

  it("hides the block for an event without tiers, or when sales are off", async () => {
    expect(await loadAvailability(env, "format-003", NOW)).toBeNull();
    expect(await loadAvailability({ DB: db }, EVENT, NOW)).toBeNull();
    expect(await loadAvailability(undefined, EVENT, NOW)).toBeNull();
  });
});

describe("loadOrderView", () => {
  it("shows a pending order with the event's details, and null for an unknown session", async () => {
    await checkout(stripeOk("cs_test_view") as unknown as typeof fetch);
    expect(await loadOrderView(env, "cs_test_view")).toMatchObject({
      status: "pending",
      eventTitle: "Form:at 004",
      venue: "Stereo, City Centre, Glasgow",
      quantity: 1,
      amountPence: 800,
      name: null,
    });
    expect(await loadOrderView(env, "cs_test_unknown")).toBeNull();
  });

  it("returns a paid order's tickets as signed tokens, in seat order", async () => {
    await pay("cs_test_paid", 2);
    const view = await loadOrderView(env, "cs_test_paid");
    const tickets = await listOrderTickets(db, view ? await orderIdOf("cs_test_paid") : "");
    expect(view?.tickets).toEqual([
      { token: await signTicketToken(tickets[0]?.id ?? "", SIGNING_SECRET), seq: 0 },
      { token: await signTicketToken(tickets[1]?.id ?? "", SIGNING_SECRET), seq: 1 },
    ]);
  });
});

/** A checkout paid through the real queries, the way the webhook does it. Returns the ticket ids. */
async function pay(sessionId: string, quantity = 1, email = "buyer@example.com") {
  const result = await checkout(
    stripeOk(sessionId) as unknown as typeof fetch,
    undefined,
    quantity,
  );
  if (result.status !== "redirect") throw new Error(`checkout answered ${result.status}`);
  return confirmOrder(db, { stripeSessionId: sessionId, email, name: "Ada Buyer", paidAt: NOW });
}

async function orderIdOf(sessionId: string): Promise<string> {
  const row = db.raw
    .prepare("SELECT id FROM ticket_orders WHERE stripe_session_id = ?")
    .get(sessionId) as { id: string };
  return row.id;
}

function emailSends() {
  return db.raw
    .prepare("SELECT order_id, kind, ip_hash, sent FROM ticket_email_sends ORDER BY created_at")
    .all() as Array<{
    order_id: string | null;
    kind: string;
    ip_hash: string | null;
    sent: number;
  }>;
}

/** A Resend that accepts everything, recording each request's body. */
function resendOk() {
  return vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
}

function resendDown() {
  return vi.fn(async () => new Response(JSON.stringify({ message: "nope" }), { status: 500 }));
}

function sentTo(fetchImpl: ReturnType<typeof vi.fn>): string[] {
  return fetchImpl.mock.calls.map((call) => {
    const init = (call as unknown[])[1] as RequestInit;
    return (JSON.parse(String(init.body)) as { to: string[] }).to[0] ?? "";
  });
}

describe("loadTicketPage", () => {
  it("shows a paid ticket for a valid token, with its place in the order", async () => {
    const [, second] = await pay("cs_test_page", 3);
    const token = await signTicketToken(second ?? "", SIGNING_SECRET);
    expect(await loadTicketPage(env, token)).toEqual({
      token,
      eventId: EVENT,
      eventTitle: "Form:at 004",
      date: "2026-12-05",
      venue: "Stereo, City Centre, Glasgow",
      runtime: "23:00 — 04:00",
      tierName: "early",
      name: "Ada Buyer",
      seq: 1,
      quantity: 3,
      checkedInAt: null,
    });
  });

  it("answers null for a forged token, an unknown ticket, or when sales are off", async () => {
    const [ticketId] = await pay("cs_test_page");
    const token = await signTicketToken(ticketId ?? "", SIGNING_SECRET);
    // A last character that differs from the real one, whatever it is.
    const forged = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(await loadTicketPage(env, forged)).toBeNull();
    expect(
      await loadTicketPage(env, await signTicketToken("not-a-ticket", SIGNING_SECRET)),
    ).toBeNull();
    expect(await loadTicketPage({ ...env, STRIPE_SECRET_KEY: undefined }, token)).toBeNull();
  });
});

describe("deliverOrderTickets", () => {
  async function paidOrder(sessionId: string, quantity: number) {
    await pay(sessionId, quantity);
    const orderId = await orderIdOf(sessionId);
    return {
      orderId,
      eventId: EVENT,
      tierName: "early",
      name: "Ada Buyer",
      email: "buyer@example.com",
      tickets: await listOrderTickets(db, orderId),
    };
  }

  it("emails one link per ticket on this origin and records the send", async () => {
    const order = await paidOrder("cs_test_mail", 2);
    const fetchImpl = resendOk();
    const sent = await deliverOrderTickets(
      { ...env, RESEND_API_KEY: "re_test" },
      { order, origin: ORIGIN, kind: "purchase", ipHash: null, now: NOW },
      fetchImpl as unknown as typeof fetch,
    );
    expect(sent).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe(`ticket-${order.orderId}`);
    const body = JSON.parse(String(init.body)) as { to: string[]; text: string };
    expect(body.to).toEqual(["buyer@example.com"]);
    for (const ticket of order.tickets) {
      expect(body.text).toContain(
        `${ORIGIN}/tickets/${await signTicketToken(ticket.id, SIGNING_SECRET)}`,
      );
    }
    expect(emailSends()).toEqual([
      { order_id: order.orderId, kind: "purchase", ip_hash: null, sent: 1 },
    ]);
  });

  it("records a failed or impossible send as not sent, without throwing", async () => {
    const order = await paidOrder("cs_test_mail", 1);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      await deliverOrderTickets(
        { ...env, RESEND_API_KEY: "re_test" },
        { order, origin: ORIGIN, kind: "purchase", ipHash: null, now: NOW },
        resendDown() as unknown as typeof fetch,
      ),
    ).toBe(false);
    expect(
      await deliverOrderTickets(
        env,
        { order, origin: ORIGIN, kind: "purchase", ipHash: null, now: NOW + 1 },
        resendOk() as unknown as typeof fetch,
      ),
    ).toBe(false);
    quiet.mockRestore();
    expect(emailSends().map((s) => s.sent)).toEqual([0, 0]);
  });
});

describe("recoverTicketsFor", () => {
  // NOW in this file is after Form:at 004; recovery only emails tickets for
  // nights still to come, so these run two weeks before it.
  const BEFORE = Date.UTC(2026, 10, 21, 12);
  const mailEnv = () => ({ ...env, RESEND_API_KEY: "re_test" });
  const recover = (
    email: string,
    fetchImpl: ReturnType<typeof vi.fn>,
    ip = "203.0.113.7",
    now = BEFORE,
  ) =>
    recoverTicketsFor(
      mailEnv(),
      { email, ip, origin: ORIGIN, now },
      fetchImpl as unknown as typeof fetch,
    );

  it("answers the same for a buyer's email and a stranger's, emailing only the buyer", async () => {
    await pay("cs_test_a", 2, "Buyer@Example.com");
    const fetchImpl = resendOk();
    expect(await recover("buyer@example.com", fetchImpl)).toEqual({ status: "ok" });
    expect(await recover("stranger@example.com", fetchImpl, "198.51.100.9")).toEqual({
      status: "ok",
    });
    expect(sentTo(fetchImpl)).toEqual(["Buyer@Example.com"]);
    expect(emailSends().map((s) => [s.kind, s.order_id !== null, s.sent])).toEqual([
      ["recover", true, 1],
      ["recover", false, 0],
    ]);
  });

  it("emails an order again only after the cooldown", async () => {
    await pay("cs_test_a", 1);
    const fetchImpl = resendOk();
    await recover("buyer@example.com", fetchImpl, "203.0.113.1");
    await recover("buyer@example.com", fetchImpl, "203.0.113.2", BEFORE + RECOVER_COOLDOWN_MS - 1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await recover("buyer@example.com", fetchImpl, "203.0.113.3", BEFORE + RECOVER_COOLDOWN_MS + 1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops answering one connection after its hourly limit, matched or not", async () => {
    await pay("cs_test_a", 1);
    const fetchImpl = resendOk();
    for (let i = 0; i < MAX_RECOVER_REQUESTS_PER_HOUR; i++) {
      await recover(`nobody-${i}@example.com`, fetchImpl, "203.0.113.7", BEFORE + i);
    }
    await recover("buyer@example.com", fetchImpl, "203.0.113.7", BEFORE + 10);
    expect(fetchImpl).not.toHaveBeenCalled();
    await recover("buyer@example.com", fetchImpl, "203.0.113.7", BEFORE + 60 * 60 * 1000 + 1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("skips orders for a night that has passed, and answers unavailable with sales off", async () => {
    await pay("cs_test_a", 1);
    const fetchImpl = resendOk();
    const afterTheNight = Date.UTC(2026, 11, 6, 12);
    expect(await recover("buyer@example.com", fetchImpl, "203.0.113.7", afterTheNight)).toEqual({
      status: "ok",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      await recoverTicketsFor(
        { DB: db },
        { email: "a@b.c", ip: null, origin: ORIGIN, now: BEFORE },
      ),
    ).toEqual({ status: "unavailable" });
  });
});
