import { createFileRoute } from "@tanstack/react-router";
import { DOOR_EVENT_ID } from "~/data/door";
import {
  type DoorMethod,
  type DoorSummary,
  type UndoneDoorSale,
  readDoorSummary,
  recordDoorSale,
  undoLastDoorSale,
} from "~/data/door-sales";
import { type AccessEnv, identifyAccessRequest } from "~/utils/accessIdentity";

// `+1 cash`, `+1 card` (POST) and `−1` (DELETE) on admin /door. Both mutate
// data, so both verify the Access identity first and record its email. Both
// answer with the fresh door numbers, so each tap also brings in the other
// door phones' sales.

type DoorSalesEnv = AccessEnv & { DB?: D1Database };

export type DoorSaleResponseBody = { summary: DoorSummary };
export type DoorUndoResponseBody = { undone: UndoneDoorSale; summary: DoorSummary };

function parseMethod(raw: unknown): DoorMethod | null {
  if (!raw || typeof raw !== "object") return null;
  const method = (raw as Record<string, unknown>).method;
  return method === "cash" || method === "card" ? method : null;
}

export async function handleDoorSale(
  request: Request,
  env: DoorSalesEnv | undefined,
  now: number,
): Promise<Response> {
  const identity = await identifyAccessRequest(request, env);
  if (!identity) return new Response(null, { status: 401 });

  let method: DoorMethod | null;
  try {
    method = parseMethod(await request.json());
  } catch {
    method = null;
  }
  if (!method) return new Response(null, { status: 400 });

  const db = env?.DB;
  if (!db) return new Response(null, { status: 503 });

  const recorded = await recordDoorSale(db, {
    id: crypto.randomUUID(),
    eventId: DOOR_EVENT_ID,
    method,
    by: identity.email,
    now,
  });
  // No door_settings row: the door price was never set up for this event.
  if (!recorded) return new Response(null, { status: 503 });

  const summary = await readDoorSummary(db, DOOR_EVENT_ID);
  if (!summary) return new Response(null, { status: 503 });
  const body: DoorSaleResponseBody = { summary };
  return Response.json(body);
}

export async function handleDoorUndo(
  request: Request,
  env: DoorSalesEnv | undefined,
  now: number,
): Promise<Response> {
  const identity = await identifyAccessRequest(request, env);
  if (!identity) return new Response(null, { status: 401 });

  const db = env?.DB;
  if (!db) return new Response(null, { status: 503 });

  const undone = await undoLastDoorSale(db, {
    eventId: DOOR_EVENT_ID,
    by: identity.email,
    now,
  });
  if (!undone) return new Response(null, { status: 404 });

  const summary = await readDoorSummary(db, DOOR_EVENT_ID);
  if (!summary) return new Response(null, { status: 503 });
  const body: DoorUndoResponseBody = { undone, summary };
  return Response.json(body);
}

function envOf(context: unknown): DoorSalesEnv | undefined {
  return ((context as Record<string, unknown>).cloudflare as { env: DoorSalesEnv } | undefined)
    ?.env;
}

export const Route = createFileRoute("/api/tickets/door-sales")({
  server: {
    handlers: {
      POST: async ({ request, context }) => handleDoorSale(request, envOf(context), Date.now()),
      DELETE: async ({ request, context }) => handleDoorUndo(request, envOf(context), Date.now()),
    },
  },
});
