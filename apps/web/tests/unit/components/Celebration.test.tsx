import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Celebration, { CELEBRATION_MS } from "~/components/tickets/Celebration";

// The confetti layer: decorative, out of the accessibility tree and out of
// the way of taps, hidden outright under "reduce motion" (jsdom applies no
// media queries, so the class is what can be asserted), and over when it
// says so.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Celebration", () => {
  it("draws its squares in a layer that is hidden from assistive tech and under reduce-motion", () => {
    render(<Celebration onDone={() => {}} />);
    const layer = screen.getByTestId("celebration");
    expect(layer).toHaveAttribute("aria-hidden", "true");
    expect(layer).toHaveClass("pointer-events-none", "motion-reduce:hidden");
    expect(layer.querySelectorAll("i").length).toBeGreaterThan(20);
    for (const square of layer.querySelectorAll("i")) {
      expect(square.style.animation).toContain("ticket-confetti-fall");
    }
  });

  it("reports done once the last square has landed, and not before", () => {
    const onDone = vi.fn();
    render(<Celebration onDone={onDone} />);
    act(() => {
      vi.advanceTimersByTime(CELEBRATION_MS - 1);
    });
    expect(onDone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
