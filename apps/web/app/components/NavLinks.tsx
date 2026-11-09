import { BracketLabel, cn } from "@form-at/ui";

import { Link, useRouterState } from "@tanstack/react-router";

// The five tabs, in the order of the swipe strip (SwipeNavigator's ROUTES):
// sets in the centre, tickets always last and always shown, so the way to a
// bought ticket is the same whether or not this device holds one.
const links = [
  { to: "/", label: "home", exact: true },
  { to: "/events", label: "events" },
  { to: "/sets", label: "sets" },
  { to: "/djs", label: "djs" },
  { to: "/tickets", label: "tickets" },
] as const;

interface NavLinksProps {
  className?: string;
  itemClassName?: string;
  activeClassName?: string;
}

export function NavLinks({ className, itemClassName, activeClassName }: NavLinksProps) {
  const { location } = useRouterState();

  return (
    <nav className={className}>
      {links.map(({ to, label }) => {
        const isActive = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            preload="intent"
            className={cn(
              itemClassName,
              isActive && activeClassName,
              "font-display text-lg lowercase",
            )}
          >
            {isActive ? <BracketLabel>{label}</BracketLabel> : label}
          </Link>
        );
      })}
    </nav>
  );
}
