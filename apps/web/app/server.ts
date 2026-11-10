import { AUDIO_ORIGIN } from "@form-at/data/sets";
import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { isStaticAssetPath } from "~/utils/staticAssetPath";

const handler = createStartHandler({ handler: defaultStreamHandler });

// Document CSP. Cloudflare Pages' `_headers` file
// applies to STATIC ASSETS only — responses generated here (all SSR
// documents) don't get it, so the document policy is set on the response
// below. Keep in sync with the `/*` rule in `public/_headers` (which covers
// offline.html, the one static document).
//
// Why each non-'self' allowance exists:
//   script-src 'unsafe-inline' — the inline SW-registration + beforeinstall-
//     prompt stash scripts in __root's head, plus TanStack Start's SSR
//     hydration payload scripts (dynamic per request — unhashable).
//   style-src 'unsafe-inline'  — the inlined critical font CSS + React
//     style attributes.
//   img-src data:              — favicon/data URIs.
//   img-src AUDIO_ORIGIN       — admin-uploaded artwork's fallback. Uploaded
//     artwork never goes through `optimize-images` (that script only reads
//     the gitignored local `images-source/`, which an admin upload never
//     populates), so the build-time `/images/...` optimized variant simply
//     doesn't exist for it. `Image.tsx` falls back to `artworkOriginalUrl` —
//     the raw file straight from R2/CDN — for exactly this case, on this
//     same host. Without this allowance, that fallback is itself CSP-blocked:
//     a freshly admin-uploaded set renders a blank artwork spot instead of
//     the raw image, since the one path meant to catch a missing optimized
//     variant is blocked too.
//   media-src / connect-src — the <audio> stream and the peaks-JSON /
//     download fetches from the audio host (see @form-at/data/sets, the
//     canonical home of the hostname).
//   media-src blob: — the Instagram Story share screen previews the recorded
//     MP4 in a <video> from a blob: object URL. Without it the preview is
//     silently blocked and shows an empty frame; the file itself is fine.
//   static.cloudflareinsights.com (script-src) + cloudflareinsights.com
//     (connect-src) — Cloudflare Web Analytics. BOTH are required and neither
//     is redundant: the first loads the beacon `rootHead.ts` injects, the
//     second lets it POST to https://cloudflareinsights.com/cdn-cgi/rum
//     (confirmed by reading beacon.min.js, not assumed). Drop either and Web
//     Analytics silently records NOTHING — no error surfaces server-side, and
//     the only symptom is an empty dashboard. Keep in sync with the same
//     policy in `public/_headers`.
const DOCUMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: ${AUDIO_ORIGIN}`,
  "font-src 'self'",
  `media-src 'self' blob: ${AUDIO_ORIGIN}`,
  `connect-src 'self' ${AUDIO_ORIGIN} https://cloudflareinsights.com`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join("; ");

export default {
  async fetch(request: Request, env: { DB: D1Database; ASSETS: Fetcher } | undefined) {
    const { pathname } = new URL(request.url);

    // Files under public/ come from the asset layer; everything else,
    // ticket pages included, is rendered here (see isStaticAssetPath).
    if (env?.ASSETS && isStaticAssetPath(pathname)) {
      return env.ASSETS.fetch(request);
    }

    const safeEnv = env || {};
    // Whether the raw `env` argument was present at all — true under any real
    // Cloudflare runtime (production, or local `wrangler pages dev`, D1 bound
    // or not), false only when this fetch() was invoked outside Cloudflare
    // entirely (plain `vite dev`/`vite preview`, Playwright's e2e server).
    // fetchOverallStats's sample-data fallback gates on this, not on
    // `env.DB` alone, so a real deployment whose D1 binding is broken or not
    // yet wired up still shows the honest "no data" state instead of fixture
    // data. Mirrors apps/admin/app/server.ts's identical flag.
    const hasCloudflareEnv = env !== undefined;

    // What server functions need from the request itself: the buyer's IP for
    // the ticket-hold limit (`cf-connecting-ip`, set by Cloudflare; absent
    // under plain vite) and the origin to build Stripe's return URLs from,
    // so a preview deployment returns to the preview, not to production.
    const requestInfo = {
      ip: request.headers.get("cf-connecting-ip"),
      origin: new URL(request.url).origin,
    };

    // biome-ignore lint/suspicious/noExplicitAny: CF env is not in BaseContext type
    const context = { cloudflare: { env: safeEnv, hasCloudflareEnv }, request: requestInfo } as any;
    const response = await handler(request, { context });

    // Attach the CSP to documents only — API/server-fn responses don't need
    // it and some are consumed by code that a policy header could confuse.
    if (response.headers.get("content-type")?.includes("text/html")) {
      const withCsp = new Response(response.body, response);
      withCsp.headers.set("Content-Security-Policy", DOCUMENT_CSP);
      return withCsp;
    }
    return response;
  },
};
