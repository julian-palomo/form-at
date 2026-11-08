import { getEvent } from "@form-at/data/events";
import { createCheckoutSession } from "@form-at/data/stripe";
import {
  MAX_LIVE_HOLDS_PER_IP,
  MAX_TICKETS_PER_ORDER,
  attachStripeSession,
  countLiveHoldsForIp,
  getActiveTier,
  getOrderBySession,
  releaseUnstartedOrder,
  reserveSeat,
} from "@form-at/data/tickets";
import { createServerFn } from "@tanstack/react-start";

// The buyer's side of ticket sales: what the event page shows, starting a
// Stripe Checkout, and the page Stripe returns the buyer to. The webhook that
// confirms payment is `routes/api/stripe-webhook.ts`.
//
// Every server function here is POST. The service worker caches `_serverFn`
// GETs stale-while-revalidate (sw.ts), and a cached price, "sold out" or
// order status would be wrong; POSTs are never cached.
//
// The plain functions below take the env explicitly so tests can call them;
// the `createServerFn` wrappers at the end only read the context.

/** Stripe accepts 30 minutes to 24 hours; one minute over the minimum absorbs clock skew and latency. */
export const CHECKOUT_SESSION_SECONDS = 31 * 60;
/** The seat outlives the session by this much, so `checkout.session.expired` normally frees it first. */
const HOLD_SLACK_MS = 5 * 60 * 1000;

export type TicketEnv = {
  DB?: D1Database;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  TICKET_SIGNING_SECRET?: string;
};

type SalesConfig = { db: D1Database; stripeKey: string; signingSecret: string };

/**
 * Sales are on only where the DB and all three secrets exist. The webhook
 * secret isn't used here, but without it no payment is ever confirmed, so a
 * buyer could pay for an order that stays pending. The gate is also what
 * keeps a test-mode checkout off formatglasgow.com: test keys go in the
 * Pages Preview environment, and Production stays without a buy block until
 * live keys are set there.
 */
function salesConfig(env: TicketEnv | undefined): SalesConfig | null {
  if (
    !env?.DB ||
    !env.STRIPE_SECRET_KEY ||
    !env.STRIPE_WEBHOOK_SECRET ||
    !env.TICKET_SIGNING_SECRET
  ) {
    return null;
  }
  return { db: env.DB, stripeKey: env.STRIPE_SECRET_KEY, signingSecret: env.TICKET_SIGNING_SECRET };
}

export type TicketAvailability = {
  eventId: string;
  /**
   * The tier on sale; null when every tier is full. `maxQuantity` is the most
   * one purchase can take: what's left in the tier, up to MAX_TICKETS_PER_ORDER.
   */
  active: { name: string; pricePence: number; maxQuantity: number } | null;
};

/** What the buy block shows; null hides the block (sales off, or an event without tiers). */
export async function loadAvailability(
  env: TicketEnv | undefined,
  eventId: string,
  now: number,
): Promise<TicketAvailability | null> {
  const config = salesConfig(env);
  if (!config) return null;
  const { active, tiers } = await getActiveTier(config.db, eventId, now);
  if (tiers.length === 0) return null;
  return {
    eventId,
    active: active
      ? {
          name: active.name,
          pricePence: active.pricePence,
          maxQuantity: Math.min(active.left, MAX_TICKETS_PER_ORDER),
        }
      : null,
  };
}

/** HMAC-SHA256 of the IP, hex. The raw IP is never stored. */
async function hashIp(ip: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(ip)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
}

export type StartCheckoutResult =
  | { status: "redirect"; url: string }
  | { status: "sold_out" }
  /** The active tier has fewer seats than asked for; `availability` is what's on sale now. */
  | { status: "fewer_left"; availability: TicketAvailability }
  | { status: "too_many_holds" }
  | { status: "unavailable" }
  | { status: "error" };

