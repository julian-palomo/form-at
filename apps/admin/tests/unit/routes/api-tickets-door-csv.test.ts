// @vitest-environment node
import type { PaidOrder } from "@form-at/data/tickets";
import { attachStripeSession, checkIn, confirmOrder, reserveSeat } from "@form-at/data/tickets";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildDoorCsv, handleDoorCsv } from "~/routes/api/tickets/door-csv";
import { verifyAccessJwt } from "~/utils/verifyAccessJwt";
import { type TestD1, createTestD1 } from "../../../../../packages/data/tests/helpers/sqliteD1";

// The CSV is every buyer's name and email, so it gets the same Access check
// as the check-in endpoint (see api-tickets-check-in.test.ts for why only
// `verifyAccessJwt` is mocked).

vi.mock("~/utils/verifyAccessJwt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/verifyAccessJwt")>()),
  verifyAccessJwt: vi.fn(),
}));

const NOW = 1_800_000_000_000;

function order(overrides: Partial<PaidOrder>): PaidOrder {
  return {
    orderId: "o",
    ticketId: "t",
    name: "Isla Grant",
    email: "isla@example.com",
    tierName: "general",
    amountPence: 1200,
    paidAt: NOW,
    checkedInAt: null,
    checkedInBy: null,
    ...overrides,
  };
}

describe("buildDoorCsv", () => {
  it("writes the header and one row per order, with ISO check-in times", () => {
    const csv = buildDoorCsv([order({}), order({ name: "Ada", checkedInAt: NOW })]);
    expect(csv.split("\r\n")).toEqual([
      "name,email,tier,status,checked_in_at",
      "Isla Grant,isla@example.com,general,not_checked_in,",
      `Ada,isla@example.com,general,checked_in,${new Date(NOW).toISOString()}`,
      "",
    ]);
  });

  it("leaves a null name or email empty", () => {
    const csv = buildDoorCsv([order({ name: null, email: null })]);
    expect(csv.split("\r\n")[1]).toBe(",,general,not_checked_in,");
  });

  it("quotes commas and quotes, and defuses spreadsheet formulas", () => {
    const csv = buildDoorCsv([
      order({ name: 'Reid, "Cal"' }),
      order({ name: "=HYPERLINK(1)" }),
      order({ name: "-1+2" }),
      order({ name: "@sum" }),
    ]);
    const rows = csv.split("\r\n");
    expect(rows[1]).toMatch(/^"Reid, ""Cal""",/);
    expect(rows[2]).toMatch(/^'=HYPERLINK\(1\),/);
    expect(rows[3]).toMatch(/^'-1\+2,/);
    expect(rows[4]).toMatch(/^'@sum,/);
  });
});

describe("GET /api/tickets/door-csv", () => {
  let db: TestD1;
  let env: { DB: D1Database; CF_ACCESS_TEAM_DOMAIN: string; CF_ACCESS_AUD: string };

  beforeEach(async () => {
    db = createTestD1();
    env = {
      DB: db,
      CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
      CF_ACCESS_AUD: "test-aud",
    };
    vi.mocked(verifyAccessJwt).mockReset();
    vi.mocked(verifyAccessJwt).mockResolvedValue({ email: "door@example.com" });

    await reserveSeat(db, {
      tierId: "format-004-early",
      orderId: "o1",
      now: NOW - 60_000,
      expiresAt: NOW + 60_000,
    });
    await attachStripeSession(db, "o1", "cs_o1");
    const ticketId = await confirmOrder(db, {
      stripeSessionId: "cs_o1",
      email: "isla@example.com",
      name: "Isla Grant",
      paidAt: NOW - 30_000,
    });
    if (!ticketId) throw new Error("confirmOrder returned null");
    await checkIn(db, { ticketId, by: "door@example.com", now: NOW });
  });

  function csvRequest(token: string | null = "a-token"): Request {
    return new Request("http://localhost/api/tickets/door-csv", {
      headers: token ? { "Cf-Access-Jwt-Assertion": token } : {},
    });
  }

  it("returns 401 without an Access JWT", async () => {
    const response = await handleDoorCsv(csvRequest(null), env);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
  });

  it("returns the paid orders as an uncacheable CSV attachment", async () => {
    const response = await handleDoorCsv(csvRequest(), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="format-004-door.csv"',
    );
    expect(await response.text()).toBe(
      `name,email,tier,status,checked_in_at\r\nIsla Grant,isla@example.com,early,checked_in,${new Date(NOW).toISOString()}\r\n`,
    );
  });

  it("returns 503 when the database isn't bound", async () => {
    const response = await handleDoorCsv(csvRequest(), { ...env, DB: undefined });
    expect(response.status).toBe(503);
  });
});
