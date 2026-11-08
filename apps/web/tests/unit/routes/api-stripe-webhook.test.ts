// @vitest-environment node
import { createHmac } from "node:crypto";
import { attachStripeSession, reserveSeat } from "@form-at/data/tickets";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

function stripeEvent(type: string, sessionId: string, paymentStatus = "paid") {
  return JSON.stringify({
    id: "evt_1",
    type,
    data: {
      object: {
        id: sessionId,
        payment_status: paymentStatus,
        customer_details: {
          email: "buyer@example.com",
          name: "Card Name",
          individual_name: "Ada Buyer",
        },
      },
    },
  });
}

/** The full sales env, with Resend answering through `resend`; without it no email is attempted. */
function post(
  body: string,
  signature: string | null = sign(body),
  resend?: ReturnType<typeof vi.fn>,
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (signature) headers.set("Stripe-Signature", signature);
  return handleStripeWebhook(
    new Request("https://example.com/api/stripe-webhook", { method: "POST", headers, body }),
    {
      DB: db,
      STRIPE_WEBHOOK_SECRET: SECRET,
      STRIPE_SECRET_KEY: "sk_test_x",
      TICKET_SIGNING_SECRET: "test-signing-secret-of-at-least-32-chars",
      ...(resend ? { RESEND_API_KEY: "re_test" } : {}),
    },
    NOW_MS,
    (resend ?? vi.fn()) as unknown as typeof fetch,
  );
}

function resendOk() {
  return vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
}

function emailSends() {
  return db.raw
    .prepare("SELECT kind, sent FROM ticket_email_sends ORDER BY created_at")
    .all() as Array<{ kind: string; sent: number }>;
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
    quantity: 1,
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

  it("leaves the order pending when the session completed without being paid", async () => {
    const res = await post(stripeEvent("checkout.session.completed", "cs_test_1", "unpaid"));
    expect(res.status).toBe(200);
    expect(order("cs_test_1").status).toBe("pending");
    expect(ticketCount()).toBe(0);
  });

  it("creates one ticket when Stripe delivers the same event twice", async () => {
    const body = stripeEvent("checkout.session.completed", "cs_test_1");
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    expect(ticketCount()).toBe(1);
  });

  it("creates one ticket per seat for an order of several, and none more on a replay", async () => {
    await reserveSeat(db, {
      tierId: TIER,
      orderId: "order-3",
      quantity: 3,
      ipHash: "ip-3",
      now: NOW_MS,
      expiresAt: NOW_MS + 36 * 60 * 1000,
    });
    await attachStripeSession(db, "order-3", "cs_test_3");
    const body = stripeEvent("checkout.session.completed", "cs_test_3");
    expect((await post(body)).status).toBe(200);
    expect((await post(body)).status).toBe(200);
    const seqs = db.raw
      .prepare("SELECT seq FROM tickets WHERE order_id = 'order-3' ORDER BY seq")
      .all()
      .map((r) => r.seq);
    expect(seqs).toEqual([0, 1, 2]);
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

  it("answers 400 for a signed body that isn't a JSON object", async () => {
    expect((await post("null")).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
  });

  it("answers 200 and ignores event types it doesn't handle", async () => {
    const res = await post(stripeEvent("payment_intent.succeeded", "cs_test_1"));
    expect(res.status).toBe(200);
    expect(order("cs_test_1").status).toBe("pending");
  });

  it("emails the buyer's ticket links once, on the delivery that created the tickets", async () => {
    await reserveSeat(db, {
      tierId: TIER,
      orderId: "order-3",
      quantity: 3,
      ipHash: "ip-3",
      now: NOW_MS,
      expiresAt: NOW_MS + 36 * 60 * 1000,
    });
    await attachStripeSession(db, "order-3", "cs_test_3");
    const body = stripeEvent("checkout.session.completed", "cs_test_3");
    const resend = resendOk();
    expect((await post(body, sign(body), resend)).status).toBe(200);
    expect((await post(body, sign(body), resend)).status).toBe(200);
    expect(resend).toHaveBeenCalledTimes(1);
    const init = (resend.mock.calls[0] as unknown[])[1] as RequestInit;
    const sent = JSON.parse(String(init.body)) as { to: string[]; subject: string; text: string };
    expect(sent.to).toEqual(["buyer@example.com"]);
    expect(sent.subject).toBe("your tickets for Form:at 004");
    expect(
      sent.text.match(/https:\/\/example\.com\/tickets\/[a-z0-9-]+\.[A-Za-z0-9_-]{43}/g),
    ).toHaveLength(3);
    expect(emailSends()).toEqual([{ kind: "purchase", sent: 1 }]);
  });

  it("keeps the order paid and answers 200 when the email can't be sent", async () => {
    const body = stripeEvent("checkout.session.completed", "cs_test_1");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const resend = vi.fn(async () => new Response("down", { status: 500 }));
    expect((await post(body, sign(body), resend)).status).toBe(200);
    quiet.mockRestore();
    expect(order("cs_test_1").status).toBe("paid");
    expect(ticketCount()).toBe(1);
    expect(emailSends()).toEqual([{ kind: "purchase", sent: 0 }]);
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
