import { type Event, getEvent } from "@form-at/data/events";
import { createCheckoutSession } from "@form-at/data/stripe";
import { signTicketToken, verifyTicketToken } from "@form-at/data/ticketToken";
import {
  MAX_LIVE_HOLDS_PER_IP,
  MAX_TICKETS_PER_ORDER,
  type OrderTicket,
  type TicketEmailKind,
  attachStripeSession,
  countLiveHoldsForIp,
  countRecoverRequests,
  findPaidOrdersByEmail,
  getActiveTier,
  getOrderBySession,
  getTicket,
  listOrderTickets,
  recordTicketEmail,
  releaseUnstartedOrder,
  reserveSeat,
  wasOrderEmailedSince,
} from "@form-at/data/tickets";
import { createServerFn } from "@tanstack/react-start";
import { fmtEventDay } from "~/utils/fmt";
import { sendTicketEmail } from "./ticketEmail";

// The buyer's side of ticket sales: what the event page shows, starting a
// Stripe Checkout, the page Stripe returns the buyer to, the ticket page a
// QR link opens, and emailing the links. The webhook that confirms payment
// is `routes/api/stripe-webhook.ts`; it calls `deliverOrderTickets` here.
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
  /** Resend's API key. Without it no ticket email is sent, and each attempt is recorded as not sent. */
  RESEND_API_KEY?: string;
};

/** Recovery requests one connection may make in an hour, matched or not. */
export const MAX_RECOVER_REQUESTS_PER_HOUR = 3;
/** An order's tickets are emailed again at most once in this long. */
export const RECOVER_COOLDOWN_MS = 10 * 60 * 1000;

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

/** What the success page stores on the device for one ticket. */
type OrderViewTicket = { token: string; seq: number };

export type OrderView = {
  status: "pending" | "paid" | "expired" | "refunded";
  eventId: string;
  eventTitle: string;
  date: string;
  venue: string;
  tierName: string;
  quantity: number;
  /** The order's total. */
  amountPence: number;
  name: string | null;
  /** The order's tickets, signed, in seat order; empty until the order is paid. */
  tickets: OrderViewTicket[];
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
  const tickets =
    order.status === "paid"
      ? await signTickets(await listOrderTickets(config.db, order.orderId), config.signingSecret)
      : [];
  return {
    status: order.status,
    eventId: order.eventId,
    eventTitle: event?.title ?? order.eventId,
    date: event?.date ?? "",
    venue: event?.venue ?? "",
    tierName: order.tierName,
    quantity: order.quantity,
    amountPence: order.amountPence,
    name: order.name,
    tickets,
  };
}

async function signTickets(tickets: OrderTicket[], secret: string): Promise<OrderViewTicket[]> {
  return Promise.all(
    tickets.map(async (t) => ({ token: await signTicketToken(t.id, secret), seq: t.seq })),
  );
}

// ── The ticket page ─────────────────────────────────────────────────────────

/** What `/tickets/$token` shows, and what the device stores. */
export type TicketPageView = {
  token: string;
  eventId: string;
  eventTitle: string;
  date: string;
  venue: string;
  runtime: string;
  tierName: string;
  name: string | null;
  /** The ticket's place in its order, from 0. */
  seq: number;
  /** Tickets in the order. */
  quantity: number;
  checkedInAt: number | null;
};

/**
 * The ticket a token names, or null: a forged or mistyped token fails the
 * signature before D1 is read, and a ticket of an order that isn't paid is
 * null too. Null is a 404 to the buyer.
 */
export async function loadTicketPage(
  env: TicketEnv | undefined,
  token: string,
): Promise<TicketPageView | null> {
  const config = salesConfig(env);
  if (!config) return null;
  const ticketId = await verifyTicketToken(token, config.signingSecret);
  if (!ticketId) return null;
  const ticket = await getTicket(config.db, ticketId);
  if (!ticket) return null;
  const event = getEvent(ticket.eventId);
  return {
    token,
    eventId: ticket.eventId,
    eventTitle: event?.title ?? ticket.eventId,
    date: event?.date ?? "",
    venue: event?.venue ?? "",
    runtime: event?.runtime ?? "",
    tierName: ticket.tierName,
    name: ticket.name,
    seq: ticket.seq,
    quantity: ticket.quantity,
    checkedInAt: ticket.checkedInAt,
  };
}

// ── Emailing the links ──────────────────────────────────────────────────────

export type DeliverableOrder = {
  orderId: string;
  eventId: string;
  tierName: string;
  name: string | null;
  email: string;
  tickets: OrderTicket[];
};

/**
 * Emails a paid order's ticket links, one per ticket, and records the attempt
 * in `ticket_email_sends`. Returns whether the provider accepted it. Never
 * throws: a failed send is logged and recorded as not sent, so the admin's
 * resend finds it, and the caller's own work (confirming the payment) stands.
 *
 * `origin` is the request's, so an email from a preview deployment links to
 * the preview. The idempotency key stops a webhook delivered twice from
 * sending twice even if both deliveries got this far.
 */
