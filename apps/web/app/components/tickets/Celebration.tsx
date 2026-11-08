import type { CSSProperties } from "react";
import { useEffect } from "react";

// The celebration when an order first shows as paid: pixel squares in the
// brand's gold, purple and white fall from the top of the screen like
// confetti, once, over about three seconds, and the layer unmounts. Nothing
// else on the page moves, the layer takes no pointer events, and the squares
// are small, so the ticket under them stays readable throughout.
//
// With "reduce motion" on, the layer is hidden outright (`motion-reduce`);
// the success page keeps its gold glow on the title for the same time, which
// is the still version of this. Loaded with `lazy()` by the success page, so
// the main bundle gains nothing. The default export is what lazy() needs.

/** How long the whole thing takes, from mount to the last square landing. */
export const CELEBRATION_MS = 3200;

type Pixel = {
  id: number;
  /** Horizontal start, in percent of the viewport width. */
  x: number;
  size: number;
  /** Horizontal travel over the fall, in px. */
  drift: number;
  delayMs: number;
  durationMs: number;
  colour: string;
};

const COLOURS = ["#c58538", "#c58538", "#c58538", "#43437a", "#ffffff"];

// A fixed sequence, so every purchase sees the same shower and the markup is
// the same on every render; `Math.random` would reshuffle it on each one.
function pixels(count: number): Pixel[] {
  let seed = 7;
  const next = () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: count }, (_, id) => ({
    id,
    x: next() * 100,
    size: 5 + Math.floor(next() * 5),
    drift: (next() - 0.5) * 80,
    delayMs: Math.floor(next() * 900),
    durationMs: 1400 + Math.floor(next() * 800),
    colour: COLOURS[Math.floor(next() * COLOURS.length)] ?? "#c58538",
  }));
}

const PIXELS = pixels(56);

export default function Celebration({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [onDone]);

  return (
    <div
      aria-hidden="true"
      data-testid="celebration"
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden motion-reduce:hidden"
    >
      {PIXELS.map((p) => (
        <i
          key={p.id}
          className="absolute -top-3 block"
          style={
            {
              left: `${p.x}%`,
              width: p.size,
              height: p.size,
              background: p.colour,
              "--drift": `${p.drift}px`,
              animation: `ticket-confetti-fall ${p.durationMs}ms linear ${p.delayMs}ms both`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
