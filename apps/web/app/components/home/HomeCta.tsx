import { cn } from "@form-at/ui";
import { Link, type LinkProps } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";

// The home page's one heavyweight control: full width, the gold "›", a
// border that pulses. A button when it acts in place (the play toggle), a
// link when it navigates (the night's tickets), so a link keeps a link's
// behaviour: preload, open in a new tab, the address on hover.
//
// The pulse starts after `pulseDelay`, the page's fade-in, so the label is
// read before the border starts breathing. `pulse={false}` is for a control
// that isn't asking for anything, such as the way to a ticket already bought.

const ctaClass =
  "flex items-center justify-center gap-4 self-center w-full sm:px-24 border-2 border-grey/20 px-6 py-4 text-sm sm:text-base text-grey hover:border-purple hover:text-white hover:cursor-pointer transition-colors shadow-[0_0_15px_rgba(197,133,56,0.2)] hover:shadow-[0_0_25px_rgba(197,133,56,0.4)]";

type Shared = {
  children: ReactNode;
  className?: string;
  /** The page's fade-in, merged over the pulse. */
  style?: CSSProperties;
  pulse?: boolean;
  pulseDelay?: string;
  onClick?: () => void;
};

type HomeCtaProps = Shared & { to?: LinkProps["to"]; params?: LinkProps["params"] };

export function HomeCta({
  children,
  className,
  style,
  pulse = true,
  pulseDelay = "0s",
  onClick,
  to,
  params,
}: HomeCtaProps) {
  const ctaStyle: CSSProperties = {
    ...style,
    animation: pulse ? `border-pulse 2s ease-in-out ${pulseDelay} infinite` : undefined,
  };
  const content = (
    <>
      <span className="text-gold">›</span>
      <span>{children}</span>
    </>
  );

  if (to !== undefined) {
    return (
      <Link
        to={to}
        params={params}
        preload="intent"
        onClick={onClick}
        className={cn(ctaClass, className)}
        style={ctaStyle}
        suppressHydrationWarning
      >
        {content}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(ctaClass, className)}
      style={ctaStyle}
      suppressHydrationWarning
    >
      {content}
    </button>
  );
}
