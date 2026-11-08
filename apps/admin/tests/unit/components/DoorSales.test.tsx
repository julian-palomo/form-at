import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DoorSales } from "~/components/DoorSales";
import type { DoorSummary } from "~/data/door-sales";

const DOOR: DoorSummary = { pricePence: 1200, cash: 7, card: 4, expectedCashPence: 8400 };

/** The number under a label in the counter. */
function countUnder(label: string): string | null | undefined {
  return screen.getByText(label).nextSibling?.textContent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DoorSales", () => {
  it("shows inside against capacity, room left, and the expected cash", () => {
    render(<DoorSales door={DOOR} capacity={300} onlinePaid={120} onlineIn={40} />);
    // 40 online in + 11 at the door; 300 − 120 paid online − 11 at the door.
    expect(countUnder("inside")).toBe("51 / 300");
    expect(countUnder("room left")).toBe("169");
    expect(countUnder("door cash")).toBe("7");
    expect(countUnder("door card")).toBe("4");
    expect(screen.getByText("£84.00")).toBeInTheDocument();
    expect(screen.getByText("£12.00")).toBeInTheDocument();
  });

  it("shows — rather than 0 for every number it couldn't read", () => {
    render(<DoorSales door={null} capacity={300} onlinePaid={null} onlineIn={null} />);
    expect(countUnder("inside")).toBe("— / 300");
    expect(countUnder("room left")).toBe("—");
    expect(countUnder("online in")).toBe("—");
    expect(countUnder("door cash")).toBe("—");
    expect(countUnder("door card")).toBe("—");
    expect(screen.queryByText(/£0\.00/)).toBeNull();
  });

  it("needs both halves for the total inside", () => {
    render(<DoorSales door={DOOR} capacity={300} onlinePaid={null} onlineIn={null} />);
    expect(countUnder("inside")).toBe("— / 300");
    expect(countUnder("room left")).toBe("—");
    expect(countUnder("door cash")).toBe("7");
  });

  it("updates the numbers from the server's answer to +1", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ summary: { ...DOOR, cash: 8, expectedCashPence: 9600 } })),
    );
    render(<DoorSales door={DOOR} capacity={300} onlinePaid={120} onlineIn={40} />);

    await userEvent.click(screen.getByRole("button", { name: /\+1 cash/ }));

    expect(await screen.findByText("saved: +1 cash")).toBeInTheDocument();
    expect(countUnder("door cash")).toBe("8");
    expect(screen.getByText("£96.00")).toBeInTheDocument();
  });

  it("never counts a tap that failed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<DoorSales door={DOOR} capacity={300} onlinePaid={120} onlineIn={40} />);

    await userEvent.click(screen.getByRole("button", { name: /\+1 card/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("not saved, tap again");
    expect(countUnder("door card")).toBe("4");
    expect(countUnder("inside")).toBe("51 / 300");
  });

  it("says when there's nothing of yours to undo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    render(<DoorSales door={DOOR} capacity={300} onlinePaid={120} onlineIn={40} />);

    await userEvent.click(screen.getByRole("button", { name: /−1/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "nothing of yours to undo from the last minute",
    );
    expect(countUnder("door cash")).toBe("7");
  });

  it("marks room left once it's low", () => {
    render(<DoorSales door={DOOR} capacity={300} onlinePaid={280} onlineIn={200} />);
    expect(countUnder("room left")).toBe("9");
    expect(screen.getByText("room left")).toHaveClass("text-red-400");
  });
});
