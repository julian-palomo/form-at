import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TicketBlock } from "~/components/TicketBlock";

// The server functions are mocked: what's under test is what the block shows
// for each answer. Their behaviour is covered in tests/unit/data/tickets.test.ts.

const { fetchTicketAvailability, startCheckout } = vi.hoisted(() => ({
  fetchTicketAvailability: vi.fn(),
  startCheckout: vi.fn(),
}));
vi.mock("~/data/tickets", () => ({ fetchTicketAvailability, startCheckout }));

const EVENT = "format-004";

beforeEach(() => {
  fetchTicketAvailability.mockReset();
  startCheckout.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TicketBlock", () => {
  it("shows the active tier's name and price with a buy button", async () => {
    fetchTicketAvailability.mockResolvedValue({
      eventId: EVENT,
      active: { name: "early bird", pricePence: 800 },
    });
    render(<TicketBlock eventId={EVENT} />);
    expect(await screen.findByText("early bird · £8")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /buy ticket/i })).toBeInTheDocument();
    expect(fetchTicketAvailability).toHaveBeenCalledWith({ data: EVENT });
  });

  it("shows sold out without a buy button when every tier is full", async () => {
    fetchTicketAvailability.mockResolvedValue({ eventId: EVENT, active: null });
    render(<TicketBlock eventId={EVENT} />);
    expect(await screen.findByText("sold out.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing when sales are off", async () => {
    fetchTicketAvailability.mockResolvedValue(null);
    const { container } = render(<TicketBlock eventId={EVENT} />);
    await vi.waitFor(() => expect(fetchTicketAvailability).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("sends the buyer to Stripe on a redirect", async () => {
    fetchTicketAvailability.mockResolvedValue({
      eventId: EVENT,
      active: { name: "general", pricePence: 1200 },
    });
    startCheckout.mockResolvedValue({
      status: "redirect",
      url: "https://checkout.stripe.com/c/cs_test",
    });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<TicketBlock eventId={EVENT} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /buy ticket/i }));
    expect(startCheckout).toHaveBeenCalledWith({ data: EVENT });
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/cs_test");
  });

  it("explains a refusal and keeps the button usable", async () => {
    fetchTicketAvailability.mockResolvedValue({
      eventId: EVENT,
      active: { name: "general", pricePence: 1200 },
    });
    startCheckout.mockResolvedValue({ status: "too_many_holds" });
    render(<TicketBlock eventId={EVENT} />);
    const button = await screen.findByRole("button", { name: /buy ticket/i });
    await userEvent.setup().click(button);
    expect(await screen.findByRole("status")).toHaveTextContent(/checkouts open/);
    expect(screen.getByRole("button", { name: /buy ticket/i })).toBeEnabled();
  });

  it("switches to sold out when the last seat went while the page was open", async () => {
    fetchTicketAvailability.mockResolvedValue({
      eventId: EVENT,
      active: { name: "general", pricePence: 1200 },
    });
    startCheckout.mockResolvedValue({ status: "sold_out" });
    render(<TicketBlock eventId={EVENT} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /buy ticket/i }));
    expect(await screen.findByText("sold out.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
