// @vitest-environment node
import { attachStripeSession, checkIn, confirmOrder, reserveSeat } from "@form-at/data/tickets";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSales, salesTotals } from "~/data/sales";
import { verifyAccessJwt } from "~/utils/verifyAccessJwt";
import { type TestD1, createTestD1 } from "../../../../../packages/data/tests/helpers/sqliteD1";

// The sales list's reads and totals against real SQLite built from
// apps/web/schema.sql, which seeds Form:at 004's tiers: early 15 at £8,
// second 15 at £10, general 120 at £12. Only `verifyAccessJwt` is mocked, as
// in the ticket route tests.

vi.mock("~/utils/verifyAccessJwt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/verifyAccessJwt")>()),
  verifyAccessJwt: vi.fn(),
}));

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOLD = 35 * MINUTE;

let db: TestD1;
let env: { DB: D1Database; CF_ACCESS_TEAM_DOMAIN: string; CF_ACCESS_AUD: string };

function reserve(tierId: string, orderId: string, quantity: number, at: number) {
  return reserveSeat(db, {
    tierId,
    orderId,
    quantity,
    ipHash: `ip-${orderId}`,
    now: at,
    expiresAt: at + HOLD,
  });
}

/** A paid order of `quantity` tickets; returns their ids. */
async function buy(tierId: string, orderId: string, quantity: number, at: number) {
  await reserve(tierId, orderId, quantity, at);
  await attachStripeSession(db, orderId, `cs_${orderId}`);
  return confirmOrder(db, {
    stripeSessionId: `cs_${orderId}`,
    email: `${orderId}@example.com`,
    name: `Buyer ${orderId}`,
    paidAt: at + MINUTE,
  });
}

function request(token: string | null = "a-token"): Request {
  return new Request("http://localhost/tickets", {
    headers: token ? { "Cf-Access-Jwt-Assertion": token } : {},
  });
}

beforeEach(async () => {
  db = createTestD1();
  env = {
    DB: db,
    CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-aud",
  };
  vi.mocked(verifyAccessJwt).mockReset();
  vi.mocked(verifyAccessJwt).mockResolvedValue({ email: "door@example.com" });

  // early: 3 tickets paid (one in), 2 held by an open checkout, 1 refunded.
  const ids = await buy("format-004-early", "o1", 3, NOW - 60 * MINUTE);
  await checkIn(db, { ticketId: ids[0] as string, by: "door@example.com", now: NOW - MINUTE });
  await reserve("format-004-early", "o2", 2, NOW - 5 * MINUTE);
  await buy("format-004-early", "o3", 1, NOW - 50 * MINUTE);
  db.raw.prepare("UPDATE ticket_orders SET status = 'refunded' WHERE id = 'o3'").run();
  // second: a checkout whose hold lapsed, still pending.
  await reserve("format-004-second", "o4", 4, NOW - 2 * HOLD);
});

describe("salesTotals on a seeded database", () => {
  it("counts tickets, not orders, and grosses only paid orders", async () => {
    const { orders, tiers } = await readSales(request(), env, NOW);

    expect(tiers?.map((t) => ({ name: t.name, paid: t.paid, held: t.held, left: t.left }))).toEqual(
      [
        { name: "early", paid: 3, held: 2, left: 10 },
        { name: "second", paid: 0, held: 0, left: 15 },
        { name: "general", paid: 0, held: 0, left: 120 },
      ],
    );
    expect(salesTotals(tiers, orders)).toEqual({
      sold: 3,
      left: 145,
      // o1's 3 × £8. The refunded order and both pending ones don't count.
      grossPence: 2400,
    });
  });

  it("lists every order newest first, one row per order", async () => {
    const { orders } = await readSales(request(), env, NOW);
    expect(orders?.map((o) => [o.orderId, o.status, o.quantity, o.ticketsIn])).toEqual([
      ["o2", "pending", 2, 0],
      ["o3", "refunded", 1, 0],
      ["o1", "paid", 3, 1],
      ["o4", "pending", 4, 0],
    ]);
  });

  it("gives null totals for what it couldn't read", () => {
    expect(salesTotals(null, null)).toEqual({ sold: null, left: null, grossPence: null });
  });
});

describe("readSales", () => {
  it("reads nothing without an Access JWT", async () => {
    const prepare = vi.spyOn(db, "prepare");
    expect(await readSales(request(null), env, NOW)).toEqual({ orders: null, tiers: null });
    expect(verifyAccessJwt).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("reads nothing when the JWT doesn't verify", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);
    expect(await readSales(request(), env, NOW)).toEqual({ orders: null, tiers: null });
  });
});
