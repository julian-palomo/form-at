import { signTicketToken } from "@form-at/data/ticketToken";
import { describe, expect, it } from "vitest";
import { isStaticAssetPath } from "~/utils/staticAssetPath";

// What the server hands to Cloudflare Pages' asset layer, and what it
// renders itself. A ticket page must never be taken for a file, whatever
// characters its signature happens to contain.

describe("isStaticAssetPath", () => {
  it("recognises the files under public/", () => {
    for (const path of [
      "/sw.js",
      "/manifest.json",
      "/offline.html",
      "/og-image.png",
      "/og/events/format-004.jpg",
      "/email/wordmark.png",
      "/fonts/SpaceMono-Regular.woff2",
      "/assets/index-Ab12Cd34.js",
      "/site.webmanifest",
    ]) {
      expect(isStaticAssetPath(path), path).toBe(true);
    }
  });

  it("leaves pages to the app, including every ticket link", () => {
    const alnumSignature = "6ioGPT9QiBAZXGV1hKp5ZYQXOmWWp0yLiGcdBsjHWCI";
    const mixedSignature = "q1w2e3r4t5y6u7i8o9p0a1s2d3f4g5h6j7k8l9z0x1-";
    for (const path of [
      "/",
      "/sets/some-set",
      "/events/format-004",
      "/tickets",
      "/tickets/success",
      `/tickets/e798fae5-812c-4d87-8480-cb79c9f2f614.${alnumSignature}`,
      `/tickets/e798fae5-812c-4d87-8480-cb79c9f2f614.${mixedSignature}`,
    ]) {
      expect(isStaticAssetPath(path), path).toBe(false);
    }
  });

  it("keeps every real ticket link with the app, whatever its signature", async () => {
    // 200 signed tokens, the way an order's tickets are signed. Around a
    // quarter of them have a signature made only of letters and digits, the
    // ones the old `.<letters and digits>$` test took for a file.
    const paths = await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        signTicketToken(
          `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          "test-signing-secret-of-at-least-32-characters",
        ),
      ),
    ).then((tokens) => tokens.map((t) => `/tickets/${t}`));
    const alnumOnly = paths.filter((p) => /\.[a-z0-9]+$/i.test(p));
    expect(alnumOnly.length).toBeGreaterThan(0);
    for (const path of paths) {
      expect(isStaticAssetPath(path), path).toBe(false);
    }
  });
});
