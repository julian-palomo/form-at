import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SalesTotals } from "~/components/SalesTotals";
import type { SalesTier } from "~/data/sales";

const TIERS: SalesTier[] = [
  { id: "early", name: "early", cap: 15, paid: 15, held: 0, left: 0 },
  { id: "second", name: "second", cap: 15, paid: 9, held: 2, left: 4 },
  { id: "general", name: "general", cap: 120, paid: 0, held: 0, left: 120 },
];

function countUnder(label: string): string | null | undefined {
  return screen.getByText(label).nextSibling?.textContent;
}

describe("SalesTotals", () => {
  it("shows sold, left online and gross", () => {
    render(<SalesTotals tiers={TIERS} totals={{ sold: 24, left: 124, grossPence: 24_000 }} />);
    expect(countUnder("sold")).toBe("24");
    expect(countUnder("left online")).toBe("124");
    expect(countUnder("gross")).toBe("£240.00");
  });

  it("shows each tier against its cap, with what's held", () => {
    render(<SalesTotals tiers={TIERS} totals={{ sold: 24, left: 124, grossPence: 0 }} />);
    expect(screen.getByText("second").closest("li")).toHaveTextContent("9 / 15 · 2 held · 4 left");
    expect(screen.getByText("early").closest("li")).toHaveTextContent("15 / 15 · 0 left");
  });

  it("shows — rather than 0 for whatever it couldn't read", () => {
    render(<SalesTotals tiers={null} totals={{ sold: null, left: null, grossPence: null }} />);
    expect(countUnder("sold")).toBe("—");
    expect(countUnder("left online")).toBe("—");
    expect(countUnder("gross")).toBe("—");
    expect(screen.getByText(/couldn't read the tiers/i)).toBeInTheDocument();
  });
});
