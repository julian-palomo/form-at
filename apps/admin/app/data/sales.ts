// The sales list on admin /tickets: every order of the event on sale, and the
// totals per tier. Every order's name and email are on it, so the loader
// verifies the Access identity itself, like /door's.
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { type AccessEnv, identifyAccessRequest } from "~/utils/accessIdentity";

type SalesOrderStatus = "pending" | "paid" | "expired" | "refunded";

/** One order, which may hold several tickets. */
export type SalesOrder = {
  orderId: string;
  name: string | null;
  email: string | null;
  tierName: string;
  quantity: number;
  /** The order total. */
  amountPence: number;
  createdAt: number;
  paidAt: number | null;
  /** When an unpaid order stops holding its seats. */
  expiresAt: number;
  status: SalesOrderStatus;
  /** How many of the order's tickets have been checked in. */
  ticketsIn: number;
};

export type SalesTier = {
  id: string;
  name: string;
  cap: number;
  /** Tickets paid for in this tier. */
  paid: number;
  /** Tickets held by checkouts still open. */
  held: number;
  /** Tickets still on sale in this tier. */
  left: number;
};

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

const SAMPLE_TIERS: SalesTier[] = [
  { id: "format-004-early", name: "early", cap: 15, paid: 15, held: 0, left: 0 },
  { id: "format-004-second", name: "second", cap: 15, paid: 9, held: 2, left: 4 },
  { id: "format-004-general", name: "general", cap: 120, paid: 0, held: 0, left: 120 },
];

/** Gross takings: the totals of paid orders. Refunded and unpaid orders don't count. */
export function grossPence(orders: SalesOrder[]): number {
  return orders.filter((o) => o.status === "paid").reduce((sum, o) => sum + o.amountPence, 0);
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
    const identity = await identifyAccessRequest(getRequest(), cf.env);
    if (!identity || !cf.env.DB) return { orders: null, tiers: null, now, isSampleData: false };
    // The order and tier reads land with the multi-ticket orders change to
    // packages/data/src/tickets.ts; until then both read as unavailable.
    return { orders: null, tiers: null, now, isSampleData: false };
  },
);
