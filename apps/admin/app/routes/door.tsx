import { PageTitle } from "@form-at/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { DoorList } from "~/components/DoorList";
import { fetchDoorPageData } from "~/data/door";

export const Route = createFileRoute("/door")({
  loader: () => fetchDoorPageData(),
  head: () => ({ meta: [{ title: "Door · Form:at Admin" }] }),
  component: DoorPage,
});

// The door list for the event on sale. The loader verifies the Access
// identity itself (data/door.ts) because the list is every buyer's name and
// email, and the check-in endpoint verifies it again on every tap. Refresh
// reloads the loader: with two phones on the door, each holds the list as it
// was loaded until then.
function DoorPage() {
  const data = Route.useLoaderData();
  const router = useRouter();

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-5">
      <div className="flex items-baseline gap-3">
        <PageTitle>door</PageTitle>
        {data.isSampleData && (
          <span className="text-xs font-mono px-2 py-0.5 border border-gold text-gold">
            sample data
          </span>
        )}
      </div>
      <DoorList orders={data.orders} onRefresh={() => router.invalidate()} />
    </div>
  );
}
