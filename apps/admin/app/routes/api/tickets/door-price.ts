import { createFileRoute } from "@tanstack/react-router";
import { DOOR_EVENT_ID } from "~/data/door";
import { type DoorSummary, readDoorSummary, setDoorPrice } from "~/data/door-sales";
import { type AccessEnv, identifyAccessRequest } from "~/utils/accessIdentity";

// Sets the door price on admin /door. It can change at any time: each sale
// stores the price it was made at, so expected cash stays right for the sales
// before the change. Mutates data, so it verifies the Access identity first
// and records its email as `updated_by`.

type DoorPriceEnv = AccessEnv & { DB?: D1Database };

export type DoorPriceResponseBody = { summary: DoorSummary };

/** £100, well above any door price; a typo like 12000 for £12 is refused. */
const MAX_PRICE_PENCE = 10_000;

function parsePricePence(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const price = (raw as Record<string, unknown>).pricePence;
  if (typeof price !== "number" || !Number.isInteger(price)) return null;
  if (price < 1 || price > MAX_PRICE_PENCE) return null;
  return price;
}

export async function handleDoorPrice(
  request: Request,
  env: DoorPriceEnv | undefined,
  now: number,
): Promise<Response> {
  const identity = await identifyAccessRequest(request, env);
  if (!identity) return new Response(null, { status: 401 });

  let pricePence: number | null;
  try {
    pricePence = parsePricePence(await request.json());
  } catch {
    pricePence = null;
  }
  if (pricePence == null) return new Response(null, { status: 400 });

  const db = env?.DB;
  if (!db) return new Response(null, { status: 503 });

  const updated = await setDoorPrice(db, {
    eventId: DOOR_EVENT_ID,
    pricePence,
    by: identity.email,
    now,
  });
  // No door_settings row: the door price was never set up for this event.
  if (!updated) return new Response(null, { status: 503 });

  const summary = await readDoorSummary(db, DOOR_EVENT_ID);
  if (!summary) return new Response(null, { status: 503 });
  const body: DoorPriceResponseBody = { summary };
  return Response.json(body);
}

export const Route = createFileRoute("/api/tickets/door-price")({
  server: {
    handlers: {
      POST: async ({ request, context }) => {
        const cf = (context as unknown as Record<string, unknown>).cloudflare as
          | { env: DoorPriceEnv }
          | undefined;
        return handleDoorPrice(request, cf?.env, Date.now());
      },
    },
  },
});
