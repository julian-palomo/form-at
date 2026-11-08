// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import {
  UNDO_WINDOW_MS,
  readDoorSummary,
  recordDoorSale,
  setDoorPrice,
  undoLastDoorSale,
} from "~/data/door-sales";
import { type TestD1, createTestD1 } from "../../../../../packages/data/tests/helpers/sqliteD1";

// The door sales queries against real SQLite built from apps/web/schema.sql,
// which also seeds Form:at 004's door price of £12.

const EVENT = "format-004";
const NOW = 1_800_000_000_000;
const ME = "door-a@example.com";
const OTHER = "door-b@example.com";

let db: TestD1;
let saleCount = 0;

function sell(method: "cash" | "card", at = NOW, by = ME) {
  saleCount += 1;
  return recordDoorSale(db, { id: `sale-${saleCount}`, eventId: EVENT, method, by, now: at });
}

function storedSales() {
  return db.raw
    .prepare(
      "SELECT method, price_pence, created_at, created_by FROM door_sales ORDER BY created_at",
    )
    .all();
}

beforeEach(() => {
  db = createTestD1();
  saleCount = 0;
});

describe("readDoorSummary", () => {
  it("starts from the seeded £12 price and no sales", async () => {
    expect(await readDoorSummary(db, EVENT)).toEqual({
      pricePence: 1200,
      cash: 0,
      card: 0,
      expectedCashPence: 0,
    });
  });

  it("counts cash and card, and expects each cash sale at its own price", async () => {
    await sell("cash");
    await sell("cash");
    await sell("card");
    await sell("cash");
    await sell("card");
    await setDoorPrice(db, { eventId: EVENT, pricePence: 1000, by: ME, now: NOW + 1 });
    await sell("cash", NOW + 2);

    expect(await readDoorSummary(db, EVENT)).toEqual({
      pricePence: 1000,
      cash: 4,
      card: 2,
      expectedCashPence: 3 * 1200 + 1000,
    });
  });

  it("returns null for an event with no door price", async () => {
    expect(await readDoorSummary(db, "format-999")).toBeNull();
  });
});

describe("recordDoorSale", () => {
  it("stores the price, the method and who recorded it", async () => {
    expect(await sell("card")).toBe(true);
    expect(storedSales()).toEqual([
      { method: "card", price_pence: 1200, created_at: NOW, created_by: ME },
    ]);
  });

  it("records nothing for an event with no door price", async () => {
    const ok = await recordDoorSale(db, {
      id: "x",
      eventId: "format-999",
      method: "cash",
      by: ME,
      now: NOW,
    });
    expect(ok).toBe(false);
    expect(storedSales()).toEqual([]);
  });
});

describe("undoLastDoorSale", () => {
  it("removes the caller's newest sale from the last minute", async () => {
    await sell("cash", NOW - 30_000);
    await sell("card", NOW - 10_000);

    expect(await undoLastDoorSale(db, { eventId: EVENT, by: ME, now: NOW })).toEqual({
      method: "card",
      pricePence: 1200,
      createdAt: NOW - 10_000,
    });
    expect(storedSales()).toEqual([
      { method: "cash", price_pence: 1200, created_at: NOW - 30_000, created_by: ME },
    ]);
  });

  it("never removes a sale a minute old or older", async () => {
    await sell("cash", NOW - UNDO_WINDOW_MS);

    expect(await undoLastDoorSale(db, { eventId: EVENT, by: ME, now: NOW })).toBeNull();
    expect(storedSales()).toHaveLength(1);
  });

  it("never removes another phone's sale, even a newer one", async () => {
    await sell("cash", NOW - 20_000, ME);
    await sell("card", NOW - 5_000, OTHER);

    const undone = await undoLastDoorSale(db, { eventId: EVENT, by: ME, now: NOW });

    expect(undone?.method).toBe("cash");
    expect(storedSales()).toEqual([
      { method: "card", price_pence: 1200, created_at: NOW - 5_000, created_by: OTHER },
    ]);
  });

  it("returns null when the caller has no sale at all", async () => {
    await sell("cash", NOW - 5_000, OTHER);
    expect(await undoLastDoorSale(db, { eventId: EVENT, by: ME, now: NOW })).toBeNull();
    expect(storedSales()).toHaveLength(1);
  });
});

describe("setDoorPrice", () => {
  it("changes the price after sales have started, keeping earlier sales' prices", async () => {
    await sell("cash");
    expect(
      await setDoorPrice(db, { eventId: EVENT, pricePence: 1500, by: OTHER, now: NOW + 1 }),
    ).toBe(true);

    expect(
      db.raw
        .prepare("SELECT price_pence, updated_at, updated_by FROM door_settings WHERE event_id = ?")
        .get(EVENT),
    ).toEqual({ price_pence: 1500, updated_at: NOW + 1, updated_by: OTHER });
    expect(storedSales()).toEqual([
      { method: "cash", price_pence: 1200, created_at: NOW, created_by: ME },
    ]);
  });

  it("returns false for an event with no door price", async () => {
    expect(
      await setDoorPrice(db, { eventId: "format-999", pricePence: 1500, by: ME, now: NOW }),
    ).toBe(false);
  });
});
