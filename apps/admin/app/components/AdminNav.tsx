import { BracketLabel, cn } from "@form-at/ui";
import { Link, useRouterState } from "@tanstack/react-router";

// Sections config — adding "notifications"/"sessions" later is just
// appending another entry here. Not the public site's Header (that's
// marketing nav); this is an internal tool's section switcher.
const links = [
  { to: "/dashboard", label: "dashboard" },
  { to: "/notifications", label: "notifications" },
  { to: "/sets", label: "sets" },
  { to: "/door", label: "door" },
  { to: "/tickets", label: "tickets" },
] as const;

export function AdminNav() {
  const { location } = useRouterState();

  return (
    // flex-wrap plus tighter mobile gap/padding: the wordmark and five
    // labels don't fit 375px on one line, and without wrapping they pushed
    // the whole page 10px wider than the viewport (horizontal scroll on every
    // admin page). Desktop spacing is unchanged from sm: up. Bracket labels
    // must never split, so wrapping has to happen between links, not inside
    // them — BracketLabel owns its own whitespace-nowrap, which is what makes
    // this safe.
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-4 sm:gap-6 sm:px-6 border-b border-grey/10">
      <span className="font-display text-lg lowercase text-gold">form:at admin</span>
      {links.map(({ to, label }) => {
        const isActive = location.pathname.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            className={cn("font-display text-lg lowercase", isActive && "text-white")}
          >
            {isActive ? <BracketLabel>{label}</BracketLabel> : label}
          </Link>
        );
      })}
    </nav>
  );
}
