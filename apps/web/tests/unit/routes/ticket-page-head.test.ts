import { describe, expect, it, vi } from "vitest";
import type { TicketPageView } from "~/data/tickets";
import { Route } from "~/routes/tickets/$token";

// The Open Graph tags a messaging app reads when a ticket's link is sent to
// a friend: the event's name and banner, and nothing from the ticket. The
// page stays out of search results and keeps its URL out of Referer headers.

vi.mock("~/data/tickets", () => ({
  fetchTicket: vi.fn(),
  parseTicketToken: (s: string) => s,
}));

const TOKEN = "aaaaaaaa-0000-4000-8000-000000000001.q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c";

const ticket: TicketPageView = {
  token: TOKEN,
  eventId: "format-004",
  eventTitle: "Form:at 004",
  date: "2026-12-05",
  venue: "Stereo",
  runtime: "23:00 – 03:00",
  tierName: "early",
  name: "Ada Buyer",
  seq: 0,
  quantity: 2,
  checkedInAt: null,
};

type Meta = { title?: string; name?: string; property?: string; content?: string };

function headOf(loaderData: { ticket: TicketPageView } | undefined) {
  const head = Route.options.head as (ctx: { loaderData: typeof loaderData }) => {
    meta: Meta[];
    links: Array<{ rel: string; href: string }>;
  };
  return head({ loaderData });
}

const byProperty = (meta: Meta[], property: string) =>
  meta.find((m) => m.property === property)?.content;
const byName = (meta: Meta[], name: string) => meta.find((m) => m.name === name)?.content;

describe("/tickets/$token head", () => {
  it("names the event and its banner, nothing from the ticket", () => {
    const { meta, links } = headOf({ ticket });
    expect(byProperty(meta, "og:title")).toBe("your ticket for Form:at 004");
    expect(byProperty(meta, "og:image")).toBe("https://formatglasgow.com/og/events/format-004.jpg");
    expect(byProperty(meta, "og:url")).toBe("https://formatglasgow.com/tickets");
    expect(links[0]?.href).toBe("https://formatglasgow.com/tickets");
    expect(byName(meta, "robots")).toBe("noindex");
    expect(byName(meta, "referrer")).toBe("no-referrer");

    const everything = JSON.stringify(meta);
    expect(everything).not.toContain("Ada");
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain("early");
  });

  it("falls back to a plain title without loader data", () => {
    const { meta } = headOf(undefined);
    expect(byProperty(meta, "og:title")).toBe("Your ticket");
    expect(byProperty(meta, "og:image")).toBeUndefined();
    expect(byName(meta, "robots")).toBe("noindex");
  });
});
