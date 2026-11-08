import { cn } from "@form-at/ui";
import type { SalesOrder } from "~/data/sales";
import { fmtClock, fmtDateTime, fmtPounds } from "~/utils/fmt";

// Every order of the event, newest first, stacked so it reads on a phone:
// name and status, then email, then tier · tickets · amount · when.
//
// A pending order is muted. While its hold is live it says until when, so an
// abandoned checkout sitting on seats is visible; once past `expiresAt` it
// holds nothing (the seat counts ignore it) and reads "lapsed" until the
// Stripe expiry webhook marks it expired.

interface OrdersListProps {
  /** null when the orders couldn't be read. */
  orders: SalesOrder[] | null;
  /** Server time of the read: decides "holding until" vs "lapsed". */
  now: number;
}

function statusLabel(order: SalesOrder, now: number): string {
  switch (order.status) {
    case "paid":
      return `${order.ticketsIn} of ${order.quantity} in`;
    case "pending":
      return order.expiresAt > now ? `holding until ${fmtClock(order.expiresAt)}` : "lapsed";
    case "expired":
      return "expired";
    case "refunded":
      return "refunded";
    default: {
      const unhandled: never = order.status;
      throw new Error(String(unhandled));
    }
  }
}

export function OrdersList({ orders, now }: OrdersListProps) {
  if (orders == null) {
    return <p className="t-body text-grey">Couldn't read the orders. Reload the page.</p>;
  }
  if (orders.length === 0) {
    return <p className="t-body text-grey">No orders yet.</p>;
  }

  return (
    <ul className="divide-y divide-grey/10 border-y border-grey/10">
      {orders.map((order) => {
        const muted = order.status !== "paid";
        const ticketsLabel = order.quantity === 1 ? "1 ticket" : `${order.quantity} tickets`;
        return (
          <li key={order.orderId} className={cn("py-3", muted && "text-grey/50")}>
            <div className="flex items-baseline justify-between gap-4">
              <p
                className={cn(
                  "min-w-0 text-lg",
                  !muted && "text-white",
                  order.name == null && "italic",
                )}
              >
                {order.name ?? "no name"}
              </p>
              <p
                className={cn(
                  "shrink-0 text-sm",
                  order.status === "paid" ? "text-gold" : "",
                  order.status === "refunded" && "text-red-400/70",
                )}
              >
                {statusLabel(order, now)}
              </p>
            </div>
            <p className={cn("text-sm break-all", !muted && "text-grey")}>
              {order.email ?? "no email"}
            </p>
            <p className={cn("text-xs tracking-widest", !muted && "text-grey/70")}>
              {order.tierName} · {ticketsLabel} · {fmtPounds(order.amountPence)} ·{" "}
              {fmtDateTime(order.createdAt)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
