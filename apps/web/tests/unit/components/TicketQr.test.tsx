import { render } from "@testing-library/react";
import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import TicketQr, { QR_QUIET_ZONE } from "~/components/tickets/TicketQr";

// The drawn QR decodes back to the token with jsQR, the decoder the door's
// scanner uses, so what the buyer's phone shows and what the door reads
// agree. The SVG's path is rasterised here by hand (one pixel block per
// module) because jsdom has no canvas.

const TOKEN = "0f3b9a2c-7d1e-4a5b-8c6d-9e0f1a2b3c4d.q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1c";

function rasterise(path: string, size: number, scale: number): Uint8ClampedArray {
  const px = size * scale;
  const pixels = new Uint8ClampedArray(px * px * 4).fill(255);
  for (const match of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const mx = Number(match[1]);
    const my = Number(match[2]);
    for (let y = my * scale; y < (my + 1) * scale; y++) {
      for (let x = mx * scale; x < (mx + 1) * scale; x++) {
        const i = (y * px + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
      }
    }
  }
  return pixels;
}

describe("TicketQr", () => {
  it("draws a QR that jsQR decodes back to the token, with a quiet zone", () => {
    const { container } = render(<TicketQr value={TOKEN} />);
    const svg = container.querySelector("svg");
    const path = svg?.querySelector("path")?.getAttribute("d") ?? "";
    const size = Number(svg?.getAttribute("viewBox")?.split(" ")[2]);
    expect(svg).toHaveAttribute("aria-label", "ticket QR code");
    expect(size).toBeGreaterThan(QR_QUIET_ZONE * 2);

    // No module is drawn inside the quiet zone.
    for (const match of path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
      expect(Number(match[1])).toBeGreaterThanOrEqual(QR_QUIET_ZONE);
      expect(Number(match[1])).toBeLessThan(size - QR_QUIET_ZONE);
    }

    const scale = 4;
    const decoded = jsQR(rasterise(path, size, scale), size * scale, size * scale);
    expect(decoded?.data).toBe(TOKEN);
  });
});
