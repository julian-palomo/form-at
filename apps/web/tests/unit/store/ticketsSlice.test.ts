import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "~/store";
import { type StoredTicket, sortedTickets } from "~/store/ticketsSlice";

// The device's tickets: added once, kept across a reload, ordered for the
// page. Persistence runs through the real store and the in-memory
// localStorage tests/setup.ts installs.

const ticket = (token: string, seq: number, storedAt = 1): StoredTicket => ({
  token,
  eventId: "format-004",
  tierName: "early",
  name: "Ada",
  seq,
  quantity: 2,
  storedAt,
});

beforeEach(async () => {
  localStorage.clear();
  useStore.setState({ tickets: {} });
  await useStore.persist.rehydrate();
});

describe("ticketsSlice", () => {
  it("adds tickets once, keeping the first storedAt of one seen again", () => {
    useStore.getState().addTickets([ticket("a", 0, 1)]);
    useStore.getState().addTickets([ticket("a", 0, 99), ticket("b", 1, 2)]);
    expect(useStore.getState().tickets).toEqual({ a: ticket("a", 0, 1), b: ticket("b", 1, 2) });
  });

  it("survives a reload, and an old payload without tickets reads as none", async () => {
    useStore.getState().addTickets([ticket("a", 0)]);
    const saved = localStorage.getItem("format-player") ?? "";
    expect(saved).toContain('"tickets"');

    // setState writes through to storage, so the saved payload is put back
    // before rehydrating, the way a fresh session finds it.
    useStore.setState({ tickets: {} });
    localStorage.setItem("format-player", saved);
    await useStore.persist.rehydrate();
    expect(useStore.getState().tickets).toEqual({ a: ticket("a", 0) });

    const payload = JSON.parse(saved) as { state: Record<string, unknown> };
    payload.state.tickets = undefined;
    localStorage.setItem("format-player", JSON.stringify(payload));
    await useStore.persist.rehydrate();
    expect(useStore.getState().tickets).toEqual({});
  });

  it("orders tickets by event date, then when they were stored, then seat", () => {
    const list = sortedTickets(
      {
        c: { ...ticket("c", 0, 5), eventId: "later" },
        b: ticket("b", 1, 1),
        a: ticket("a", 0, 1),
      },
      (eventId) => (eventId === "later" ? "2027-01-01" : "2026-12-05"),
    );
    expect(list.map((t) => t.token)).toEqual(["a", "b", "c"]);
  });
});
