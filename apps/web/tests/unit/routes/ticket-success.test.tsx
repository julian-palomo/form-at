import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderView } from "~/data/tickets";
import { OrderState } from "~/routes/tickets/success";
import { useStore } from "~/store";

// The page Stripe returns to, for a paid order: the celebration plays the
// first time this device sees the order paid, is remembered per checkout
// session in the persisted store, and never replays; the tickets are drawn
// in their frames regardless.

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouter: () => ({ invalidate: vi.fn() }),
  Link: ({ to, children }: { to: string; children: unknown }) => (
    <a href={to}>{children as never}</a>
  ),
}));

const TOKEN = "aaaaaaaa-0000-4000-8000-000000000001.q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c";

const paid: OrderView = {
  status: "paid",
  eventId: "format-004",
  eventTitle: "Form:at 004",
  date: "Sat 05.12",
  venue: "Stereo",
  tierName: "early",
  quantity: 1,
  amountPence: 800,
  name: "Ada",
  tickets: [{ token: TOKEN, seq: 0 }],
};

beforeEach(async () => {
  localStorage.clear();
  useStore.setState({ tickets: {}, celebratedOrders: [] });
  await useStore.persist.rehydrate();
});

describe("ticket success page", () => {
  it("celebrates a paid order once per checkout session and remembers it", async () => {
    const first = render(<OrderState order={paid} sessionId="cs_test_a" />);
    expect(await screen.findByTestId("celebration")).toBeInTheDocument();
    expect(screen.getByText("ticket")).toBeInTheDocument();
    expect(useStore.getState().celebratedOrders).toEqual(["cs_test_a"]);
    expect(localStorage.getItem("format-player")).toContain("cs_test_a");
    first.unmount();

    render(<OrderState order={paid} sessionId="cs_test_a" />);
    await screen.findByRole("img", { name: "ticket QR code" });
    expect(screen.queryByTestId("celebration")).not.toBeInTheDocument();
  });

  it("celebrates a different order on the same device", async () => {
    useStore.getState().markCelebrated("cs_test_a");
    render(<OrderState order={paid} sessionId="cs_test_b" />);
    expect(await screen.findByTestId("celebration")).toBeInTheDocument();
    expect(useStore.getState().celebratedOrders).toEqual(["cs_test_a", "cs_test_b"]);
  });

  it("celebrates nothing while the order is still pending", async () => {
    render(
      <OrderState order={{ ...paid, status: "pending", tickets: [] }} sessionId="cs_test_c" />,
    );
    expect(await screen.findByText(/confirming/)).toBeInTheDocument();
    expect(screen.queryByTestId("celebration")).not.toBeInTheDocument();
    expect(useStore.getState().celebratedOrders).toEqual([]);
  });
});
