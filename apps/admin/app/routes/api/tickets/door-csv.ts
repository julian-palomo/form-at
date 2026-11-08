import type { PaidOrder } from "@form-at/data/tickets";
import { createFileRoute } from "@tanstack/react-router";
import { DOOR_EVENT_ID, readDoorOrders } from "~/data/door";
import type { AccessEnv } from "~/utils/accessIdentity";

// The door list as a CSV, for printing or for a phone with no signal. The
// path has no `.csv` extension on purpose: server.ts hands any path ending in
// an extension to the static assets, which would answer 404.

// One row per ticket; `ticket` is "2 of 3" for an order of several.
const HEADER = "name,email,tier,ticket,status,checked_in_at";

// A cell a spreadsheet would read as a formula gets a leading quote: names
// and emails are typed by buyers. Then RFC 4180 quoting for commas, quotes
// and line breaks.
function csvCell(value: string | null): string {
  if (value == null) return "";
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function buildDoorCsv(orders: PaidOrder[]): string {
  const rows = orders.map((o) =>
    [
      csvCell(o.name),
      csvCell(o.email),
      csvCell(o.tierName),
      o.seq == null ? "" : `${o.seq + 1} of ${o.quantity}`,
      o.checkedInAt == null ? "not_checked_in" : "checked_in",
      o.checkedInAt == null ? "" : new Date(o.checkedInAt).toISOString(),
    ].join(","),
  );
  return `${[HEADER, ...rows].join("\r\n")}\r\n`;
}

export async function handleDoorCsv(
  request: Request,
  env: (AccessEnv & { DB?: D1Database }) | undefined,
): Promise<Response> {
  const read = await readDoorOrders(request, env);
  if (!read.ok) return new Response(null, { status: read.reason === "unauthorized" ? 401 : 503 });
  return new Response(buildDoorCsv(read.orders), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${DOOR_EVENT_ID}-door.csv"`,
      // Every buyer's name and email: no cache may keep a copy.
      "Cache-Control": "no-store",
    },
  });
}

export const Route = createFileRoute("/api/tickets/door-csv")({
  server: {
    handlers: {
      GET: async ({ request, context }) => {
        const cf = (context as unknown as Record<string, unknown>).cloudflare as
          | { env: AccessEnv & { DB?: D1Database } }
          | undefined;
        return handleDoorCsv(request, cf?.env);
      },
    },
  },
});
