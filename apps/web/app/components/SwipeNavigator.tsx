import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useDrag } from "@use-gesture/react";
import { useEffect, useRef, useState } from "react";
import { useNavReady } from "~/hooks/useNavReady";
import { useStore } from "~/store";
import { ABOVE_CHROME_BOTTOM, ABOVE_NAV_BOTTOM } from "~/styles/layout";
import { Z } from "~/styles/z";
import { rubberBand } from "~/utils/rubberBand";

const ROUTES = ["/", "/sets", "/events", "/djs"] as const;
const SWIPE_PX = 80;
const SWIPE_VX = 0.5;
const DURATION = 220;
// w-1 (4px) + gap-1.5 (6px) = 10px per dot step
const DOT_STEP = 10;
// Edge-of-list rubber-band asymptote, as a fraction of viewport width. At 0.4
// the resistance lets the page travel ~40% of the screen at most — visible
// enough to read as "edge", restrained enough not to look like navigation.
const EDGE_RUBBER_BAND_RATIO = 0.4;

/**
 * The tab a path belongs to, or -1 for a page outside the strip (`/tickets`,
 * a ticket's page, a 404). Those pages take no swipes and show no dots: a
 * swipe there used to count as "left of home" and jump to `/`, which is how a
 * buyer looking at their ticket lost it.
 */
export function routeIndex(pathname: string): number {
  return ROUTES.findIndex((r) => (r === "/" ? pathname === "/" : pathname.startsWith(r)));
}

