import { Button, PageTitle, TerminalRow } from "@form-at/ui";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { PageLayout } from "~/components/PageLayout";
import { type OrderView, fetchOrderStatus } from "~/data/tickets";
import { pageHead } from "~/utils/head";
import { formatPence } from "~/utils/money";

// Where Stripe Checkout sends the buyer after paying
// (`success_url=…/tickets/success?session_id={CHECKOUT_SESSION_ID}`).
// The status comes from D1 through a POST server function on every load, and
// sw.ts keeps `/tickets/` out of its navigation cache, so this page is never
// served from a cache: a cached "confirming…" would never turn into "you're in".

export const Route = createFileRoute("/tickets/success")({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } =>
    typeof search.session_id === "string" ? { session_id: search.session_id } : {},
  loaderDeps: ({ search }) => ({ sessionId: search.session_id }),
  loader: async ({ deps }) => {
    if (!deps.sessionId) return { order: null };
    const order = await fetchOrderStatus({ data: deps.sessionId }).catch(() => null);
    return { order };
  },
  head: () =>
    pageHead({
      title: "Your ticket",
      description: "Your Form:at ticket.",
      path: "/tickets/success",
      noindex: true,
    }),
  component: TicketSuccess,
});

function TicketSuccess() {
  const { order } = Route.useLoaderData();
  return (
    <PageLayout>
      <div className="flex-1">{order ? <OrderState order={order} /> : <UnknownOrder />}</div>
    </PageLayout>
  );
}

function OrderState({ order }: { order: OrderView }) {
  const router = useRouter();
  const rows: Array<[string, string]> = [
    ["event", order.eventTitle],
    ["date", order.date],
    ["venue", order.venue],
    order.quantity > 1
      ? ["tickets", `${order.quantity} × ${order.tierName} · ${formatPence(order.amountPence)}`]
      : ["ticket", `${order.tierName} · ${formatPence(order.amountPence)}`],
  ];

  if (order.status === "paid") {
    return (
      <>
        <PageTitle className="text-3xl sm:text-4xl font-display font-bold leading-tight">
          you're in{order.name ? `, ${order.name}` : ""}
        </PageTitle>
        <div className="space-y-1 mb-6">
          {rows.map(([label, value]) => (
            <TerminalRow key={label} label={label} value={value} />
          ))}
        </div>
        <p className="text-sm sm:text-base text-grey leading-relaxed mb-10">
          stripe has emailed you a receipt. keep it: it's your proof of purchase at the door, with
          the name you paid under.
        </p>
      </>
    );
  }

  if (order.status === "pending") {
    return (
      <>
        <PageTitle className="text-3xl sm:text-4xl font-display font-bold leading-tight">
          payment received, confirming…
        </PageTitle>
        <p className="text-sm sm:text-base text-grey leading-relaxed mb-6">
          this usually takes a few seconds.
        </p>
        <Button variant="secondary" onClick={() => router.invalidate()}>
          check again
        </Button>
      </>
    );
  }

  return (
    <>
      <PageTitle className="text-3xl sm:text-4xl font-display font-bold leading-tight">
        this checkout {order.status === "refunded" ? "was refunded" : "expired"}
      </PageTitle>
      <p className="text-sm sm:text-base text-grey leading-relaxed mb-6">
        no ticket is attached to it.
      </p>
      <Link to="/events" className="text-sm text-grey hover:text-gold transition-colors">
        ‹ events
      </Link>
    </>
  );
}

function UnknownOrder() {
  return (
    <>
      <PageTitle className="text-3xl sm:text-4xl font-display font-bold leading-tight">
        we can't find this checkout
      </PageTitle>
      <p className="text-sm sm:text-base text-grey leading-relaxed mb-6">
        if you paid, stripe's receipt email is your proof of purchase.
      </p>
      <Link to="/events" className="text-sm text-grey hover:text-gold transition-colors">
        ‹ events
      </Link>
    </>
  );
}
