// People who pay at the door (cash, or card on SumUp), for admin /door. Only
// the admin uses these, so they live here rather than in packages/data. Tables
// and their reasoning: the door block at the end of apps/web/schema.sql.
//
// Every write is one statement, as in packages/data/src/tickets.ts: a sale
// copies the price inside its own INSERT, and an undo picks and deletes its
// row inside one DELETE, so two door phones tapping at once can't record a
// sale at a stale price or undo the same sale twice.

export type DoorMethod = "cash" | "card";

export type DoorSummary = {
  pricePence: number;
  cash: number;
  card: number;
  /** What should be in the cash box: the sum of each cash sale's own price. */
  expectedCashPence: number;
};

export type UndoneDoorSale = { method: DoorMethod; pricePence: number; createdAt: number };

/** How long after a sale its recorder can still undo it. */
export const UNDO_WINDOW_MS = 60_000;

/** The door numbers for an event; null when the event has no door price set up. */
export async function readDoorSummary(
  db: D1Database,
  eventId: string,
): Promise<DoorSummary | null> {
  const row = await db
    .prepare(
      `SELECT s.price_pence,
         (SELECT COUNT(*) FROM door_sales d WHERE d.event_id = s.event_id AND d.method = 'cash') AS cash,
         (SELECT COUNT(*) FROM door_sales d WHERE d.event_id = s.event_id AND d.method = 'card') AS card,
         (SELECT COALESCE(SUM(d.price_pence), 0) FROM door_sales d
            WHERE d.event_id = s.event_id AND d.method = 'cash') AS expected_cash
       FROM door_settings s
       WHERE s.event_id = ?`,
    )
    .bind(eventId)
    .first<{ price_pence: number; cash: number; card: number; expected_cash: number }>();
  if (!row) return null;
  return {
    pricePence: row.price_pence,
    cash: row.cash,
    card: row.card,
    expectedCashPence: row.expected_cash,
  };
}

/**
 * Records one person who paid at the door, at the event's current door price.
 * Returns false when the event has no door price set up.
 */
export async function recordDoorSale(
  db: D1Database,
  input: { id: string; eventId: string; method: DoorMethod; by: string; now: number },
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO door_sales (id, event_id, method, price_pence, created_at, created_by)
       SELECT ?, event_id, ?, price_pence, ?, ? FROM door_settings WHERE event_id = ?`,
    )
    .bind(input.id, input.method, input.now, input.by, input.eventId)
    .run();
  return result.meta.changes === 1;
}

/**
 * Deletes the newest sale `by` recorded for the event in the last
 * UNDO_WINDOW_MS, for a mis-tap. Only the caller's own: with two phones on the
 * door, the newest sale overall may be the other phone's. Returns the undone
 * sale, or null when there's none in the window.
 */
export async function undoLastDoorSale(
  db: D1Database,
  input: { eventId: string; by: string; now: number },
): Promise<UndoneDoorSale | null> {
  const row = await db
    .prepare(
      `DELETE FROM door_sales
       WHERE id = (
         SELECT id FROM door_sales
         WHERE event_id = ? AND created_by = ? AND created_at > ?
         ORDER BY created_at DESC LIMIT 1
       )
       RETURNING method, price_pence, created_at`,
    )
    .bind(input.eventId, input.by, input.now - UNDO_WINDOW_MS)
    .first<{ method: DoorMethod; price_pence: number; created_at: number }>();
  if (!row) return null;
  return { method: row.method, pricePence: row.price_pence, createdAt: row.created_at };
}

/**
 * Sets the door price for sales from now on. Earlier sales keep the price they
 * were made at. Returns false when the event has no door price set up.
 */
export async function setDoorPrice(
  db: D1Database,
  input: { eventId: string; pricePence: number; by: string; now: number },
): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE door_settings SET price_pence = ?, updated_at = ?, updated_by = ? WHERE event_id = ?",
    )
    .bind(input.pricePence, input.now, input.by, input.eventId)
    .run();
  return result.meta.changes === 1;
}
