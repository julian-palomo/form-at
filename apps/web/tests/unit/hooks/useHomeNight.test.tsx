import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHomeNight } from "~/hooks/useHomeNight";
import { useStore } from "~/store";

// Which layout the home page shows. The night is format-004 with the clock
// set before it; the sale's answer is the mocked server function.

const { fetchTicketAvailability } = vi.hoisted(() => ({ fetchTicketAvailability: vi.fn() }));
vi.mock("~/data/tickets", () => ({ fetchTicketAvailability }));

const BEFORE_004 = new Date("2026-11-10T10:00:00Z");
const AFTER_004 = new Date("2026-12-06T12:00:00Z");
const ON_SALE = {
  eventId: "format-004",
  active: { name: "early", pricePence: 800, maxQuantity: 6 },
};
const TICKET = {
  token: "aaaaaaaa-0000-4000-8000-000000000001.sig",
  eventId: "format-004",
  tierName: "early",
  name: null,
  seq: 0,
  quantity: 1,
  storedAt: 1,
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(BEFORE_004);
  localStorage.clear();
  fetchTicketAvailability.mockReset();
  useStore.setState({ tickets: {} });
  await useStore.persist.rehydrate();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useHomeNight", () => {
  it("is the night while its tickets are on sale", async () => {
    fetchTicketAvailability.mockResolvedValue(ON_SALE);
    const { result } = renderHook(() => useHomeNight());
    expect(result.current.state).toBe("pending");
    await act(() => vi.runOnlyPendingTimersAsync());
    expect(result.current).toMatchObject({
      state: "night",
      event: { id: "format-004" },
      ticketCount: 0,
    });
  });

  it("is the listening layout when sales are off, sold out, or the request fails", async () => {
    for (const answer of [null, { eventId: "format-004", active: null }]) {
      fetchTicketAvailability.mockResolvedValue(answer);
      const { result, unmount } = renderHook(() => useHomeNight());
      await act(() => vi.runOnlyPendingTimersAsync());
      expect(result.current.state).toBe("listening");
      unmount();
    }
    fetchTicketAvailability.mockRejectedValue(new TypeError("Failed to fetch"));
    const { result } = renderHook(() => useHomeNight());
    await act(() => vi.runOnlyPendingTimersAsync());
    expect(result.current.state).toBe("listening");
  });

  it("stops waiting after 3 seconds and keeps the listening layout if the answer comes late", async () => {
    let answer: (value: typeof ON_SALE) => void = () => {};
    fetchTicketAvailability.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { result } = renderHook(() => useHomeNight());
    await act(() => vi.advanceTimersByTimeAsync(2999));
    expect(result.current.state).toBe("pending");
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current.state).toBe("listening");
    await act(async () => answer(ON_SALE));
    expect(result.current.state).toBe("listening");
  });

  it("is the night for a device holding a ticket, without asking about the sale", async () => {
    useStore.getState().addTickets([TICKET, { ...TICKET, token: "b.sig", seq: 1 }]);
    const { result } = renderHook(() => useHomeNight());
    expect(result.current).toMatchObject({ state: "night", ticketCount: 2 });
    expect(fetchTicketAvailability).not.toHaveBeenCalled();
  });

  it("is the listening layout once the night has ended, ticket or not", async () => {
    vi.setSystemTime(AFTER_004);
    useStore.getState().addTickets([TICKET]);
    const { result } = renderHook(() => useHomeNight());
    expect(result.current.state).toBe("listening");
    expect(fetchTicketAvailability).not.toHaveBeenCalled();
  });
});
