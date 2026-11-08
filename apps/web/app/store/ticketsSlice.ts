import type { StateCreator } from "zustand";

// The tickets this device holds, keyed by token. There are no buyer
// accounts: the signed token in a ticket's QR is both the ticket and the key
// to it, so the device that saw it keeps it. A ticket lands here from the
// page Stripe returns the buyer to and from an emailed `/tickets/<token>`
// link, and `/tickets` draws every QR from this record alone, so the view
// works with no signal. What it can't know offline is whether the ticket was
// already used; the door decides that against D1.
//
// Persisted (store/index.ts). Only ids and plain strings: the event's title,
// date and venue come from `getEvent` at render time, never from storage, so
// a change to an event can't leave a stale copy here.

export type StoredTicket = {
  /** `<ticketId>.<signature>`, what the QR encodes and the ticket page's path. */
  token: string;
  eventId: string;
  tierName: string;
  /** The buyer's name as paid under; null when Stripe gave none. */
  name: string | null;
  /** The ticket's place in its order, from 0. */
  seq: number;
  /** Tickets in the order. */
  quantity: number;
  /** When this device first stored it, unix ms. */
  storedAt: number;
};

export type TicketsSlice = {
  tickets: Record<string, StoredTicket>;
  /** Adds what isn't stored yet; a ticket already here keeps its `storedAt`. */
  addTickets: (tickets: StoredTicket[]) => void;
};

export const createTicketsSlice: StateCreator<TicketsSlice, [], [], TicketsSlice> = (set) => ({
  tickets: {},
  addTickets: (incoming) =>
    set((state) => {
      const fresh = incoming.filter((t) => !state.tickets[t.token]);
      if (fresh.length === 0) return {};
      return {
        tickets: { ...state.tickets, ...Object.fromEntries(fresh.map((t) => [t.token, t])) },
      };
    }),
});

/** Stored tickets in order: by event date, then order, then seat. */
export function sortedTickets(
  tickets: Record<string, StoredTicket>,
  eventDate: (eventId: string) => string,
): StoredTicket[] {
  return Object.values(tickets).sort(
    (a, b) =>
      eventDate(a.eventId).localeCompare(eventDate(b.eventId)) ||
      a.storedAt - b.storedAt ||
      a.seq - b.seq,
  );
}
