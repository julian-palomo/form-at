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
      active: { name: "early bird", pricePence: 800, maxQuantity: 1 },
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
      active: { name: "general", pricePence: 1200, maxQuantity: 1 },
    });
    startCheckout.mockResolvedValue({
      status: "redirect",
      url: "https://checkout.stripe.com/c/cs_test",
    });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<TicketBlock eventId={EVENT} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /buy ticket/i }));
    expect(startCheckout).toHaveBeenCalledWith({ data: { eventId: EVENT, quantity: 1 } });
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/cs_test");
  });

  it("explains a refusal and keeps the button usable", async () => {
    fetchTicketAvailability.mockResolvedValue({
      eventId: EVENT,
      active: { name: "general", pricePence: 1200, maxQuantity: 1 },
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
      active: { name: "general", pricePence: 1200, maxQuantity: 1 },
    });
    startCheckout.mockResolvedValue({ status: "sold_out" });
    render(<TicketBlock eventId={EVENT} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: /buy ticket/i }));
    expect(await screen.findByText("sold out.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("hides the stepper when only one ticket can be bought", async () => {
    fetchTicketAvailability.mockResolvedValue({
      eventId: EVENT,
      active: { name: "early", pricePence: 800, maxQuantity: 1 },
    });
    render(<TicketBlock eventId={EVENT} />);
    await screen.findByRole("button", { name: /buy ticket/i });
    expect(screen.queryByRole("button", { name: "one ticket more" })).not.toBeInTheDocument();
  });

  it("buys several tickets up to maxQuantity, showing the total", async () => {
    fetchTicketAvailability.mockResolvedValue({
      eventId: EVENT,
      active: { name: "general", pricePence: 1200, maxQuantity: 3 },
    });
    startCheckout.mockResolvedValue({ status: "redirect", url: "https://checkout.stripe.com/c/x" });
    vi.stubGlobal("location", { ...window.location, assign: vi.fn() });
    const user = userEvent.setup();
    render(<TicketBlock eventId={EVENT} />);

    const more = await screen.findByRole("button", { name: "one ticket more" });
    expect(screen.getByRole("button", { name: "one ticket fewer" })).toBeDisabled();
    await user.click(more);
    await user.click(more);
    expect(more).toBeDisabled();
    expect(screen.getByText("= £36")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /buy 3 tickets/i }));
    expect(startCheckout).toHaveBeenCalledWith({ data: { eventId: EVENT, quantity: 3 } });
  });

  it("lowers the stepper to what's left when the tier can no longer take the quantity", async () => {
    fetchTicketAvailability.mockResolvedValue({
      eventId: EVENT,
      active: { name: "early", pricePence: 800, maxQuantity: 4 },
    });
    startCheckout.mockResolvedValue({
      status: "fewer_left",
      availability: { eventId: EVENT, active: { name: "early", pricePence: 800, maxQuantity: 2 } },
    });
    const user = userEvent.setup();
    render(<TicketBlock eventId={EVENT} />);
    const more = await screen.findByRole("button", { name: "one ticket more" });
    for (let i = 0; i < 3; i++) await user.click(more);
    await user.click(screen.getByRole("button", { name: /buy 4 tickets/i }));

    expect(await screen.findByText(/fewer tickets are left/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /buy 2 tickets/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "one ticket more" })).toBeDisabled();
  });
});
