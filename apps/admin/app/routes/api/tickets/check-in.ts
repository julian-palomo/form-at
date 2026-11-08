import { checkIn } from "@form-at/data/tickets";
import { createFileRoute } from "@tanstack/react-router";
import { type AccessEnv, identifyAccessRequest } from "~/utils/accessIdentity";

// Lets one ticket in at the door. Mutates data, so it verifies the Access
// identity first and records that identity's email as `checked_in_by`. The
// once-only guarantee lives in `checkIn`'s conditional UPDATE, not here: two
// door phones tapping the same row both reach it, and only one gets
// `checked_in`.

type CheckInEnv = AccessEnv & { DB?: D1Database };

export type CheckInResponseBody =
  | { status: "checked_in"; checkedInAt: number }
  | { status: "already_used"; checkedInAt: number; checkedInBy: string | null };

const MAX_TICKET_ID_LEN = 100;

function parseTicketId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const ticketId = (raw as Record<string, unknown>).ticketId;
  if (typeof ticketId !== "string" || ticketId.length === 0) return null;
  if (ticketId.length > MAX_TICKET_ID_LEN) return null;
  return ticketId;
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

  let ticketId: string | null;
  try {
    ticketId = parseTicketId(await request.json());
  } catch {
    ticketId = null;
  }
  if (!ticketId) return new Response(null, { status: 400 });

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