export async function deliverOrderTickets(
  env: TicketEnv | undefined,
  input: {
    order: DeliverableOrder;
    origin: string;
    kind: TicketEmailKind;
    ipHash: string | null;
    now: number;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const config = salesConfig(env);
  const { order } = input;
  if (!config || order.tickets.length === 0) return false;
  const event = getEvent(order.eventId);
  let sent = false;
  try {
    if (!env?.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
    const tickets = await signTickets(order.tickets, config.signingSecret);
    await sendTicketEmail(
      env.RESEND_API_KEY,
      {
        to: order.email,
        name: order.name,
        eventTitle: event?.title ?? order.eventId,
        date: event ? fmtEventDay(event.date) : "",
        venue: event?.venue ?? "",
        runtime: event?.runtime ?? "",
        tierName: order.tierName,
        tickets: tickets.map((t) => ({ url: `${input.origin}/tickets/${t.token}`, seq: t.seq })),
        idempotencyKey:
          input.kind === "purchase"
            ? `ticket-${order.orderId}`
            : `recover-${order.orderId}-${input.now}`,
      },
      fetchImpl,
    );
    sent = true;
  } catch (error) {
    console.error(`[tickets] email for order ${order.orderId} not sent:`, error);
  }
  await recordTicketEmail(config.db, {
    orderId: order.orderId,
    kind: input.kind,
    ipHash: input.ipHash,
    sent,
    now: input.now,
  });
  return sent;
}

/** Events a ticket is still worth emailing for: today or later, by calendar day. */
function isUpcoming(event: Event | undefined, now: number): boolean {
  if (!event) return false;
  const today = new Date(now).toISOString().slice(0, 10);
  return event.date >= today;
}

export type RecoverResult = { status: "ok" } | { status: "unavailable" };

/**
 * "Recover my tickets": emails every ticket of every paid order with this
 * email for an upcoming event. The answer is `ok` whether or not anything
 * matched, so the form can't tell a caller which emails bought. Two limits,
 * both counted in `ticket_email_sends`: MAX_RECOVER_REQUESTS_PER_HOUR per
 * connection, matched or not, and one email per order per
 * RECOVER_COOLDOWN_MS, so the form can't flood someone else's inbox.
 */
export async function recoverTicketsFor(
  env: TicketEnv | undefined,
  input: { email: string; ip: string | null; origin: string; now: number },
  fetchImpl: typeof fetch = fetch,
): Promise<RecoverResult> {
  const config = salesConfig(env);
  if (!config) return { status: "unavailable" };
  const { db } = config;
  const ipHash = await hashIp(input.ip ?? "unknown", config.signingSecret);
  const hourAgo = input.now - 60 * 60 * 1000;
  if ((await countRecoverRequests(db, ipHash, hourAgo)) >= MAX_RECOVER_REQUESTS_PER_HOUR) {
    return { status: "ok" };
  }

  const orders = (await findPaidOrdersByEmail(db, input.email)).filter(
    (o) => o.tickets.length > 0 && isUpcoming(getEvent(o.eventId), input.now),
  );
  if (orders.length === 0) {
    // Counts towards the connection's limit like a match would.
    await recordTicketEmail(db, {
      orderId: null,
      kind: "recover",
      ipHash,
      sent: false,
      now: input.now,
    });
    return { status: "ok" };
  }
  for (const order of orders) {
    if (await wasOrderEmailedSince(db, order.orderId, input.now - RECOVER_COOLDOWN_MS)) {
      await recordTicketEmail(db, {
        orderId: order.orderId,
        kind: "recover",
        ipHash,
        sent: false,
        now: input.now,
      });
      continue;
    }
    await deliverOrderTickets(
      env,
      { order, origin: input.origin, kind: "recover", ipHash, now: input.now },
      fetchImpl,
    );
  }
  return { status: "ok" };
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

/** `<uuid>.<43 base64url chars>`: the shape `signTicketToken` produces. Anything else never reaches the crypto. */
const TOKEN_PATTERN = /^[a-z0-9-]{1,64}\.[A-Za-z0-9_-]{43}$/;
/** Loose on purpose: the provider validates addresses; this only bounds what reaches D1. */
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@]{1,189}$/;

export function parseTicketToken(raw: unknown): string {
  if (typeof raw !== "string" || !TOKEN_PATTERN.test(raw)) throw new Error("Invalid ticket token");
  return raw;
}

function parseRecoverInput(raw: unknown): { email: string } {
  if (!raw || typeof raw !== "object") throw new Error("Invalid recover input");
  const email = (raw as Record<string, unknown>).email;
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) {
    throw new Error("Invalid email");
  }
  return { email: email.trim() };
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

export const fetchTicket = createServerFn({ method: "POST" })
  .inputValidator(parseTicketToken)
  .handler(async ({ data: token, context }) => {
    try {
      return await loadTicketPage(readContext(context).cloudflare?.env, token);
    } catch {
      return null;
    }
  });

export const recoverTickets = createServerFn({ method: "POST" })
  .inputValidator(parseRecoverInput)
  .handler(async ({ data: { email }, context }): Promise<RecoverResult> => {
    const ctx = readContext(context);
    if (!ctx.request) return { status: "unavailable" };
    try {
      return await recoverTicketsFor(ctx.cloudflare?.env, {
        email,
        ip: ctx.request.ip,
        origin: ctx.request.origin,
        now: Date.now(),
      });
    } catch {
      return { status: "unavailable" };
    }
  });
