import type { PaidOrder } from "@form-at/data/tickets";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DoorList } from "~/components/DoorList";
import type { DoorSummary } from "~/data/door-sales";

// 23:42 UTC on 5 Dec is 23:42 in Glasgow (GMT in winter).
const CHECKED_IN_AT = Date.UTC(2026, 11, 5, 23, 42);

function order(overrides: Partial<PaidOrder> & Pick<PaidOrder, "orderId">): PaidOrder {
  return {
    ticketId: `ticket-${overrides.orderId}`,
    seq: 0,
    quantity: 1,
    name: null,
    email: null,
    tierName: "general",
    amountPence: 1200,
    paidAt: CHECKED_IN_AT - 86_400_000,
    checkedInAt: null,
    checkedInBy: null,
    ...overrides,
  };
}

const ORDERS: PaidOrder[] = [
  order({
    orderId: "1",
    name: "Ada Morrison",
    email: "ada@example.com",
    checkedInAt: CHECKED_IN_AT,
  }),
  order({ orderId: "2", name: "Callum Reid", email: "callum.reid@example.com" }),
  order({ orderId: "3", name: "Isla Grant", email: "isla@example.com" }),
  order({ orderId: "4", name: null, email: "no-name@example.com" }),
];

const noRefresh = async () => {};

const DOOR: DoorSummary = { pricePence: 1200, cash: 2, card: 1, expectedCashPence: 2400 };

function rowNames() {
  return within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("p")?.textContent);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DoorList", () => {
  it("filters by name, case-insensitive and by substring", async () => {
    render(<DoorList orders={ORDERS} door={DOOR} capacity={300} onRefresh={noRefresh} />);
    await userEvent.type(screen.getByLabelText(/search name or email/i), "REI");
    expect(rowNames()).toEqual(["Callum Reid"]);
  });

  it("filters by email", async () => {
    render(<DoorList orders={ORDERS} door={DOOR} capacity={300} onRefresh={noRefresh} />);
    await userEvent.type(screen.getByLabelText(/search name or email/i), "isla@");
    expect(rowNames()).toEqual(["Isla Grant"]);
  });

  it("finds an order with no name by its email", async () => {
    render(<DoorList orders={ORDERS} door={DOOR} capacity={300} onRefresh={noRefresh} />);
    await userEvent.type(screen.getByLabelText(/search name or email/i), "no-name");
    expect(rowNames()).toEqual(["no name"]);
  });

  it("shows the time on a checked-in row instead of the button", () => {
    render(<DoorList orders={ORDERS} door={DOOR} capacity={300} onRefresh={noRefresh} />);
    const ada = screen.getByText("Ada Morrison").closest("li");
    if (!ada) throw new Error("no row for Ada");
    expect(within(ada).getByText("in at 23:42")).toBeInTheDocument();
    expect(within(ada).queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("button", { name: /check in/i })).toHaveLength(3);
  });

  it("counts paid online, online in and to come, and adds the door to inside", () => {
    render(<DoorList orders={ORDERS} door={DOOR} capacity={300} onRefresh={noRefresh} />);
    expect(screen.getByText("paid online").nextSibling?.textContent).toBe("4");
    expect(screen.getByText("online in").nextSibling?.textContent).toBe("1");
    expect(screen.getByText("to come").nextSibling?.textContent).toBe("3");
    // 1 online in + 3 at the door; 300 − 4 paid online − 3 at the door.
    expect(screen.getByText("inside").nextSibling?.textContent).toBe("4 / 300");
    expect(screen.getByText("room left").nextSibling?.textContent).toBe("293");
  });

  it("shows placeholders, never 0, when the list couldn't be read", () => {
    render(<DoorList orders={null} door={null} capacity={300} onRefresh={noRefresh} />);
    for (const label of ["paid online", "online in", "to come", "door cash", "room left"]) {
      expect(screen.getByText(label).nextSibling?.textContent).toBe("—");
    }
    expect(screen.getByText(/couldn't load the door list/i)).toBeInTheDocument();
  });

  it("says when a ticket was already used, from the 409", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { status: "already_used", checkedInAt: CHECKED_IN_AT, checkedInBy: "door@example.com" },
          { status: 409 },
        ),
      ),
    );
    render(<DoorList orders={ORDERS} door={DOOR} capacity={300} onRefresh={noRefresh} />);
    const isla = screen.getByText("Isla Grant").closest("li");
    if (!isla) throw new Error("no row for Isla");

    await userEvent.click(within(isla).getByRole("button", { name: /check in/i }));

    expect(await within(isla).findByText(/already used at 23:42/)).toBeInTheDocument();
    expect(within(isla).getByText("by door@example.com")).toBeInTheDocument();
    expect(screen.getByText("online in").nextSibling?.textContent).toBe("2");
  });

  it("lists each ticket of an order of several as its own row, numbered, and counts tickets", () => {
    const group = [0, 1, 2].map((seq) =>
      order({
        orderId: "g",
        ticketId: `g-${seq}`,
        seq,
        quantity: 3,
        name: "Group Buyer",
        amountPence: 3600,
      }),
    );
    render(<DoorList orders={group} door={DOOR} capacity={300} onRefresh={noRefresh} />);
    expect(screen.getByText("general · 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("general · 3 of 3")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /check in/i })).toHaveLength(3);
    expect(screen.getByText("paid online").nextSibling?.textContent).toBe("3");
  });

  it("counts every seat of a paid order whose tickets are missing", () => {
    const missing = order({ orderId: "m", ticketId: null, seq: null, quantity: 4 });
    render(<DoorList orders={[missing]} door={DOOR} capacity={300} onRefresh={noRefresh} />);
    expect(screen.getByText("paid online").nextSibling?.textContent).toBe("4");
    expect(screen.getByText("general · 4 tickets")).toBeInTheDocument();
  });
});
