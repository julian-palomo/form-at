// The door list: every paid order of the event on sale, read with the shared
// `listPaidOrders` query. Unlike the dashboard's aggregates this is every
// buyer's name and email, so the loader verifies the Access identity itself
// instead of relying on Access gating the page load.
import { type PaidOrder, listPaidOrders } from "@form-at/data/tickets";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { type AccessEnv, identifyAccessRequest } from "~/utils/accessIdentity";
import { type DoorSummary, readDoorSummary } from "./door-sales";

export const DOOR_EVENT_ID = "format-004";

/** How many people the venue holds: online buyers plus door sales can't pass it. */
const VENUE_CAPACITY = 300;

export type DoorPageData = {
  /** null when the list couldn't be read; the page never shows it as empty. */
  orders: PaidOrder[] | null;
  /** The door sales numbers; null when they couldn't be read. */
  door: DoorSummary | null;
  capacity: number;
  isSampleData: boolean;
};

type DoorEnv = AccessEnv & { DB?: D1Database };

// Shown only when the app runs outside Cloudflare entirely (plain `vite dev`,
// the e2e server), same gate as admin-stats.ts's `pickStatsForMissingDb`. It
// holds made-up buyers, so it never stands in for real data.
const SAMPLE_PAID_AT = Date.UTC(2026, 10, 9, 12, 0);
const SAMPLE_DOOR_ORDERS: PaidOrder[] = [
  {
    orderId: "sample-1",
    ticketId: "sample-ticket-1",
    seq: 0,
    quantity: 1,
    name: "Ada Morrison",
    email: "ada@example.com",
    tierName: "early",
    amountPence: 800,
    paidAt: SAMPLE_PAID_AT,
    checkedInAt: Date.UTC(2026, 11, 5, 23, 42),
    checkedInBy: "door@example.com",
  },
  {
    orderId: "sample-2",
    ticketId: "sample-ticket-2",
    seq: 0,
    quantity: 2,
    name: "Callum Reid",
    email: "callum.reid@example.com",
    tierName: "second",
    amountPence: 2000,
    paidAt: SAMPLE_PAID_AT,
    checkedInAt: null,
    checkedInBy: null,
  },
  {
    orderId: "sample-2",
    ticketId: "sample-ticket-2b",
    seq: 1,
    quantity: 2,
    name: "Callum Reid",
    email: "callum.reid@example.com",
    tierName: "second",
    amountPence: 2000,
    paidAt: SAMPLE_PAID_AT,
    checkedInAt: null,
    checkedInBy: null,
  },
  {
    orderId: "sample-3",
    ticketId: "sample-ticket-3",
    seq: 0,
    quantity: 1,
    name: "Isla Grant",
    email: "isla@example.com",
    tierName: "general",
    amountPence: 1200,
    paidAt: SAMPLE_PAID_AT,
    checkedInAt: null,
    checkedInBy: null,
  },
  {
    orderId: "sample-4",
    ticketId: "sample-ticket-4",
    seq: 0,
    quantity: 1,
    name: null,
    email: "no-name@example.com",
    tierName: "general",
    amountPence: 1200,
    paidAt: SAMPLE_PAID_AT,
    checkedInAt: null,
    checkedInBy: null,
  },
];

const SAMPLE_DOOR_SUMMARY: DoorSummary = {
  pricePence: 1200,
  cash: 7,
  card: 4,
  expectedCashPence: 8400,
};

export type DoorOrdersRead =
  | { ok: true; orders: PaidOrder[] }
  | { ok: false; reason: "unauthorized" | "unavailable" };

/**
 * The door list for a request, after verifying its Access identity.
 * `unavailable` covers a missing DB binding and a failed query. Shared by the
 * page loader and the CSV route so both apply the same check.
 */
export async function readDoorOrders(
  request: Request,
  env: DoorEnv | undefined,
): Promise<DoorOrdersRead> {
  const identity = await identifyAccessRequest(request, env);
  if (!identity) return { ok: false, reason: "unauthorized" };
  const db = env?.DB;
  if (!db) return { ok: false, reason: "unavailable" };
  try {
    return { ok: true, orders: await listPaidOrders(db, DOOR_EVENT_ID) };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export const fetchDoorPageData = createServerFn({ method: "GET" }).handler(
  async ({ context }): Promise<DoorPageData> => {
    const cf = (context as unknown as Record<string, unknown>).cloudflare as
      | { env: DoorEnv; hasCloudflareEnv: boolean }
      | undefined;
    if (!cf?.hasCloudflareEnv) {
      return {
        orders: SAMPLE_DOOR_ORDERS,
        door: SAMPLE_DOOR_SUMMARY,
        capacity: VENUE_CAPACITY,
        isSampleData: true,
      };
    }
    const read = await readDoorOrders(getRequest(), cf.env);
    const db = cf.env.DB;
    if (!read.ok || !db) {
      return { orders: null, door: null, capacity: VENUE_CAPACITY, isSampleData: false };
    }
    let door: DoorSummary | null;
    try {
      door = await readDoorSummary(db, DOOR_EVENT_ID);
    } catch {
      door = null;
    }
    return { orders: read.orders, door, capacity: VENUE_CAPACITY, isSampleData: false };
  },
);
