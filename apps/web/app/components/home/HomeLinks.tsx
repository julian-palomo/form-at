import { BracketLabel } from "@form-at/ui";
import type { CSSProperties } from "react";
import { InstallAppButton } from "~/components/InstallAppButton";
import { PushOptInCta } from "~/components/PushOptInCta";
import { SocialLink } from "~/components/SocialLink";
import { useTrackEvent } from "~/hooks/useTrackEvent";

const INSTAGRAM_URL = "https://www.instagram.com/form.at_glasgow/";
// The WhatsApp community's invite: announcement-only, where new nights and
// ticket sales are posted first.
const COMMUNITY_URL = "https://chat.whatsapp.com/F7kWrNkt2lOFUjiIilE68o";

const linkClass = "text-sm text-grey hover:text-white transition-colors tracking-widest";

// The home page's two link rows, under either layout: the wide pair first
// and the single link below it.
export function HomeLinks({ style }: { style: CSSProperties }) {
  const trackEvent = useTrackEvent();

  return (
    <>
      <div
        className="flex items-center justify-center gap-10 my-(--fit-gap) sm:my-8"
        style={style}
        suppressHydrationWarning
      >
        <SocialLink
          href={COMMUNITY_URL}
          androidPackage="com.whatsapp"
          onTap={() => trackEvent("home_community_click")}
          className={linkClass}
        >
          <BracketLabel>community</BracketLabel>
        </SocialLink>
        <SocialLink
          href={INSTAGRAM_URL}
          androidPackage="com.instagram.android"
          onTap={() => trackEvent("home_instagram_click")}
          className={linkClass}
        >
          <BracketLabel>instagram</BracketLabel>
        </SocialLink>
      </div>

      {/* One slot, two display modes: a browser tab gets [ install_the_app ]
          (InstallAppButton; nothing on a desktop browser that can't
          install), the installed app gets notify_me (PushOptInCta) while
          the Push API is there and the ask is unspent. */}
      {/* Pulled up by half the row's gap (16px of 32 at full size), so the
          two rows can't overlap when the gap shrinks. Gone when both render
          nothing (the installed app with notify_me spent): empty, its
          margins would still be space the page can scroll by. No bottom
          margin on phones: PageLayout's fitBottom already clears the chrome
          and the swipe dots. */}
      <div className="flex flex-col items-center gap-3 -mt-[calc(var(--fit-gap)/2)] sm:-mt-4 sm:mb-8 empty:hidden">
        <InstallAppButton />
        <PushOptInCta />
      </div>
    </>
  );
}
