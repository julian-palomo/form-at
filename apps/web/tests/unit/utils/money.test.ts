import { describe, expect, it } from "vitest";
import { formatPence } from "~/utils/money";

describe("formatPence", () => {
  it("drops the decimals for whole pounds", () => {
    expect(formatPence(800)).toBe("£8");
    expect(formatPence(1200)).toBe("£12");
  });

  it("keeps two decimals otherwise", () => {
    expect(formatPence(1050)).toBe("£10.50");
    expect(formatPence(1)).toBe("£0.01");
  });
});
