import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TicketsView } from "~/routes/tickets/index";
import { useStore } from "~/store";

// `/tickets` below its title, drawn from the persisted store with the network
// gone: `fetch` throws on every call, the way it does with no signal. The
// recover form's server function is mocked; its behaviour has its own tests
// in tests/unit/data/tickets.test.ts.

const { recoverTickets, fetchTicketAvailability } = vi.hoisted(() => ({
  recoverTickets: vi.fn(),
  fetchTicketAvailability: vi.fn(),
}));
vi.mock("~/data/tickets", () => ({ recoverTickets, fetchTicketAvailability }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ to, children, className }: { to: string; children: unknown; className?: string }) => (
    <a href={to} className={className}>
      {children as never}
    </a>
  ),
}));

const TOKEN_A = "aaaaaaaa-0000-4000-8000-000000000001.q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c";
const TOKEN_B = "aaaaaaaa-0000-4000-8000-000000000002.q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c";

beforeEach(async () => {
  localStorage.clear();
  recoverTickets.mockReset();
  // Sales off by default, the way production answers before the sale opens.
  fetchTicketAvailability.mockReset().mockResolvedValue(null);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }),
  );
  useStore.setState({ tickets: {}, shareTarget: null });
  await useStore.persist.rehydrate();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TicketsView", () => {
  it("shows the device's tickets with a QR each, offline, in seat order", async () => {
    useStore.getState().addTickets([
      {
        token: TOKEN_B,
        eventId: "format-004",
        tierName: "early",
        name: "Ada Buyer",
        seq: 1,
        quantity: 2,
        storedAt: 1,
      },
      {
        token: TOKEN_A,
        eventId: "format-004",
        tierName: "early",
        name: "Ada Buyer",
        seq: 0,
        quantity: 2,
        storedAt: 1,
      },
    ]);
    render(<TicketsView />);
    const qrs = await screen.findAllByRole("img", { name: "ticket QR code" });
    expect(qrs).toHaveLength(2);
    const labels = screen.getAllByText(/ticket \d of 2/).map((el) => el.textContent);
    expect(labels[0]).toContain("ticket 1 of 2");
    expect(labels[1]).toContain("ticket 2 of 2");
    expect(screen.getAllByText(/Form:at 004/)).toHaveLength(2);
    expect(screen.getAllByText(/Ada Buyer/)).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("says the sale is coming while tickets can't be bought, with the recover form", async () => {
    render(<TicketsView />);
    expect(await screen.findByText(/tickets for 004 go on sale soon/)).toBeInTheDocument();
    expect(fetchTicketAvailability).toHaveBeenCalledWith({ data: "format-004" });
    expect(screen.getByRole("button", { name: /send my tickets/i })).toBeInTheDocument();
  });

  it("points an empty device at the events page once the sale is open", async () => {
    fetchTicketAvailability.mockResolvedValue({
      eventId: "format-004",
      active: { name: "early", pricePence: 800, maxQuantity: 10 },
    });
    render(<TicketsView />);
    expect(
      await screen.findByText(/your tickets will appear here when you buy them/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /events/ })).toHaveAttribute("href", "/events");
    expect(screen.getByRole("button", { name: /send my tickets/i })).toBeInTheDocument();
  });

  it("covers a ticket sent to a friend and uncovers it on keep it", async () => {
    useStore.getState().addTickets([
      {
        token: TOKEN_A,
        eventId: "format-004",
        tierName: "early",
        name: null,
        seq: 0,
        quantity: 1,
        storedAt: 1,
      },
    ]);
    render(<TicketsView />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /send to a friend/ }));
    expect(useStore.getState().shareTarget).toMatchObject({ kind: "ticket", token: TOKEN_A });
    expect(screen.queryByTestId("ticket-sent-cover")).toBeNull();

    // What ShareModal does once the link has left it.
    useStore.getState().markTicketSent(TOKEN_A);
    expect(await screen.findByTestId("ticket-sent-cover")).toHaveTextContent("sent to a friend");
    expect(screen.getByText(/whoever scans it first gets in/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /keep it/ }));
    expect(screen.queryByTestId("ticket-sent-cover")).toBeNull();
    expect(useStore.getState().tickets[TOKEN_A]?.sentAt).toBeNull();
  });

  it("answers the recover form the same way whatever the server matched", async () => {
    recoverTickets.mockResolvedValue({ status: "ok" });
    render(<TicketsView />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/email/), "someone@example.com");
    await user.click(screen.getByRole("button", { name: /send my tickets/i }));
    expect(recoverTickets).toHaveBeenCalledWith({ data: { email: "someone@example.com" } });
    expect(await screen.findByRole("status")).toHaveTextContent(/on their way again/);
  });
});
