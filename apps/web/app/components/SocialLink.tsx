import type { ReactNode } from "react";
import { buildAndroidIntent, isAndroid } from "~/utils/deeplink";

interface SocialLinkProps {
  href: string;
  className?: string;
  /** When present, Android taps are rewritten to an `intent://` URL that opens
   *  the named app (with the web URL embedded as `browser_fallback_url`).
   *  iOS is intentionally left alone — Universal Links already handle the
   *  handoff for major platforms (Instagram, SoundCloud, Spotify, etc.). */
  androidPackage?: string;
  /** Runs on every primary tap, before the navigation: where a caller counts it. */
  onTap?: () => void;
  children: ReactNode;
}

/**
 * External link that adapts to the device, **not the viewport size**.
 *
 *  - **Touch-first** (`pointer: coarse`): plain same-tab navigation. Do NOT
 *    add `target="_blank"` — it breaks the iOS Universal Link / Android App
 *    Link handoff that opens the native app if installed.
 *  - **Mouse-first** (`pointer: fine`): `window.open(href, "_blank")`, so the
 *    user keeps formatglasgow.com in their previous tab.
 *
 * `androidPackage` routes Android taps through a Chrome `intent://` URL —
 * more reliable than App Links, which need per-app config users often lack.
 *
 * `(pointer: coarse)` rather than viewport width, so a narrow desktop window
 * still gets new-tab and a tablet still gets the handoff in any orientation.
 * Modifier-clicks (cmd/ctrl/shift/middle) are deliberately left alone.
 */
export function SocialLink({ href, className, androidPackage, onTap, children }: SocialLinkProps) {
  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    onTap?.();

    // Android: rewrite to an intent URL so the native app opens directly.
    if (androidPackage && isAndroid()) {
      e.preventDefault();
      window.location.href = buildAndroidIntent(href, androidPackage);
      return;
    }

    // Touch device (iOS, or Android without a package mapping): default
    // same-tab navigation lets Universal Links / App Links do their thing.
    const isTouchPrimary = window.matchMedia("(pointer: coarse)").matches;
    if (isTouchPrimary) return;

    // Desktop: keep formatglasgow.com in the current tab, open the social in a new one.
    e.preventDefault();
    window.open(href, "_blank", "noopener,noreferrer");
  };

  return (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  );
}
