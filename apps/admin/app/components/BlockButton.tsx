import { cn } from "@form-at/ui";
import type { ReactNode } from "react";

// A tap target for the door: a full block with a border or a fill, sized for
// a thumb in the dark. The bracket Button reads as text at arm's length and
// its tap area is only as wide as its label; this one fills its grid cell.

type Tone = "solid" | "outline" | "danger";

const toneClass: Record<Tone, string> = {
  solid: "bg-gold text-black border-2 border-gold",
  outline: "border-2 border-gold text-white",
  danger: "border-2 border-red-400 text-red-400",
};

export function BlockButton({
  tone,
  onClick,
  disabled,
  className,
  "aria-expanded": ariaExpanded,
  children,
}: {
  tone: Tone;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  "aria-expanded"?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-expanded={ariaExpanded}
      className={cn(
        "flex min-h-14 w-full cursor-pointer items-center justify-center px-3 font-mono text-lg tracking-widest disabled:cursor-not-allowed disabled:opacity-40",
        toneClass[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}
