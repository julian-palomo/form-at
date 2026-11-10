import { useEffect, useState } from "react";
import { NavLinks } from "~/components/NavLinks";
import { LAYOUT } from "~/styles/layout";
import { Z } from "~/styles/z";

export function BottomNav() {
  // Render at opacity 0 from the very first paint (SSR + client agree) and
  // transition to 1 once the mount effect fires. The previous `animation`
  // approach attached the keyframe *after* first paint, which caused the
  // element to appear at opacity 1, jump to 0 (from-state), then fade back
  // in — a visible "double fade" on reload. Lives in
  // __root.tsx so it only mounts once per page load; no useFirstLoad gating
  // needed.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(true);
  }, []);

  return (
    <div
      className={`sm:hidden fixed bottom-0 inset-x-0 ${Z.bottomNav} bg-black border-t border-white/10 font-mono pb-[env(safe-area-inset-bottom)]`}
      style={{
        height: `calc(${LAYOUT.navHeightMobile}px + env(safe-area-inset-bottom))`,
        opacity: visible ? 1 : 0,
        transition: "opacity 0.8s ease-out",
      }}
      suppressHydrationWarning
    >
      <NavLinks
        compact
        className="flex items-center justify-around px-2 py-3"
        itemClassName="flex-1 text-center text-xs text-grey hover:text-white transition-colors py-1"
        activeClassName="text-gold"
      />
    </div>
  );
}
