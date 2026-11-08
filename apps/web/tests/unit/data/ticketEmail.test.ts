// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  TICKET_EMAIL_FROM,
  type TicketEmail,
  sendTicketEmail,
  ticketEmailContent,
} from "~/data/ticketEmail";

// The email's content and the request it becomes. Resend is a mocked fetch.

const EMAIL: TicketEmail = {
  to: "buyer@example.com",
  name: "Ada",
  eventTitle: "Form:at 004",
  date: "Sat 05.12",
  venue: "Stereo, City Centre, Glasgow",
  runtime: "23:00 — 04:00",
  tierName: "early",
  tickets: [
    { url: "https://formatglasgow.com/tickets/a.sig", seq: 0 },
    { url: "https://formatglasgow.com/tickets/b.sig", seq: 1 },
  ],
  idempotencyKey: "ticket-order-1",
};

describe("ticketEmailContent", () => {
  it("lists one labelled link per ticket, in text and HTML", () => {
    const { subject, text, html } = ticketEmailContent(EMAIL);
    expect(subject).toBe("your tickets for Form:at 004");
    expect(text).toContain("hi Ada,");
    expect(text).toContain("ticket 1 of 2: https://formatglasgow.com/tickets/a.sig");
    expect(text).toContain("ticket 2 of 2: https://formatglasgow.com/tickets/b.sig");
    expect(html).toContain('href="https://formatglasgow.com/tickets/b.sig"');
    expect(html).toContain("ticket 2 of 2");
  });

  it("speaks of one ticket for an order of one, and escapes HTML in the name", () => {
    const one = ticketEmailContent({
      ...EMAIL,
      name: "<b>Ada</b>",
      tickets: [EMAIL.tickets[0] as TicketEmail["tickets"][number]],
    });
    expect(one.subject).toBe("your ticket for Form:at 004");
    expect(one.text).toContain("your ticket: https://formatglasgow.com/tickets/a.sig");
    expect(one.html).toContain("hi &lt;b&gt;Ada&lt;/b&gt;,");
    expect(one.html).not.toContain("<b>Ada</b>");
  });
});

describe("sendTicketEmail", () => {
  it("posts to Resend with the key, the idempotency key and the sender", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }),
    );
    await sendTicketEmail("re_test", EMAIL, fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBe("Bearer re_test");
    expect(headers.get("Idempotency-Key")).toBe("ticket-order-1");
    expect(JSON.parse(String(init.body))).toMatchObject({
      from: TICKET_EMAIL_FROM,
      to: ["buyer@example.com"],
      subject: "your tickets for Form:at 004",
    });
  });

  it("throws with the status on a refusal", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"invalid"}', { status: 422 }));
    await expect(
      sendTicketEmail("re_test", EMAIL, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/Resend 422/);
  });
});
