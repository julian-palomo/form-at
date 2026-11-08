// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECKOUT_SESSION_SECONDS,
  type TicketEnv,
  loadAvailability,
  loadOrderView,
  startCheckoutFor,
} from "~/data/tickets";
import { type TestD1, createTestD1 } from "../../../../../packages/data/tests/helpers/sqliteD1";

// The buyer's side of ticket sales against real SQLite built from schema.sql,
// which seeds Form:at 004's tiers. Stripe is a mocked fetch: no network.

const EVENT = "format-004";
const NOW = 1_800_000_000_000;
const ORIGIN = "https://preview.example.pages.dev";

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

function checkout(fetchImpl: typeof fetch, ip = "203.0.113.7") {
  return startCheckoutFor(env, { eventId: EVENT, ip, origin: ORIGIN, now: NOW }, fetchImpl);
}

beforeEach(() => {
  db = createTestD1();
  env = {
    DB: db,
    STRIPE_SECRET_KEY: "test-key",
    STRIPE_WEBHOOK_SECRET: "test-webhook",
    TICKET_SIGNING_SECRET: "test-signing",
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
        { eventId: "no-such-event", ip: null, origin: ORIGIN, now: NOW },
        fetchImpl,
      ),
    ).toEqual({ status: "unavailable" });
    expect(orders()).toHaveLength(0);
  });
});

describe("loadAvailability", () => {
  it("shows the active tier's name and price", async () => {
    expect(await loadAvailability(env, EVENT, NOW)).toEqual({
      eventId: EVENT,
      active: { name: expect.any(String), pricePence: 800 },
    });
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
      amountPence: 800,
      name: null,
    });
    expect(await loadOrderView(env, "cs_test_unknown")).toBeNull();
  });
});
