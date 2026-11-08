import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  STRIPE_API_VERSION,
  checkoutSessionBody,
  createCheckoutSession,
  verifyStripeSignature,
} from "~/stripe";

// Signatures are built here with Node's crypto, independently of the Web
// Crypto code under test, the way Stripe's docs describe them:
// HMAC-SHA256(secret, `${t}.${body}`) in hex. No network anywhere.

const SECRET = "whsec_test_secret_for_unit_tests";
const BODY = JSON.stringify({ id: "evt_1", type: "checkout.session.completed" });
const NOW = 1_800_000_000;

function sign(body: string, t: number, secret = SECRET) {
  return createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
}

describe("verifyStripeSignature", () => {
  it("accepts a correctly signed body", async () => {
    const header = `t=${NOW},v1=${sign(BODY, NOW)}`;
    expect(await verifyStripeSignature(BODY, header, SECRET, NOW)).toBe(true);
  });

  it("accepts when any one of several v1 signatures matches (secret rotation)", async () => {
    const header = `t=${NOW},v1=${"0".repeat(64)},v1=${sign(BODY, NOW)},v0=${"f".repeat(64)}`;
    expect(await verifyStripeSignature(BODY, header, SECRET, NOW)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const header = `t=${NOW},v1=${sign(BODY, NOW)}`;
    expect(await verifyStripeSignature(`${BODY} `, header, SECRET, NOW)).toBe(false);
  });

  it("rejects a signature made with another secret", async () => {
    const header = `t=${NOW},v1=${sign(BODY, NOW, "whsec_someone_else")}`;
    expect(await verifyStripeSignature(BODY, header, SECRET, NOW)).toBe(false);
  });

  it("rejects a timestamp more than 5 minutes away, either side", async () => {
    const old = NOW - 301;
    expect(await verifyStripeSignature(BODY, `t=${old},v1=${sign(BODY, old)}`, SECRET, NOW)).toBe(
      false,
    );
    const future = NOW + 301;
    expect(
      await verifyStripeSignature(BODY, `t=${future},v1=${sign(BODY, future)}`, SECRET, NOW),
    ).toBe(false);
    const edge = NOW - 300;
    expect(await verifyStripeSignature(BODY, `t=${edge},v1=${sign(BODY, edge)}`, SECRET, NOW)).toBe(
      true,
    );
  });

  it.each([
    null,
    "",
    "garbage",
    `v1=${"a".repeat(64)}`,
    `t=${NOW}`,
    `t=abc,v1=${"a".repeat(64)}`,
    `t=${NOW},v1=not-hex`,
  ])("rejects a missing or malformed header %j", async (header) => {
    expect(await verifyStripeSignature(BODY, header, SECRET, NOW)).toBe(false);
  });

  it("rejects everything when the secret is empty", async () => {
    const header = `t=${NOW},v1=${sign(BODY, NOW, "")}`;
    expect(await verifyStripeSignature(BODY, header, "", NOW)).toBe(false);
  });
});

const PARAMS = {
  orderId: "order-1",
  productName: "Form:at 004 · early",
  amountPence: 800,
  expiresAt: NOW + 1800,
  successUrl: "https://example.com/tickets/success?session_id={CHECKOUT_SESSION_ID}",
  cancelUrl: "https://example.com/events/format-004",
};

describe("checkoutSessionBody", () => {
  it("asks for one ticket at the tier's price in GBP, with the buyer's name required", () => {
    const body = Object.fromEntries(checkoutSessionBody(PARAMS));
    expect(body).toMatchObject({
      mode: "payment",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "gbp",
      "line_items[0][price_data][unit_amount]": "800",
      "line_items[0][price_data][product_data][name]": "Form:at 004 · early",
      "name_collection[individual][enabled]": "true",
      "metadata[order_id]": "order-1",
      client_reference_id: "order-1",
      expires_at: String(NOW + 1800),
      success_url: PARAMS.successUrl,
      cancel_url: PARAMS.cancelUrl,
    });
    expect(body).not.toHaveProperty("name_collection[individual][optional]");
  });

  it("keeps Stripe's {CHECKOUT_SESSION_ID} placeholder literal once encoded and decoded", () => {
    const encoded = checkoutSessionBody(PARAMS).toString();
    expect(new URLSearchParams(encoded).get("success_url")).toContain("{CHECKOUT_SESSION_ID}");
  });
});

describe("createCheckoutSession", () => {
  it("POSTs the form with the key, pinned API version and an idempotency key, and returns id + url", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" }),
    );
    const session = await createCheckoutSession("sk_test_x", PARAMS, fetchImpl);

    expect(session).toEqual({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer sk_test_x",
      "Stripe-Version": STRIPE_API_VERSION,
      "Idempotency-Key": "checkout-order-1",
    });
  });

  it("throws with Stripe's message on an error response", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { message: "Invalid expires_at" } }, { status: 400 }),
    );
    await expect(createCheckoutSession("sk_test_x", PARAMS, fetchImpl)).rejects.toThrow(
      "Stripe 400: Invalid expires_at",
    );
  });

  it("throws when a 200 response has no url", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ id: "cs_test_1" }));
    await expect(createCheckoutSession("sk_test_x", PARAMS, fetchImpl)).rejects.toThrow();
  });
});
