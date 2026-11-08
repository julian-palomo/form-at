// @vitest-environment node
import { createHmac } from "node:crypto";
import { attachStripeSession, reserveSeat } from "@form-at/data/tickets";
import { beforeEach, describe, expect, it } from "vitest";
import { handleStripeWebhook } from "~/routes/api/stripe-webhook";
import { type TestD1, createTestD1 } from "../../../../../packages/data/tests/helpers/sqliteD1";

// The webhook end to end against real SQLite built from schema.sql: a signed
// Stripe event in, the order's row out. Signatures are made with Node's
// crypto the way Stripe's docs describe them, independently of the code under
// test. No network.

const SECRET = "whsec_test_secret_for_unit_tests";
const NOW_MS = 1_800_000_000_000;
const TIER = "format-004-early";

let db: TestD1;

function sign(body: string, t = Math.floor(NOW_MS / 1000), secret = SECRET) {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

function stripeEvent(type: string, sessionId: string) {
  return JSON.stringify({
    id: "evt_1",
    type,
    data: {
      object: {
        id: sessionId,
        customer_details: {
          email: "buyer@example.com",
          name: "Card Name",
          individual_name: "Ada Buyer",
        },
      },
    },
  });
}

function post(body: string, signature: string | null = sign(body)) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (signature) headers.set("Stripe-Signature", signature);
  return handleStripeWebhook(
    new Request("https://example.com/api/stripe-webhook", { method: "POST", headers, body }),
    { DB: db, STRIPE_WEBHOOK_SECRET: SECRET },
    NOW_MS,
  );
}

function order(sessionId: string) {
  return db.raw
    .prepare("SELECT status, email, name, paid_at FROM ticket_orders WHERE stripe_session_id = ?")
    .get(sessionId) as {
    status: string;
    email: string | null;
    name: string | null;
    paid_at: number | null;
  };
}

function ticketCount() {
  return (db.raw.prepare("SELECT COUNT(*) AS n FROM tickets").get() as { n: number }).n;
}

beforeEach(async () => {
  db = createTestD1();
  await reserveSeat(db, {
    tierId: TIER,
    orderId: "order-1",
    ipHash: "ip-1",
    now: NOW_MS,
    expiresAt: NOW_MS + 36 * 60 * 1000,
  });
  await attachStripeSession(db, "order-1", "cs_test_1");
});

describe("handleStripeWebhook", () => {
  it("marks the order paid on checkout.session.completed, with the individual name", async () => {
    const res = await post(stripeEvent("checkout.session.completed", "cs_test_1"));
    expect(res.status).toBe(200);
    expect(order("cs_test_1")).toEqual({
      status: "paid",
      email: "buyer@example.com",
      name: "Ada Buyer",
      paid_at: NOW_MS,
    });
    expect(ticketCount()).toBe(1);
  });

  it("creates one ticket when Stripe delivers the same event twice", async () => {
    const body = stripeEvent("checkout.session.completed", "cs_test_1");
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    expect(ticketCount()).toBe(1);
  });

  it("frees the seat on checkout.session.expired", async () => {
    expect((await post(stripeEvent("checkout.session.expired", "cs_test_1"))).status).toBe(200);
    expect(order("cs_test_1").status).toBe("expired");
  });

  it("leaves a paid order paid when an expired event arrives after it", async () => {
    await post(stripeEvent("checkout.session.completed", "cs_test_1"));
    expect((await post(stripeEvent("checkout.session.expired", "cs_test_1"))).status).toBe(200);
    expect(order("cs_test_1").status).toBe("paid");
    expect(ticketCount()).toBe(1);
  });

  it("answers 400 and writes nothing when the signature is wrong or missing", async () => {
    const body = stripeEvent("checkout.session.completed", "cs_test_1");
    expect((await post(body, sign(body, undefined, "whsec_someone_else"))).status).toBe(400);
    expect((await post(body, null)).status).toBe(400);
    expect((await post(`${body} `, sign(body))).status).toBe(400);
    expect(order("cs_test_1").status).toBe("pending");
    expect(ticketCount()).toBe(0);
  });

  it("answers 200 and ignores event types it doesn't handle", async () => {
    const res = await post(stripeEvent("payment_intent.succeeded", "cs_test_1"));
    expect(res.status).toBe(200);
    expect(order("cs_test_1").status).toBe("pending");
  });

  it("answers 500 without a database, so Stripe retries", async () => {
    const body = stripeEvent("checkout.session.completed", "cs_test_1");
    const res = await handleStripeWebhook(
      new Request("https://example.com/api/stripe-webhook", {
        method: "POST",
        headers: { "Stripe-Signature": sign(body) },
        body,
      }),
      { STRIPE_WEBHOOK_SECRET: SECRET },
      NOW_MS,
    );
    expect(res.status).toBe(500);
  });
});
