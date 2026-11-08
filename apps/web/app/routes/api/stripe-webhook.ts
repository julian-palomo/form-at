import { verifyStripeSignature } from "@form-at/data/stripe";
import {
  confirmOrder,
  expireOrder,
  getOrderBySession,
  listOrderTickets,
} from "@form-at/data/tickets";
import { createFileRoute } from "@tanstack/react-router";
import { type TicketEnv, deliverOrderTickets } from "~/data/tickets";

// Stripe's webhook for ticket sales. The ONLY place an order becomes `paid`:
// never mark one paid anywhere else (CLAUDE.md §1), because only here is the
// payment proven by Stripe's signature.
//
// Order of operations matters:
// 1. Read the raw body with `request.text()` before anything parses it. The
//    signature covers the exact bytes; re-serialised JSON never matches.
// 2. Verify the signature. Invalid or missing → 400 and nothing else runs.
// 3. Write to D1, and only then answer 200. A D1 failure answers 500, so
//    Stripe retries; confirmOrder and expireOrder are safe to repeat.
// 4. Email the ticket links, only when this delivery created tickets, so a
//    replay sends nothing. A failed email never fails the webhook: the order
//    is paid, the failure is recorded, and the buyer can recover the links.

type WebhookEnv = TicketEnv;

/** Emails the order's ticket links. Never throws: the payment is confirmed whatever happens here. */
async function emailTickets(
  db: D1Database,
  env: WebhookEnv,
  sessionId: string,
  origin: string,
  nowMs: number,
  fetchImpl: typeof fetch,
): Promise<void> {
  try {
    const order = await getOrderBySession(db, sessionId);
    if (!order || order.status !== "paid") return;
    if (!order.email) {
      console.error(`[tickets] order ${order.orderId} has no email; nothing sent`);
      return;
    }
    const tickets = await listOrderTickets(db, order.orderId);
    await deliverOrderTickets(
      env,
      {
        order: {
          orderId: order.orderId,
          eventId: order.eventId,
          tierName: order.tierName,
          name: order.name,
          email: order.email,
          tickets,
        },
        origin,
        kind: "purchase",
        ipHash: null,
        now: nowMs,
      },
      fetchImpl,
    );
  } catch (error) {
    console.error(`[tickets] email for session ${sessionId} not sent:`, error);
  }
}

type SessionObject = {
  id?: unknown;
  payment_status?: unknown;
  customer_details?: {
    email?: unknown;
    name?: unknown;
    individual_name?: unknown;
  } | null;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 200) : null;
}

/** The handler without the router, so tests can call it directly. */
export async function handleStripeWebhook(
  request: Request,
  env: WebhookEnv | undefined,
  nowMs: number,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const rawBody = await request.text();
  const secret = env?.STRIPE_WEBHOOK_SECRET ?? "";
  const valid = await verifyStripeSignature(
    rawBody,
    request.headers.get("Stripe-Signature"),
    secret,
    Math.floor(nowMs / 1000),
  );
  if (!valid) return new Response("Invalid signature", { status: 400 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid body", { status: 400 });
  }
  if (typeof parsed !== "object" || parsed === null) {
    return new Response("Invalid body", { status: 400 });
  }
  const event = parsed as { type?: unknown; data?: { object?: SessionObject } | null };

  const type = event.type;
  if (type !== "checkout.session.completed" && type !== "checkout.session.expired") {
    return new Response(null, { status: 200 });
  }
  const session = event.data?.object;
  const sessionId = str(session?.id);
  if (!sessionId) return new Response("No session id", { status: 400 });

  const db = env?.DB;
  if (!db) return new Response("Database unavailable", { status: 500 });

  try {
    if (type === "checkout.session.completed") {
      // A completed session isn't necessarily paid (a delayed payment method
      // completes first and settles later). Only `paid` confirms; anything
      // else leaves the order pending, and its hold lapses on its own.
      if (session?.payment_status !== "paid") return new Response(null, { status: 200 });
      const details = session?.customer_details ?? null;
      // Paid even if the order's hold lapsed: the buyer paid, so the tier may
      // go one over its cap rather than refuse a paying customer.
      const created = await confirmOrder(db, {
        stripeSessionId: sessionId,
        email: str(details?.email),
        name: str(details?.individual_name) ?? str(details?.name),
        paidAt: nowMs,
      });
      if (created.length > 0) {
        await emailTickets(db, env ?? {}, sessionId, new URL(request.url).origin, nowMs, fetchImpl);
      }
    } else {
      await expireOrder(db, sessionId);
    }
  } catch {
    return new Response("Database error", { status: 500 });
  }
  return new Response(null, { status: 200 });
}

export const Route = createFileRoute("/api/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const cf = (context as unknown as Record<string, unknown>).cloudflare as
          | { env?: WebhookEnv }
          | undefined;
        return handleStripeWebhook(request, cf?.env, Date.now());
      },
    },
  },
});
