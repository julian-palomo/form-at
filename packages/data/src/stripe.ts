// The two calls ticket sales make to Stripe, with plain `fetch` and Web Crypto
// instead of the Stripe SDK: creating a Checkout Session, and verifying a
// webhook's `Stripe-Signature` header. Decision record:
// docs/adr/2026-11-08-stripe-checkout-and-signed-ticket-token.md.
//
// Server-only. The secret key and the webhook secret are always parameters,
// read from the Cloudflare env by the caller; nothing here reads the
// environment, and nothing that imports this may reach the client bundle.

const STRIPE_API = "https://api.stripe.com/v1";

/**
 * Pinned so a change to the account's default API version can't change what
 * these requests mean. `name_collection` needs this version or later.
 */
export const STRIPE_API_VERSION = "2025-09-30.clover";

/** A webhook older or newer than this is refused, which stops a captured one being replayed. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export type CheckoutSessionParams = {
  orderId: string;
  /** Shown on Stripe's page and receipt, e.g. "Form:at 004 · early". */
  productName: string;
  amountPence: number;
  /** Unix seconds. Stripe accepts 30 minutes to 24 hours from now. */
  expiresAt: number;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutSession = { id: string; url: string };

/** The form-encoded body for `POST /v1/checkout/sessions`. Exported for tests. */
export function checkoutSessionBody(params: CheckoutSessionParams): URLSearchParams {
  return new URLSearchParams({
    mode: "payment",
    // Cards only (Apple Pay and Google Pay ride on them): a card payment is
    // settled when the session completes. A delayed method such as a bank
    // debit would complete the session before the money arrives.
    "payment_method_types[0]": "card",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "gbp",
    "line_items[0][price_data][unit_amount]": String(params.amountPence),
    "line_items[0][price_data][product_data][name]": params.productName,
    // Required: the door list finds buyers by name, and Checkout only asks
    // for one when told to.
    "name_collection[individual][enabled]": "true",
    customer_creation: "if_required",
    client_reference_id: params.orderId,
    "metadata[order_id]": params.orderId,
    expires_at: String(params.expiresAt),
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
  });
}

/**
 * Creates a hosted Checkout Session. Throws on any non-2xx response or a
 * response without `id`/`url`. The order id is the idempotency key, so a
 * retried request can't create a second session for one order.
 */
export async function createCheckoutSession(
  secretKey: string,
  params: CheckoutSessionParams,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckoutSession> {
  const response = await fetchImpl(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
      "Idempotency-Key": `checkout-${params.orderId}`,
    },
    body: checkoutSessionBody(params),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      json && typeof json === "object" && "error" in json
        ? String((json as { error?: { message?: unknown } }).error?.message ?? "")
        : "";
    throw new Error(`Stripe ${response.status}${message ? `: ${message}` : ""}`);
  }
  if (
    json &&
    typeof json === "object" &&
    typeof (json as { id?: unknown }).id === "string" &&
    typeof (json as { url?: unknown }).url === "string"
  ) {
    const { id, url } = json as { id: string; url: string };
    return { id, url };
  }
  throw new Error("Stripe returned a Checkout Session without id or url");
}

const encoder = new TextEncoder();
const HEX_SHA256 = /^[0-9a-f]{64}$/;

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * Checks a webhook's `Stripe-Signature` header (`t=<unix>,v1=<hex>[,v1=…]`)
 * against the raw request body: HMAC-SHA256 of `${t}.${rawBody}` with the
 * endpoint's signing secret must match one `v1`, and `t` must be within
 * SIGNATURE_TOLERANCE_SECONDS of `nowSeconds`.
 *
 * `rawBody` must be the exact bytes Stripe sent (`await request.text()`),
 * read before anything parses it: re-serialised JSON never matches.
 * `crypto.subtle.verify` does the comparison, so timing doesn't reveal how
 * close a forged signature was.
 */
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  nowSeconds: number,
): Promise<boolean> {
  if (!header || !secret) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t" && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === "v1" && HEX_SHA256.test(value)) signatures.push(value);
  }
  if (timestamp === null || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = encoder.encode(`${timestamp}.${rawBody}`);
  for (const signature of signatures) {
    if (await crypto.subtle.verify("HMAC", key, hexToBytes(signature), signed)) return true;
  }
  return false;
}