export async function startCheckoutFor(
  env: TicketEnv | undefined,
  input: { eventId: string; quantity: number; ip: string | null; origin: string; now: number },
  fetchImpl: typeof fetch = fetch,
): Promise<StartCheckoutResult> {
  const config = salesConfig(env);
  const event = getEvent(input.eventId);
  if (!config || !event) return { status: "unavailable" };
  const { quantity } = input;
  const { db } = config;

  const ipHash = await hashIp(input.ip ?? "unknown", config.signingSecret);
  const sessionExpiresAt = Math.floor(input.now / 1000) + CHECKOUT_SESSION_SECONDS;
  const holdExpiresAt = sessionExpiresAt * 1000 + HOLD_SLACK_MS;
  const orderId = crypto.randomUUID();

  // Two tries: the active tier can fill between reading it and reserving,
  // and the second read then finds the next tier. A tier with fewer seats
  // than asked for is never split: the buyer is told what's left instead.
  let seat = null;
  let tierName = "";
  for (let attempt = 0; attempt < 2 && !seat; attempt++) {
    const { active } = await getActiveTier(db, input.eventId, input.now);
    if (!active) return { status: "sold_out" };
    if (active.left < quantity) {
      return {
        status: "fewer_left",
        availability: {
          eventId: input.eventId,
          active: {
            name: active.name,
            pricePence: active.pricePence,
            maxQuantity: Math.min(active.left, MAX_TICKETS_PER_ORDER),
          },
        },
      };
    }
    tierName = active.name;
    seat = await reserveSeat(db, {
      tierId: active.id,
      orderId,
      quantity,
      ipHash,
      now: input.now,
      expiresAt: holdExpiresAt,
    });
    if (!seat && (await countLiveHoldsForIp(db, ipHash, input.now)) >= MAX_LIVE_HOLDS_PER_IP) {
      return { status: "too_many_holds" };
    }
  }
  if (!seat) return { status: "sold_out" };

  try {
    const session = await createCheckoutSession(
      config.stripeKey,
      {
        orderId,
        productName: `${event.title} · ${tierName}`,
        unitPence: seat.unitPence,
        quantity: seat.quantity,
        expiresAt: sessionExpiresAt,
        successUrl: `${input.origin}/tickets/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${input.origin}/events/${input.eventId}`,
      },
      fetchImpl,
    );
    // Without the session id the webhook can't find this order, so a failed
    // attach is handled like a failed session: the seat goes back.
    if (!(await attachStripeSession(db, orderId, session.id))) throw new Error("attach failed");
    return { status: "redirect", url: session.url };
  } catch {
    await releaseUnstartedOrder(db, orderId);
    return { status: "error" };
  }
}

export type OrderView = {
  status: "pending" | "paid" | "expired" | "refunded";
  eventTitle: string;
  date: string;
  venue: string;
  tierName: string;
  quantity: number;
  /** The order's total. */
  amountPence: number;
  name: string | null;
};

/** The success page's view of an order; null for an unknown session or when sales are off. */
export async function loadOrderView(
  env: TicketEnv | undefined,
  sessionId: string,
): Promise<OrderView | null> {
  const config = salesConfig(env);
  if (!config) return null;
  const order = await getOrderBySession(config.db, sessionId);
  if (!order) return null;
  const event = getEvent(order.eventId);
  return {
    status: order.status,
    eventTitle: event?.title ?? order.eventId,
    date: event?.date ?? "",
    venue: event?.venue ?? "",
    tierName: order.tierName,
    quantity: order.quantity,
    amountPence: order.amountPence,
    name: order.name,
  };
}

// ── Server functions ────────────────────────────────────────────────────────

type RequestContext = {
  cloudflare?: { env?: TicketEnv };
  request?: { ip: string | null; origin: string };
};

function readContext(context: unknown): RequestContext {
  return (context ?? {}) as RequestContext;
}

const ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const SESSION_PATTERN = /^cs_[A-Za-z0-9_]{1,255}$/;

function parseEventId(raw: unknown): string {
  if (typeof raw !== "string" || !ID_PATTERN.test(raw)) throw new Error("Invalid event id");
  return raw;
}

function parseCheckoutInput(raw: unknown): { eventId: string; quantity: number } {
  if (!raw || typeof raw !== "object") throw new Error("Invalid checkout input");
  const { eventId, quantity } = raw as Record<string, unknown>;
  if (
    typeof quantity !== "number" ||
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_TICKETS_PER_ORDER
  ) {
    throw new Error("Invalid quantity");
  }
  return { eventId: parseEventId(eventId), quantity };
}

function parseSessionId(raw: unknown): string {
  if (typeof raw !== "string" || !SESSION_PATTERN.test(raw)) throw new Error("Invalid session id");
  return raw;
}

export const fetchTicketAvailability = createServerFn({ method: "POST" })
  .inputValidator(parseEventId)
  .handler(async ({ data: eventId, context }) => {
    try {
      return await loadAvailability(readContext(context).cloudflare?.env, eventId, Date.now());
    } catch {
      return null;
    }
  });

export const startCheckout = createServerFn({ method: "POST" })
  .inputValidator(parseCheckoutInput)
  .handler(async ({ data: { eventId, quantity }, context }): Promise<StartCheckoutResult> => {
    const ctx = readContext(context);
    if (!ctx.request) return { status: "unavailable" };
    try {
      return await startCheckoutFor(ctx.cloudflare?.env, {
        eventId,
        quantity,
        ip: ctx.request.ip,
        origin: ctx.request.origin,
        now: Date.now(),
      });
    } catch {
      return { status: "error" };
    }
  });

export const fetchOrderStatus = createServerFn({ method: "POST" })
  .inputValidator(parseSessionId)
  .handler(async ({ data: sessionId, context }) => {
    try {
      return await loadOrderView(readContext(context).cloudflare?.env, sessionId);
    } catch {
      return null;
    }
  });
