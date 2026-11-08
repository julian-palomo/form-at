// The value encoded in a ticket's QR: `<ticketId>.<signature>`, where the
// signature is HMAC-SHA256(ticketId, TICKET_SIGNING_SECRET) in base64url
// without padding. Decision record:
// docs/adr/2026-11-08-stripe-checkout-and-signed-ticket-token.md.
//
// The signature lets the door reject an invented or mistyped code without a
// database read. It says nothing about whether the ticket was already used:
// that lives only in D1 (`checkIn` in tickets.ts).
//
// Web Crypto only, because both Pages apps run this in the Workers runtime.
// The secret is always a parameter; nothing here reads the environment.

/** TICKET_SIGNING_SECRET is 32+ random characters; anything shorter is a placeholder or a mistake. */
const MIN_SECRET_LENGTH = 32;

/** A SHA-256 HMAC is 32 bytes: 43 base64url characters without padding. */
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const encoder = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  // Throwing beats signing with an empty or placeholder secret, which would
  // make every token forgeable without anyone noticing.
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`Ticket signing secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function signTicketToken(ticketId: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(ticketId));
  return `${ticketId}.${toBase64Url(new Uint8Array(signature))}`;
}

/**
 * Returns the ticket id when the signature matches, otherwise null.
 * `crypto.subtle.verify` does the comparison, which doesn't leak through
 * timing how much of a forged signature was right.
 */
export async function verifyTicketToken(token: string, secret: string): Promise<string | null> {
  const key = await hmacKey(secret);
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const ticketId = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!SIGNATURE_PATTERN.test(signature)) return null;

  // The last of the 43 characters carries 2 unused bits, so four spellings
  // decode to the same bytes. Accept only the one signTicketToken produces, so
  // each ticket has exactly one valid token string.
  const bytes = fromBase64Url(signature);
  if (toBase64Url(bytes) !== signature) return null;

  const valid = await crypto.subtle.verify("HMAC", key, bytes, encoder.encode(ticketId));
  return valid ? ticketId : null;
}
