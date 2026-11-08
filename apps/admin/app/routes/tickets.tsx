import { PageTitle } from "@form-at/ui";
import { createFileRoute } from "@tanstack/react-router";
import { OrdersList } from "~/components/OrdersList";
import { SalesTotals } from "~/components/SalesTotals";
import { fetchSalesPageData, grossPence } from "~/data/sales";

export const Route = createFileRoute("/tickets")({
  loader: () => fetchSalesPageData(),
  head: () => ({ meta: [{ title: "Tickets · Form:at Admin" }] }),
  component: TicketsPage,
});

// The sale while it runs: totals per tier, then every order. The loader
// verifies the Access identity itself (data/sales.ts) because the list holds
// every buyer's name and email.
function TicketsPage() {
  const data = Route.useLoaderData();
  const gross = data.orders ? grossPence(data.orders) : null;

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      <div className="flex items-baseline gap-3">
        <PageTitle>tickets</PageTitle>
        {data.isSampleData && (
          <span className="text-xs font-mono px-2 py-0.5 border border-gold text-gold">
            sample data
          </span>
        )}
      </div>
      <SalesTotals tiers={data.tiers} grossPence={gross} />
      <OrdersList orders={data.orders} now={data.now} />
    </div>
  );
}
