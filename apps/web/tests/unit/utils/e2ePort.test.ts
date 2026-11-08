import { afterEach, describe, expect, it, vi } from "vitest";
import { e2ePort } from "../../e2e/_port";

const BASE = 4200;
const SPAN = 500;

describe("e2ePort", () => {
  it("gives the same folder the same port every time", () => {
    const dir = "/Users/julian/Development/form-at/apps/web";
    expect(e2ePort(BASE, SPAN, dir)).toBe(e2ePort(BASE, SPAN, dir));
  });

  it("stays inside [base, base + span)", () => {
    for (const dir of [
      "/a",
      "/home/runner/work/form-at/form-at/apps/web",
      "/Users/julian/Development/form-at/.claude/worktrees/stripe/apps/web",
      "C:\\Users\\julian\\form-at\\apps\\web",
    ]) {
      const port = e2ePort(BASE, SPAN, dir);
      expect(port).toBeGreaterThanOrEqual(BASE);
      expect(port).toBeLessThan(BASE + SPAN);
    }
  });

  it("gives sibling worktrees different ports", () => {
    const root = "/Users/julian/Development/form-at/.claude/worktrees";
    expect(e2ePort(BASE, SPAN, `${root}/tickets/apps/web`)).not.toBe(
      e2ePort(BASE, SPAN, `${root}/stories/apps/web`),
    );
  });

  it("lets E2E_PORT override the hash", () => {
    vi.stubEnv("E2E_PORT", "4321");
    expect(e2ePort(BASE, SPAN, "/anywhere")).toBe(4321);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
});
