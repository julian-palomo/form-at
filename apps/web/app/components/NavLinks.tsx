import { BracketLabel, cn } from "@form-at/ui";

import { Link, useRouterState } from "@tanstack/react-router";

// The five tabs, in the order of the swipe strip (SwipeNavigator's ROUTES):
// sets in the centre, tickets always last and always shown, so the way to a
// bought ticket is the same whether or not this device holds one. `short` is
// what the phone's bottom bar shows where five full labels crowd it.
type NavLink = {
  to: "/" | "/events" | "/sets" | "/djs" | "/tickets";
  label: string;
  short?: string;
};

const links: NavLink[] = [
  { to: "/", label: "home" },
  { to: "/events", label: "events" },
  { to: "/sets", label: "sets" },
  { to: "/djs", label: "djs" },
  { to: "/tickets", label: "tickets", short: "tix" },
];

interface NavLinksProps {
  className?: string;
  itemClassName?: string;
  activeClassName?: string;
  /** Show each link's short label where it has one; its accessible name stays the full one. */
  compact?: boolean;
}

export function NavLinks({ className, itemClassName, activeClassName, compact }: NavLinksProps) {
  const { location } = useRouterState();

  return (
    <nav className={className}>
      {links.map(({ to, label, short }) => {
        const text = compact && short ? short : label;
        const isActive = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            preload="intent"
            aria-label={text === label ? undefined : label}
            className={cn(
              itemClassName,
              isActive && activeClassName,
              "font-display text-lg lowercase",
            )}
          >
            {isActive ? <BracketLabel>{text}</BracketLabel> : text}
          </Link>
        );
      })}
    </nav>
  );
}
