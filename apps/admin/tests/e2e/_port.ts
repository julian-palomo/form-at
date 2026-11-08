import { resolve } from "node:path";

// One e2e port per checkout. Two worktrees of this repo each boot their own
// dev server for Playwright, and a fixed port would make the second suite
// attach to the first one's server, or fail to bind. The port is FNV-1a over
// the absolute app directory, folded into [base, base + span): the same
// folder always gets the same port, and sibling worktrees get different ones.
// E2E_PORT overrides it, for the rare collision or a port a firewall blocks.
export function e2ePort(base: number, span: number, dir = resolve(".")): number {
  const override = Number(process.env.E2E_PORT);
  if (Number.isInteger(override) && override > 0) return override;
  let hash = 0x811c9dc5;
  for (const char of dir) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return base + (hash % span);
}
