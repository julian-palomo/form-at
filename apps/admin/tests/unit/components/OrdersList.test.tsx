import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OrdersList } from "~/components/OrdersList";
import type { SalesOrder } from "~/data/sales";

// 21:30 UTC on 14 Nov is 21:30 in Glasgow (GMT in winter).
const NOW = Date.UTC(2026, 10, 14, 21, 30);
const MINUTE = 60_000;

function order(overrides: Partial<SalesOrder> & Pick<SalesOrder, "orderId">): SalesOrder {
  return {
    name: "Isla Grant",
    email: "isla@example.com",
    tierName: "second",
    quantity: 1,
    amountPence: 1000,
    createdAt: NOW - 10 * MINUTE,
    paidAt: NOW - 9 * MINUTE,
    expiresAt: NOW + 25 * MINUTE,
    status: "paid",
    ticketsIn: 0,
    ...overrides,
  };
}

function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest("li");
  if (!row) throw new Error(`no row for ${text}`);
  return row;
}

describe("OrdersList", () => {
  it("shows a paid order with how many of its tickets are in", () => {
    render(
      <OrdersList
        orders={[order({ orderId: "1", quantity: 3, amountPence: 3000, ticketsIn: 1 })]}
        now={NOW}
      />,
    );
    expect(screen.getByText("1 of 3 in")).toBeInTheDocument();
    expect(screen.getByText(/second · 3 tickets · £30\.00 · Sat 14 Nov 21:20/)).toBeInTheDocument();
    expect(rowOf("Isla Grant")).not.toHaveClass("text-grey/50");
  });

  it("mutes a pending order and says until when it holds its seats", () => {
    render(
      <OrdersList
        orders={[
          order({ orderId: "1", status: "pending", paidAt: null, expiresAt: NOW + 31 * MINUTE }),
        ]}
        now={NOW}
      />,
    );
    expect(screen.getByText("holding until 22:01")).toBeInTheDocument();
    expect(rowOf("Isla Grant")).toHaveClass("text-grey/50");
  });

  it("calls a pending order past its hold lapsed", () => {
    render(
      <OrdersList
        orders={[order({ orderId: "1", status: "pending", paidAt: null, expiresAt: NOW - MINUTE })]}
        now={NOW}
      />,
    );
    expect(screen.getByText("lapsed")).toBeInTheDocument();
    expect(rowOf("Isla Grant")).toHaveClass("text-grey/50");
  });

  it("shows expired and refunded orders muted", () => {
    render(
      <OrdersList
        orders={[
          order({ orderId: "1", name: "Ada", status: "expired" }),
          order({ orderId: "2", name: "Callum", status: "refunded" }),
        ]}
        now={NOW}
      />,
    );
    expect(rowOf("Ada")).toHaveTextContent("expired");
    expect(rowOf("Callum")).toHaveTextContent("refunded");
    expect(rowOf("Ada")).toHaveClass("text-grey/50");
  });

  it("lists an order with no name", () => {
    render(<OrdersList orders={[order({ orderId: "1", name: null })]} now={NOW} />);
    expect(screen.getByText("no name")).toBeInTheDocument();
  });

  it("says so when the orders couldn't be read, rather than showing none", () => {
    render(<OrdersList orders={null} now={NOW} />);
    expect(screen.getByText(/couldn't read the orders/i)).toBeInTheDocument();
    expect(screen.queryByText(/no orders yet/i)).toBeNull();
  });
});
