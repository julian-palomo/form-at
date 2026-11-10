// The one email ticket sales send: the buyer's ticket links, after payment
// and again from "recover my tickets". One `fetch` to Resend's API
// (https://resend.com/docs/api-reference/emails/send-email), no SDK, behind
// this single function so the provider can change.
//
// Links only, no inline QR: Gmail blocks `data:` images, and the link opens
// the ticket page, which draws the QR and stores the ticket on the device.
//
// Server-only. The API key is a parameter the caller reads from the
// Cloudflare env (`RESEND_API_KEY`); nothing here reads the environment.

const RESEND_API = "https://api.resend.com/emails";

/** The verified sending domain is formatglasgow.com (SPF and DKIM in Cloudflare DNS). */
export const TICKET_EMAIL_FROM = "Form:at <tickets@formatglasgow.com>";
/**
 * Where a buyer's reply lands. The sending address only sends (Resend holds
 * no mailbox for it), so without this a reply bounces.
 */
export const TICKET_EMAIL_REPLY_TO = "format.gla@gmail.com";

// The email ends in the collective's signature, the same block its Gmail
// signature shows (the wordmark on black, "Form:at — Glasgow", the site and
// Instagram), minus the person's name and phone: this is an automated send.
// The wordmark is a crop of `public/wordmark.png` without its square margins,
// served from production whatever origin sends the email, since the image
// must be reachable by the reader's mail client and a preview deployment is
// not.
const WORDMARK_URL = "https://formatglasgow.com/email/wordmark.png";
const SITE_URL = "https://formatglasgow.com";
const INSTAGRAM_URL = "https://www.instagram.com/form.at_glasgow/";
const INSTAGRAM_HANDLE = "@form.at_glasgow";

type TicketEmailLink = {
  url: string;
  /** The ticket's place in its order, from 0. */
  seq: number;
};

export type TicketEmail = {
  to: string;
  name: string | null;
  eventTitle: string;
  /** Already formatted for reading, e.g. "Sat 05.12". */
  date: string;
  venue: string;
  runtime: string;
  tierName: string;
  /** One link per ticket, in seat order. */
  tickets: TicketEmailLink[];
  /**
   * Resend drops a second request with the same key within 24 hours, so a
   * webhook delivered twice or a retried send can't email the buyer twice.
   * Up to 256 characters.
   */
  idempotencyKey: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The subject, text and HTML of a ticket email. Exported for tests. */
export function ticketEmailContent(email: TicketEmail): {
  subject: string;
  text: string;
  html: string;
} {
  const many = email.tickets.length > 1;
  const subject = `your ${many ? "tickets" : "ticket"} for ${email.eventTitle}`;
  // The name is what the buyer typed at Stripe, spaces included.
  const name = email.name?.trim();
  const greeting = name ? `hi ${name},` : "hi,";
  const intro = many
    ? `here are your ${email.tickets.length} tickets for ${email.eventTitle}. each link is one ticket: keep one and send the others to your friends.`
    : `here is your ticket for ${email.eventTitle}.`;
  const facts = `${email.date} · ${email.venue} · ${email.runtime} · ${email.tierName}`;
  const outro =
    "open a link on your phone and the ticket stays in the app, with no signal needed at the door. show the qr once; it's scanned once.";
  const label = (t: TicketEmailLink) =>
    many ? `ticket ${t.seq + 1} of ${email.tickets.length}` : "your ticket";

  const replyLine = "questions? reply to this email.";

  const text = [
    greeting,
    "",
    intro,
    facts,
    "",
    ...email.tickets.map((t) => `${label(t)}: ${t.url}`),
    "",
    outro,
    "",
    replyLine,
    "",
    "Form:at — Glasgow",
    SITE_URL,
    `${INSTAGRAM_HANDLE} · ${INSTAGRAM_URL}`,
  ].join("\n");

  const mono = "font-family:ui-monospace,Menlo,Consolas,monospace";
  const signatureLink = "color:#1155cc;text-decoration:underline";
  const html = [
    `<div style="${mono};color:#111;max-width:560px">`,
    '<div style="font-size:15px;line-height:1.6">',
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(intro)}<br>${escapeHtml(facts)}</p>`,
    ...email.tickets.map(
      (t) =>
        `<p><a href="${escapeHtml(t.url)}" style="color:#111;font-weight:bold">&rsaquo; ${escapeHtml(label(t))}</a></p>`,
    ),
    `<p>${escapeHtml(outro)}</p>`,
    `<p>${escapeHtml(replyLine)}</p>`,
    "</div>",
    // The signature. Width and height are set so the layout holds while
    // images are blocked.
    '<div style="margin-top:32px;font-size:14px;line-height:1.7">',
    `<img src="${WORDMARK_URL}" width="320" height="104" alt="Form:at" style="display:block;width:320px;height:104px;border:0;margin-bottom:12px">`,
    "<b>Form:at</b> &mdash; Glasgow<br>",
    `<a href="${SITE_URL}" style="${signatureLink}">formatglasgow.com</a><br>`,
    `<a href="${INSTAGRAM_URL}" style="${signatureLink}">${INSTAGRAM_HANDLE}</a>`,
    "</div>",
    "</div>",
  ].join("");

  return { subject, text, html };
}

/**
 * Sends the email. Throws on a non-2xx answer or a network failure, so the
 * caller decides what a failed send means (the webhook logs it and still
 * answers Stripe 200; the order stays paid).
 */
export async function sendTicketEmail(
  apiKey: string,
  email: TicketEmail,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const content = ticketEmailContent(email);
  const response = await fetchImpl(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": email.idempotencyKey,
    },
    body: JSON.stringify({
      from: TICKET_EMAIL_FROM,
      reply_to: TICKET_EMAIL_REPLY_TO,
      to: [email.to],
      subject: content.subject,
      text: content.text,
      html: content.html,
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Resend ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
}
