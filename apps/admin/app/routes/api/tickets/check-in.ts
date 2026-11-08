import { verifyTicketToken } from "@form-at/data/ticketToken";
import { type CheckInResult, checkIn } from "@form-at/data/tickets";
import { createFileRoute } from "@tanstack/react-router";
import { type AccessEnv, identifyAccessRequest } from "~/utils/accessIdentity";

// Lets one ticket in at the door, named either by its id (a tap on the door
// list) or by its signed token (a scanned QR). Mutates data, so it verifies
// the Access identity first and records that identity's email as
// `checked_in_by`. A token's signature is checked before D1 is touched, so an
// invented or mistyped code costs no query. The once-only guarantee lives in
// `checkIn`'s conditional UPDATE, not here: two door phones scanning the same
// QR both reach it, and only one gets `checked_in`.

type CheckInEnv = AccessEnv & { DB?: D1Database; TICKET_SIGNING_SECRET?: string };

export type CheckInResponseBody = Exclude<CheckInResult, { status: "not_valid" }>;

const MAX_TICKET_ID_LEN = 100;
/** A ticket id, a dot and a 43-character signature. */
const MAX_TOKEN_LEN = MAX_TICKET_ID_LEN + 44;

type CheckInTarget = { kind: "ticketId"; ticketId: string } | { kind: "token"; token: string };

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > max) return null;
  return value;
}

/** Exactly one of `ticketId` or `token`; anything else is a malformed body. */
function parseTarget(raw: unknown): CheckInTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;
  const hasId = body.ticketId !== undefined;
  const hasToken = body.token !== undefined;
  if (hasId === hasToken) return null;
  if (hasId) {
    const ticketId = boundedString(body.ticketId, MAX_TICKET_ID_LEN);
    return ticketId ? { kind: "ticketId", ticketId } : null;
  }
  const token = boundedString(body.token, MAX_TOKEN_LEN);
  return token ? { kind: "token", token } : null;
}

// The whole handler, outside the route so tests can call it with a real
// SQLite database and a fixed clock.
export async function handleCheckIn(
  request: Request,
  env: CheckInEnv | undefined,
  now: number,
): Promise<Response> {
  const identity = await identifyAccessRequest(request, env);
  if (!identity) return new Response(null, { status: 401 });

  let target: CheckInTarget | null;
  try {
    target = parseTarget(await request.json());
  } catch {
    target = null;
  }
  if (!target) return new Response(null, { status: 400 });

  let ticketId: string;
  if (target.kind === "token") {
    const secret = env?.TICKET_SIGNING_SECRET;
    if (!secret) return new Response(null, { status: 503 });
    let verified: string | null;
    try {
      verified = await verifyTicketToken(target.token, secret);
    } catch {
      // verifyTicketToken throws only on a secret too short to be the real one.
      return new Response(null, { status: 503 });
    }
    if (!verified) return new Response(null, { status: 404 });
    ticketId = verified;
  } else {
    ticketId = target.ticketId;
  }

  const db = env?.DB;
  if (!db) return new Response(null, { status: 503 });

  const result = await checkIn(db, { ticketId, by: identity.email, now });
  if (result.status === "not_valid") return new Response(null, { status: 404 });
  const body: CheckInResponseBody = result;
  return Response.json(body, { status: result.status === "checked_in" ? 200 : 409 });
}

export const Route = createFileRoute("/api/tickets/check-in")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const cf = (context as unknown as Record<string, unknown>).cloudflare as
          | { env: CheckInEnv }
          | undefined;
        return handleCheckIn(request, cf?.env, Date.now());
      },
    },
  },
});
