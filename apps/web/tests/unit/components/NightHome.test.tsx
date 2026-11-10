import { getEvent } from "@form-at/data/events";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NightHome } from "~/components/home/NightHome";

// The home page's night layout: what its one button says and where it goes,
// for a visitor and for a device that already holds a ticket.

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    to,
    params,
    children,
    onClick,
  }: {
    to: string;
    params?: { eventId?: string };
    children: unknown;
    onClick?: () => void;
  }) => (
    <a
      href={to.replace("$eventId", params?.eventId ?? "")}
      onClick={(e) => {
        e.preventDefault();
        onClick?.();
      }}
    >
      {children as never}
    </a>
  ),
}));

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }));
vi.mock("~/hooks/useTrackEvent", () => ({ useTrackEvent: () => trackEvent }));

beforeEach(() => {
  trackEvent.mockReset();
});

function renderNight(ticketCount: number) {
  const event = getEvent("format-004");
  if (!event) throw new Error("format-004 is gone from events.ts");
  render(<NightHome event={event} ticketCount={ticketCount} style={{}} pulseDelay="0s" />);
}

describe("NightHome", () => {
  it("points a visitor at the event page, with the night in one line", async () => {
    renderNight(0);
    expect(screen.getByText("sat 5 dec · stereo · 23:00")).toBeInTheDocument();
    const button = screen.getByRole("link", { name: /get_tickets_for_004/ });
    expect(button).toHaveAttribute("href", "/events/format-004");
    // The image is a second way to the same page.
    expect(screen.getByRole("link", { name: "Form:at 004" })).toHaveAttribute(
      "href",
      "/events/format-004",
    );

    await userEvent.click(button);
    expect(trackEvent.mock.calls).toEqual([["home_tickets_click"]]);
  });

  it("sends a device that holds tickets to them instead, and doesn't pulse", async () => {
    renderNight(2);
    expect(screen.queryByRole("link", { name: /get_tickets/ })).toBeNull();
    const button = screen.getByRole("link", { name: /your_tickets_for_004/ });
    expect(button).toHaveAttribute("href", "/tickets");
    expect(button.style.animation).toBe("");

    await userEvent.click(button);
    expect(trackEvent.mock.calls).toEqual([["home_your_tickets_click"]]);
  });

  it("says ticket, singular, for one", () => {
    renderNight(1);
    expect(screen.getByRole("link", { name: /your_ticket_for_004/ })).toBeInTheDocument();
  });
});
