import type { DJ } from "@form-at/data/djs";
import type { Event } from "@form-at/data/events";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "~/routes/events/$eventId";

// The event page's order: title with [ share ] and [ add_to_calendar ] on
// its row, facts, lineup, tickets, description, flyer last. The buy button is
// the page's one heavy call to action; add-to-calendar is a bracket button
// at share's weight and opens the same menu it always did.

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      to,
      params,
      children,
    }: { to: string; params?: Record<string, string>; children: ReactNode }) => (
      <a href={to.replace("$djId", params?.djId ?? "")}>{children}</a>
    ),
  };
});
// PageLayout reads the router's location for its transition; no router here.
vi.mock("~/components/PageLayout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
// The buy block loads availability through a server function; the page's
// order is what this test is about, so it stands in as a marker.
vi.mock("~/components/TicketBlock", () => ({
  TicketBlock: () => <div data-testid="ticket-block">tickets</div>,
}));

const dj: DJ = { id: "test-dj", name: "Test DJ", type: "guest" };
const event: Event = {
  id: "format-004",
  title: "Form:at 004",
  date: "2026-12-05",
  venue: "Stereo, Renfield Lane, City Centre, Glasgow",
  city: "Glasgow",
  lineupIds: [dj.id],
  audio: "techno",
  runtime: "23:00 — 05:00",
  status: "upcoming",
  description: "our first saturday at stereo.",
  flyer: "/flyers/format-004.jpg",
};

function renderPage(overrides: Partial<Event> = {}) {
  vi.spyOn(Route, "useLoaderData").mockReturnValue({
    event: { ...event, ...overrides },
    lineup: [dj],
  });
  const Page = Route.options.component as ComponentType;
  return render(<Page />);
}

/** Whether `a` comes before `b` in the document. */
function precedes(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe("event page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("orders facts, lineup, tickets, description and the flyer last", () => {
    renderPage();
    const facts = screen.getByText(/^venue:/).closest("p");
    const lineup = screen.getByText("Test DJ");
    const tickets = screen.getByTestId("ticket-block");
    const description = screen.getByText(/our first saturday/);
    const flyer = screen.getByRole("img", { name: "Form:at 004" });
    if (!facts) throw new Error("no facts");
    expect(precedes(facts, lineup)).toBe(true);
    expect(precedes(lineup, tickets)).toBe(true);
    expect(precedes(tickets, description)).toBe(true);
    expect(precedes(description, flyer)).toBe(true);
  });

  it("puts share and add_to_calendar together on the title's row, add_to_calendar opening its menu", async () => {
    renderPage();
    const share = screen.getByRole("button", { name: /share/ });
    const calendar = screen.getByRole("button", { name: /add_to_calendar/ });
    expect(share.parentElement).toBe(calendar.parentElement);
    const title = screen.getByRole("heading", { name: /Form:at 004/ });
    expect(title.parentElement).toBe(share.parentElement?.parentElement);

    await userEvent.setup().click(calendar);
    expect(screen.getByRole("link", { name: /google/i })).toBeInTheDocument();
  });

  it("has no add_to_calendar for a past event", () => {
    renderPage({ status: "past" });
    expect(screen.queryByRole("button", { name: /add_to_calendar/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /share/ })).toBeInTheDocument();
  });
});
