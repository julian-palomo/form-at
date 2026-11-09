import { describe, expect, it } from "vitest";
import { routeIndex } from "~/components/SwipeNavigator";

// Which pages the swipe strip covers. A page outside it (a ticket, the
// tickets list, a 404) is -1: no swipe moves it and no dots are drawn, so a
// buyer looking at their ticket can't swipe it away to the home page.

describe("routeIndex", () => {
  it("maps the four tabs and their sub-pages", () => {
    expect(routeIndex("/")).toBe(0);
    expect(routeIndex("/sets")).toBe(1);
    expect(routeIndex("/sets/some-set")).toBe(1);
    expect(routeIndex("/events/format-004")).toBe(2);
    expect(routeIndex("/djs/dzeko")).toBe(3);
  });

  it("puts the ticket pages and unknown paths outside the strip", () => {
    expect(routeIndex("/tickets")).toBe(-1);
    expect(routeIndex("/tickets/success")).toBe(-1);
    expect(routeIndex("/tickets/abc.sig")).toBe(-1);
    expect(routeIndex("/nowhere")).toBe(-1);
  });
});
