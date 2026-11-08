// @vitest-environment node
import { signTicketToken } from "@form-at/data/ticketToken";
import jsQR from "jsqr";
import { encode } from "uqr";
import { describe, expect, it } from "vitest";

// The web app draws a ticket's QR with uqr; the door decodes it with jsQR.
// This draws real tokens with uqr, renders them to RGBA pixels the way a
// camera frame arrives, and checks jsQR reads back the exact string.

const SECRET = "test-ticket-signing-secret-0123456789";
const PIXELS_PER_MODULE = 4;

function toPixels(text: string): { data: Uint8ClampedArray; size: number } {
  const { data: modules } = encode(text, { border: 4 });
  const size = modules.length * PIXELS_PER_MODULE;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dark = modules[Math.floor(y / PIXELS_PER_MODULE)]?.[Math.floor(x / PIXELS_PER_MODULE)];
      const value = dark ? 0 : 255;
      const i = (y * size + x) * 4;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
  }
  return { data, size };
}

describe("ticket QR round trip", () => {
  it.each([crypto.randomUUID(), crypto.randomUUID(), "a".repeat(100)])(
    "decodes the token drawn for ticket %s",
    async (ticketId) => {
      const token = await signTicketToken(ticketId, SECRET);
      const { data, size } = toPixels(token);

      const decoded = jsQR(data, size, size, { inversionAttempts: "dontInvert" });

      expect(decoded?.data).toBe(token);
    },
  );
});
