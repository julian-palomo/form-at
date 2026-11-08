// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleDoorPrice } from "~/routes/api/tickets/door-price";
import { handleDoorSale, handleDoorUndo } from "~/routes/api/tickets/door-sales";
import { verifyAccessJwt } from "~/utils/verifyAccessJwt";
import { type TestD1, createTestD1 } from "../../../../../packages/data/tests/helpers/sqliteD1";

// The three door writes (+1, −1, price) against real SQLite. As in
// api-tickets-check-in.test.ts, only `verifyAccessJwt` is mocked; token
// extraction and the missing-config path stay real.

vi.mock("~/utils/verifyAccessJwt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/verifyAccessJwt")>()),
  verifyAccessJwt: vi.fn(),
}));

const NOW = 1_800_000_000_000;
const DOOR_EMAIL = "door@example.com";

let db: TestD1;
let env: { DB: D1Database; CF_ACCESS_TEAM_DOMAIN: string; CF_ACCESS_AUD: string };

function request(method: string, body?: unknown, token: string | null = "a-token"): Request {
  return new Request("http://localhost/api/tickets/door-sales", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "Cf-Access-Jwt-Assertion": token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function saleRows() {
  return db.raw.prepare("SELECT method, price_pence, created_by FROM door_sales").all();
}

function storedPrice() {
  return db.raw
    .prepare("SELECT price_pence, updated_by FROM door_settings WHERE event_id = 'format-004'")
    .get();
}

beforeEach(() => {
  db = createTestD1();
  env = {
    DB: db,
    CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-aud",
  };
  vi.mocked(verifyAccessJwt).mockReset();
  vi.mocked(verifyAccessJwt).mockResolvedValue({ email: DOOR_EMAIL });
});

describe("every door write refuses without an Access JWT", () => {
  it("+1: 401 and no sale", async () => {
    const response = await handleDoorSale(request("POST", { method: "cash" }, null), env, NOW);
    expect(response.status).toBe(401);
    expect(saleRows()).toEqual([]);
  });

  it("−1: 401 and the sale stays", async () => {
    await handleDoorSale(request("POST", { method: "cash" }), env, NOW);
    const response = await handleDoorUndo(request("DELETE", undefined, null), env, NOW + 1000);
    expect(response.status).toBe(401);
    expect(saleRows()).toHaveLength(1);
  });

  it("price: 401 and the price stays", async () => {
    const response = await handleDoorPrice(request("POST", { pricePence: 1500 }, null), env, NOW);
    expect(response.status).toBe(401);
    expect(storedPrice()).toEqual({ price_pence: 1200, updated_by: null });
  });

  it("refuses when the JWT doesn't verify", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);
    const response = await handleDoorSale(request("POST", { method: "card" }), env, NOW);
    expect(response.status).toBe(401);
    expect(saleRows()).toEqual([]);
  });

  it("refuses when the Access config is missing, even with a token", async () => {
    const response = await handleDoorSale(request("POST", { method: "card" }), { DB: db }, NOW);
    expect(response.status).toBe(401);
    expect(verifyAccessJwt).not.toHaveBeenCalled();
  });
});

describe("POST /api/tickets/door-sales", () => {
  it("records the sale with the Access email and returns the fresh numbers", async () => {
    await handleDoorSale(request("POST", { method: "cash" }), env, NOW);
    const response = await handleDoorSale(request("POST", { method: "card" }), env, NOW + 1);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      summary: { pricePence: 1200, cash: 1, card: 1, expectedCashPence: 1200 },
    });
    expect(saleRows()).toEqual([
      { method: "cash", price_pence: 1200, created_by: DOOR_EMAIL },
      { method: "card", price_pence: 1200, created_by: DOOR_EMAIL },
    ]);
  });

  it.each([{}, { method: "cheque" }, { method: 1 }, null])("returns 400 for %j", async (body) => {
    const response = await handleDoorSale(request("POST", body), env, NOW);
    expect(response.status).toBe(400);
    expect(saleRows()).toEqual([]);
  });
});

describe("DELETE /api/tickets/door-sales", () => {
  it("undoes the caller's sale from the last minute", async () => {
    await handleDoorSale(request("POST", { method: "cash" }), env, NOW);

    const response = await handleDoorUndo(request("DELETE"), env, NOW + 30_000);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      undone: { method: "cash", pricePence: 1200, createdAt: NOW },
      summary: { pricePence: 1200, cash: 0, card: 0, expectedCashPence: 0 },
    });
    expect(saleRows()).toEqual([]);
  });

  it("returns 404 once the sale is a minute old", async () => {
    await handleDoorSale(request("POST", { method: "cash" }), env, NOW);

    const response = await handleDoorUndo(request("DELETE"), env, NOW + 60_000);

    expect(response.status).toBe(404);
    expect(saleRows()).toHaveLength(1);
  });
});

describe("POST /api/tickets/door-price", () => {
  it("sets the price, records who, and later sales use it", async () => {
    await handleDoorSale(request("POST", { method: "cash" }), env, NOW);

    const response = await handleDoorPrice(request("POST", { pricePence: 1500 }), env, NOW + 1);
    await handleDoorSale(request("POST", { method: "cash" }), env, NOW + 2);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      summary: { pricePence: 1500, cash: 1, card: 0, expectedCashPence: 1200 },
    });
    expect(storedPrice()).toEqual({ price_pence: 1500, updated_by: DOOR_EMAIL });
    expect(saleRows().map((r) => (r as { price_pence: number }).price_pence)).toEqual([1200, 1500]);
  });

  it.each([
    {},
    { pricePence: 0 },
    { pricePence: 12.5 },
    { pricePence: 10_001 },
    { pricePence: "1200" },
  ])("returns 400 for %j", async (body) => {
    const response = await handleDoorPrice(request("POST", body), env, NOW);
    expect(response.status).toBe(400);
    expect(storedPrice()).toEqual({ price_pence: 1200, updated_by: null });
  });
});
