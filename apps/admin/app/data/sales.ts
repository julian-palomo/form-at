// The sales list on admin /tickets: every order of the event on sale, and the
// totals per tier. Every order's name and email are on it, so the loader
// verifies the Access identity itself, like /door's.
import { type EventOrder, type TicketTier, getActiveTier, listOrders } from "@form-at/data/tickets";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { type AccessEnv, identifyAccessRequest } from "~/utils/accessIdentity";
import { DOOR_EVENT_ID } from "./door";

/** One order, which may hold several tickets. */
export type SalesOrder = EventOrder;

/** A tier's counts, all in tickets (an order of 3 is 3), from `getActiveTier`. */
export type SalesTier = Pick<TicketTier, "id" | "name" | "cap" | "paid" | "held" | "left">;

export type SalesPageData = {
  /** null when the orders couldn't be read; never shown as an empty list. */
  orders: SalesOrder[] | null;
  /** null when the tiers couldn't be read; totals then show `—`. */
  tiers: SalesTier[] | null;
  /** Server time of the read, so "holding until" and "lapsed" agree with it. */
  now: number;
  isSampleData: boolean;
};

type SalesEnv = AccessEnv & { DB?: D1Database };

// Shown only when the app runs outside Cloudflare entirely (plain `vite dev`,
// the e2e server), same gate as admin-stats.ts's `pickStatsForMissingDb`. It
// holds made-up buyers, so it never stands in for real data.
const SAMPLE_NOW = Date.UTC(2026, 10, 14, 21, 30);
const MINUTE = 60_000;

const SAMPLE_ORDERS: SalesOrder[] = [
  {
    orderId: "sample-5",
    name: "Morven Bell",
    email: "morven@example.com",
    tierName: "second",
    quantity: 2,
    amountPence: 2000,
    createdAt: SAMPLE_NOW - 4 * MINUTE,
    paidAt: null,
    expiresAt: SAMPLE_NOW + 31 * MINUTE,
    status: "pending",
    ticketsIn: 0,
  },
  {
    orderId: "sample-4",
    name: "Isla Grant",
    email: "isla@example.com",
    tierName: "second",
    quantity: 3,
    amountPence: 3000,
    createdAt: SAMPLE_NOW - 25 * MINUTE,
    paidAt: SAMPLE_NOW - 23 * MINUTE,
    expiresAt: SAMPLE_NOW + 10 * MINUTE,
    status: "paid",
    ticketsIn: 1,
  },
  {
    orderId: "sample-3",
    name: null,
    email: "no-name@example.com",
    tierName: "second",
    quantity: 1,
    amountPence: 1000,
    createdAt: SAMPLE_NOW - 50 * MINUTE,
    paidAt: null,
    expiresAt: SAMPLE_NOW - 15 * MINUTE,
    status: "pending",
    ticketsIn: 0,
  },
  {
    orderId: "sample-2",
    name: "Callum Reid",
    email: "callum.reid@example.com",
    tierName: "early",
    quantity: 1,
    amountPence: 800,
    createdAt: SAMPLE_NOW - 3 * 24 * 60 * MINUTE,
    paidAt: SAMPLE_NOW - 3 * 24 * 60 * MINUTE,
    expiresAt: SAMPLE_NOW - 3 * 24 * 60 * MINUTE + 35 * MINUTE,
    status: "refunded",
    ticketsIn: 0,
  },
  {
    orderId: "sample-1",
    name: "Ada Morrison",
    email: "ada@example.com",
    tierName: "early",
    quantity: 1,
    amountPence: 800,
    createdAt: SAMPLE_NOW - 4 * 24 * 60 * MINUTE,
    paidAt: SAMPLE_NOW - 4 * 24 * 60 * MINUTE,
    expiresAt: SAMPLE_NOW - 4 * 24 * 60 * MINUTE + 35 * MINUTE,
    status: "expired",
    ticketsIn: 0,
  },
];

// Matches SAMPLE_ORDERS: Isla's 3 paid and Morven's 2 held in second; the
// lapsed, refunded and expired orders hold nothing.
const SAMPLE_TIERS: SalesTier[] = [
  { id: "format-004-early", name: "early", cap: 15, paid: 0, held: 0, left: 15 },
  { id: "format-004-second", name: "second", cap: 15, paid: 3, held: 2, left: 10 },
  { id: "format-004-general", name: "general", cap: 120, paid: 0, held: 0, left: 120 },
];

export type SalesTotalsData = {
  /** Tickets paid for, across tiers (an order of 3 is 3). */
  sold: number | null;
  /** Tickets still on sale online, across tiers. */
  left: number | null;
  /** Paid orders' totals. Refunded and unpaid orders don't count. */
  grossPence: number | null;
};

/** The page's headline numbers; each is null when what it's made from couldn't be read. */
export function salesTotals(
  tiers: SalesTier[] | null,
  orders: SalesOrder[] | null,
): SalesTotalsData {
  return {
    sold: tiers ? tiers.reduce((sum, t) => sum + t.paid, 0) : null,
    left: tiers ? tiers.reduce((sum, t) => sum + t.left, 0) : null,
    grossPence: orders
      ? orders.filter((o) => o.status === "paid").reduce((sum, o) => sum + o.amountPence, 0)
      : null,
  };
}

/**
 * The orders and tiers for a request, after verifying its Access identity.
 * Both are null without a verified identity or a DB. Read separately, so one
 * failing still shows the other.
 */
export async function readSales(
  request: Request,
  env: SalesEnv | undefined,
  now: number,
): Promise<{ orders: SalesOrder[] | null; tiers: SalesTier[] | null }> {
  const identity = await identifyAccessRequest(request, env);
  const db = env?.DB;
  if (!identity || !db) return { orders: null, tiers: null };

  const [orders, tiers] = await Promise.all([
    listOrders(db, DOOR_EVENT_ID).catch(() => null),
    getActiveTier(db, DOOR_EVENT_ID, now)
      .then((r) => r.tiers)
      .catch(() => null),
  ]);
  return { orders, tiers };
}

export const fetchSalesPageData = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<SalesPageData> => {
    const cf = (context as unknown as Record<string, unknown>).cloudflare as
      | { env: SalesEnv; hasCloudflareEnv: boolean }
      | undefined;
    if (!cf?.hasCloudflareEnv) {
      return { orders: SAMPLE_ORDERS, tiers: SAMPLE_TIERS, now: SAMPLE_NOW, isSampleData: true };
    }
    const now = Date.now();
    return { ...(await readSales(getRequest(), cf.env, now)), now, isSampleData: false };
  },
);
