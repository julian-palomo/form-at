import { describe, expect, it } from "vitest";
import { signTicketToken, verifyTicketToken } from "~/ticketToken";

// The token is the QR's value: `<ticketId>.<base64url HMAC-SHA256>`. The
// signature lets the door reject an invented code without a database read;
// D1 stays the source of truth for whether a real ticket was already used.

const SECRET = "a-test-secret-that-is-at-least-32-bytes-long";
const TICKET = "0b7c9a52-3f4e-4c1a-9a7e-2d6f8b1c4e90";

describe("signTicketToken / verifyTicketToken", () => {
  it("round-trips a ticket id", async () => {
    const token = await signTicketToken(TICKET, SECRET);
    expect(token).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(await verifyTicketToken(token, SECRET)).toBe(TICKET);
  });

  it("is deterministic, so the same ticket always has the same QR", async () => {
    expect(await signTicketToken(TICKET, SECRET)).toBe(await signTicketToken(TICKET, SECRET));
  });

  it("rejects a token whose ticket id was changed", async () => {
    const token = await signTicketToken(TICKET, SECRET);
    const other = `1${token.slice(1)}`;
    expect(await verifyTicketToken(other, SECRET)).toBeNull();
  });

  it("rejects a token whose signature was changed", async () => {
    const token = await signTicketToken(TICKET, SECRET);
    // A character in the middle: every one of its 6 bits is part of the signature.
    const i = token.length - 20;
    const swapped = token[i] === "A" ? "B" : "A";
    expect(
      await verifyTicketToken(`${token.slice(0, i)}${swapped}${token.slice(i + 1)}`, SECRET),
    ).toBeNull();
  });

  it("accepts only the canonical spelling of the signature's last character", async () => {
    const token = await signTicketToken(TICKET, SECRET);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(token.at(-1) ?? "");
    // Flipping the lowest bit changes only the 2 unused bits: same bytes, other string.
    const twin = `${token.slice(0, -1)}${alphabet[last ^ 1]}`;
    expect(await verifyTicketToken(twin, SECRET)).toBeNull();
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signTicketToken(TICKET, "another-secret-that-is-also-32-bytes-long!");
    expect(await verifyTicketToken(token, SECRET)).toBeNull();
  });

  it.each([
    "",
    "no-dot",
    `${TICKET}.`,
    `.${"A".repeat(43)}`,
    `${TICKET}.not base64!`,
    `${TICKET}.${"A".repeat(42)}`,
  ])("rejects malformed input %j", async (token) => {
    expect(await verifyTicketToken(token, SECRET)).toBeNull();
  });

  it("refuses to sign or verify with a short secret", async () => {
    await expect(signTicketToken(TICKET, "short")).rejects.toThrow();
    await expect(verifyTicketToken(`${TICKET}.${"A".repeat(43)}`, "")).rejects.toThrow();
  });
});
