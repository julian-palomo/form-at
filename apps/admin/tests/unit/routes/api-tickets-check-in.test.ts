// @vitest-environment node
import { attachStripeSession, confirmOrder, reserveSeat } from "@form-at/data/tickets";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCheckIn } from "~/routes/api/tickets/check-in";
import { verifyAccessJwt } from "~/utils/verifyAccessJwt";
import { type TestD1, createTestD1 } from "../../../../../packages/data/tests/helpers/sqliteD1";

// The endpoint against real SQLite built from apps/web/schema.sql, so the
// once-only check-in is the real conditional UPDATE, not a mock's answer.
// Only `verifyAccessJwt` is mocked: its signature, issuer, audience and expiry
// checks have their own real-crypto tests in utils/verifyAccessJwt.test.ts.
// Token extraction and the missing-config path stay real.

vi.mock("~/utils/verifyAccessJwt", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/verifyAccessJwt")>()),
  verifyAccessJwt: vi.fn(),
}));

const NOW = 1_800_000_000_000;
const DOOR_EMAIL = "door@example.com";

let db: TestD1;
let env: { DB: D1Database; CF_ACCESS_TEAM_DOMAIN: string; CF_ACCESS_AUD: string };

/** One paid Form:at 004 order with its ticket, through the real queries. */
async function paidTicket(orderId: string): Promise<string> {
  await reserveSeat(db, {
    tierId: "format-004-early",
    orderId,
    quantity: 1,
    now: NOW - 60_000,
    expiresAt: NOW + 60_000,
  });
  await attachStripeSession(db, orderId, `cs_${orderId}`);
  const [ticketId] = await confirmOrder(db, {
    stripeSessionId: `cs_${orderId}`,
    email: `${orderId}@example.com`,
    name: `Buyer ${orderId}`,
    paidAt: NOW - 30_000,
  });
  if (!ticketId) throw new Error("confirmOrder created no ticket");
  return ticketId;
}

function checkInRequest(body: unknown, token: string | null = "a-token"): Request {
  return new Request("http://localhost/api/tickets/check-in", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "Cf-Access-Jwt-Assertion": token } : {}),
    },
    body: JSON.stringify(body),
  });
}

function checkedInRow(ticketId: string) {
  return db.raw
    .prepare("SELECT checked_in_at, checked_in_by FROM tickets WHERE id = ?")
    .get(ticketId) as { checked_in_at: number | null; checked_in_by: string | null };
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

describe("POST /api/tickets/check-in", () => {
  it("returns 401 and writes nothing without an Access JWT", async () => {
    const ticketId = await paidTicket("o1");

    const response = await handleCheckIn(checkInRequest({ ticketId }, null), env, NOW);

    expect(response.status).toBe(401);
    expect(verifyAccessJwt).not.toHaveBeenCalled();
    expect(checkedInRow(ticketId)).toEqual({ checked_in_at: null, checked_in_by: null });
  });

  it("returns 401 and writes nothing when the JWT doesn't verify", async () => {
    const ticketId = await paidTicket("o1");
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);

    const response = await handleCheckIn(checkInRequest({ ticketId }), env, NOW);

    expect(response.status).toBe(401);
    expect(checkedInRow(ticketId).checked_in_at).toBeNull();
  });

  it("returns 401 when the Access config is missing, even with a token", async () => {
    const ticketId = await paidTicket("o1");

    const response = await handleCheckIn(checkInRequest({ ticketId }), { DB: db }, NOW);

    expect(response.status).toBe(401);
    expect(verifyAccessJwt).not.toHaveBeenCalled();
    expect(checkedInRow(ticketId).checked_in_at).toBeNull();
  });

  it("records the check-in with the Access identity's email", async () => {
    const ticketId = await paidTicket("o1");

    const response = await handleCheckIn(checkInRequest({ ticketId }), env, NOW);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "checked_in", checkedInAt: NOW });
    expect(checkedInRow(ticketId)).toEqual({ checked_in_at: NOW, checked_in_by: DOOR_EMAIL });
  });

  it("answers a second check-in with 409, the first time and who", async () => {
    const ticketId = await paidTicket("o1");
    await handleCheckIn(checkInRequest({ ticketId }), env, NOW);
    vi.mocked(verifyAccessJwt).mockResolvedValue({ email: "other-door@example.com" });

    const response = await handleCheckIn(checkInRequest({ ticketId }), env, NOW + 5 * 60_000);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      status: "already_used",
      checkedInAt: NOW,
      checkedInBy: DOOR_EMAIL,
    });
    expect(checkedInRow(ticketId)).toEqual({ checked_in_at: NOW, checked_in_by: DOOR_EMAIL });
  });

  it("returns 404 for a ticket that doesn't exist", async () => {
    const response = await handleCheckIn(checkInRequest({ ticketId: "no-such-ticket" }), env, NOW);
    expect(response.status).toBe(404);
  });

  it.each([{}, { ticketId: "" }, { ticketId: 42 }, { ticketId: "x".repeat(101) }, null])(
    "returns 400 for a malformed body: %j",
    async (body) => {
      const response = await handleCheckIn(checkInRequest(body), env, NOW);
      expect(response.status).toBe(400);
    },
  );
});
