import { describe, expect, it } from "vitest";
import { routeIndex } from "~/components/SwipeNavigator";

// Which pages the swipe strip covers: the five tabs in nav order, sets in
// the centre, every ticket page under the last. A page outside it (a 404) is
// -1: no swipe moves it and no dots are drawn.

describe("routeIndex", () => {
  it("maps the five tabs and their sub-pages, in nav order", () => {
    expect(routeIndex("/")).toBe(0);
    expect(routeIndex("/events")).toBe(1);
    expect(routeIndex("/events/format-004")).toBe(1);
    expect(routeIndex("/sets")).toBe(2);
    expect(routeIndex("/sets/some-set")).toBe(2);
    expect(routeIndex("/djs/dzeko")).toBe(3);
  });

  it("puts every ticket page under the tickets tab", () => {
    expect(routeIndex("/tickets")).toBe(4);
    expect(routeIndex("/tickets/success")).toBe(4);
    expect(routeIndex("/tickets/abc.sig")).toBe(4);
  });

  it("puts an unknown path outside the strip", () => {
    expect(routeIndex("/nowhere")).toBe(-1);
  });
});
