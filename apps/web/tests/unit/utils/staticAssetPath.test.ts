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
});