export function SwipeNavigator() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const nowPlaying = useStore((s) => s.nowPlaying);
  const navReady = useNavReady();
  const [offset, setOffset] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  // The dots fade in with the bottom nav they sit above: opacity 0 on the
  // first paint (SSR and client agree), 1 once mounted, the same transition
  // and duration as BottomNav so the two read as one piece of chrome.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(true);
  }, []);
  const busy = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dotsIndicatorRef = useRef<HTMLDivElement>(null);

  const idx = routeIndex(pathname);

  const bind = useDrag(
    ({ movement: [mx], last, velocity: [vx] }) => {
      if (busy.current) return;

      if (!last) {
        const atStart = idx === 0 && mx > 0;
        const atEnd = idx === ROUTES.length - 1 && mx < 0;
        setOffset(
          atStart || atEnd ? rubberBand(mx, window.innerWidth * EDGE_RUBBER_BAND_RATIO) : mx,
        );
        // Animate dots indicator directly — no React re-render needed
        if (dotsIndicatorRef.current) {
          const frac = Math.max(-1, Math.min(1, -mx / window.innerWidth));
          dotsIndicatorRef.current.style.transition = "none";
          dotsIndicatorRef.current.style.transform = `translateX(${(idx + frac) * DOT_STEP}px)`;
        }
        return;
      }

      const swiped = Math.abs(mx) > SWIPE_PX || Math.abs(vx) > SWIPE_VX;
      const goingLeft = mx < 0;
      const next = goingLeft ? idx + 1 : idx - 1;

      if (swiped && next >= 0 && next < ROUTES.length) {
        busy.current = true;
        if (dotsIndicatorRef.current) {
          dotsIndicatorRef.current.style.transition = `transform ${DURATION}ms ease`;
          dotsIndicatorRef.current.style.transform = `translateX(${next * DOT_STEP}px)`;
        }

        // Clone current content so it can animate out while the new page slides in.
        // cloneNode captures the rendered DOM including current translateX position.
        const container = containerRef.current;
        const inner = container?.firstElementChild as HTMLDivElement | null;
        if (container && inner) {
          const snapshot = inner.cloneNode(true) as HTMLDivElement;
          // The snapshot contains a clone of the page's <main> landmark.
          // Hide it from assistive tech for the duration of the transition
          // so screen readers don't see two landmarks at once.
          snapshot.setAttribute("aria-hidden", "true");
          snapshot.inert = true;
          Object.assign(snapshot.style, {
            position: "absolute",
            top: "0",
            left: "0",
            width: "100%",
            pointerEvents: "none",
            zIndex: "1",
            transition: "none",
          });
          container.appendChild(snapshot);
          // One rAF to let the browser paint the snapshot before starting its transition
          requestAnimationFrame(() => {
            snapshot.style.transition = `transform ${DURATION}ms ease`;
            snapshot.style.transform = `translateX(${goingLeft ? -window.innerWidth : window.innerWidth}px)`;
          });
          setTimeout(() => snapshot.remove(), DURATION + 50);
        }

        // Navigate and instantly place the new page off-screen on the opposite side
        const route = ROUTES[next];
        if (route) navigate({ to: route });
        setOffset(goingLeft ? window.innerWidth : -window.innerWidth);

        // Two rAFs so the browser paints the off-screen position before transitioning.
        // This runs concurrently with the snapshot exit above.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTransitioning(true);
            setOffset(0);
            setTimeout(() => {
              setTransitioning(false);
              busy.current = false;
            }, DURATION);
          });
        });
      } else {
        // Snap indicator back to current page
        if (dotsIndicatorRef.current) {
          dotsIndicatorRef.current.style.transition = `transform ${DURATION}ms ease`;
          dotsIndicatorRef.current.style.transform = `translateX(${idx * DOT_STEP}px)`;
        }
        setTransitioning(true);
        setOffset(0);
        setTimeout(() => setTransitioning(false), DURATION);
      }
    },
    { axis: "x", filterTaps: true, enabled: idx >= 0 },
  );

  // Dots sit above the chrome — nav alone when no track is loaded, nav +
  // player when audio is active. Includes iOS safe-area via the shared
  // layout helpers. Gated on `navReady` so a first-load rehydrated track
  // doesn't shove the dots up before the player slot has actually slid in
  // beneath them.
  const dotsBottom = nowPlaying && navReady ? ABOVE_CHROME_BOTTOM : ABOVE_NAV_BOTTOM;

  return (
    <>
      <div
        ref={containerRef}
        {...bind()}
        // `flex-1 flex flex-col` participates in the app-wide sticky-footer
        // layout — see body's `min-h-dvh flex flex-col` in __root.tsx. This
        // wrapper fills the viewport height between header and fixed chrome,
        // so `flex-1` on PageLayout's <main> (and any inner `flex-1` inside
        // it) resolves to real space. Without this, no ancestor in the chain
        // has viewport height and short-content pages (NotFoundPage,
        // offline.html) can't vertically center.
        className="flex-1 flex flex-col"
        style={{ touchAction: "pan-y", overflowX: "hidden", position: "relative" }}
      >
        <div
          // `flex-1 flex flex-col` propagates the viewport-remaining space
          // down to the <Outlet />'s <main>. Without it, this translated
          // wrapper is content-sized and `flex-1` on PageLayout's <main>
          // has no space to consume — see the SwipeNavigator outer div's
          // comment for the full sticky-footer chain.
          className="flex-1 flex flex-col"
          style={{
            transform: `translateX(${offset}px)`,
            transition: transitioning ? `transform ${DURATION}ms ease` : "none",
            willChange: "transform",
          }}
        >
          <Outlet />
        </div>
      </div>

      {/* Page position dots — mobile only, and only on the four tabs */}
      {idx >= 0 && (
        <div
          className={`sm:hidden fixed left-0 right-0 flex justify-center ${Z.swipeIndicator} pointer-events-none mb-4`}
          style={{
            bottom: dotsBottom,
            opacity: visible ? 1 : 0,
            transition: "bottom 300ms ease-in-out, opacity 0.8s ease-out",
          }}
          suppressHydrationWarning
        >
          <div className="relative flex items-center gap-1.5">
            {ROUTES.map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: ROUTES is static
              <div key={i} className="w-1 h-0.5 bg-purple" />
            ))}
            <div
              ref={dotsIndicatorRef}
              className="absolute w-1 h-0.5 bg-gold left-0 top-0"
              style={{ transform: `translateX(${idx * DOT_STEP}px)` }}
            />
          </div>
        </div>
      )}
    </>
  );
}
