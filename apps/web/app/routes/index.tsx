import { BracketLabel } from "@form-at/ui";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BookingsButton } from "~/components/BookingsButton";
import { ConsoleWriter } from "~/components/ConsoleWriter";
import { InstallAppButton } from "~/components/InstallAppButton";
import { JsonLd } from "~/components/JsonLd";
import { PageLayout } from "~/components/PageLayout";
import { PushOptInCta } from "~/components/PushOptInCta";
import { SocialLink } from "~/components/SocialLink";
import { YourTicketsLink } from "~/components/tickets/YourTicketsLink";
import { useFirstLoad } from "~/hooks/useFirstLoad";
import { useTypedOnce } from "~/hooks/useTypedOnce";
import { useStore } from "~/store";
import { pageHead } from "~/utils/head";
import { organizationLd } from "~/utils/jsonld";

const mainText =
  "Based in Glasgow, Form:at is an underground techno and electro initiative, dedicated to finding an analog soul in an increasingly digital world. Our operations are grassroots, building intimate, community-focused spaces where music is curated with care and mutual respect is prioritized. We create void points to escape the noise. Join us to disconnect and reconnect with the source.";

export const Route = createFileRoute("/")({
  head: () =>
    pageHead({
      title: "Form:at",
      description: "Glasgow techno collective. Analog soul in a digital world.",
      path: "/",
    }),
  component: Home,
});

function Home() {
  const isFirstLoading = useTypedOnce("home");
  const isFirstLoad = useFirstLoad();

  // Opacity-transition fade-in to avoid the appear → disappear → fade flash
  // the previous keyframe-on-mount approach caused (full diagnosis in
  // BottomNav.tsx). Unlike the chrome components, Home *does* remount on
  // navigation back to /, so we still honour the first-load gating:
  // 5s on the user's very first visit, 0.6s on subsequent returns.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(true);
  }, []);
  const fadeDuration = isFirstLoad ? "5s" : "0.6s";

  const nowPlaying = useStore((s) => s.nowPlaying);
  const isPlaying = useStore((s) => s.isPlaying);
  const playTrack = useStore((s) => s.playTrack);
  // The catalogue is newest-upload first (live D1 rows, ORDER BY created_at
  // DESC, over the snapshot), the same order /sets lists.
  const latestSet = useStore((s) => s.catalogueSets[0]);

  // A play/pause toggle for one set: the one loaded, or with nothing loaded
  // the newest. playTrack on the loaded set toggles it; called synchronously
  // from the tap, so the user gesture survives for audio.play().
  const listenSet = nowPlaying ?? latestSet;
  const handleListenClick = () => {
    if (listenSet) playTrack(listenSet);
  };
  const listenLabel = !nowPlaying ? "play_latest" : isPlaying ? "pause" : "resume_signal";

  return (
    <PageLayout fitBottom>
      <JsonLd data={organizationLd()} />
      <div className="flex flex-col justify-start sm:justify-center sm:py-16">
        {/* On phones every gap from here to the install slot, and the
            manifesto (fitToHeight), shrinks on a short screen so play, the
            socials and install_app stay above the bottom chrome, mini player
            included: the --fit-* values in global.css. From about 800px of
            height they're the old fixed values. */}
        <div className="space-y-2 mb-(--fit-gap) sm:mb-12 min-h-[20dvh]">
          <ConsoleWriter isFirstLoading={isFirstLoading} fitToHeight>
            {mainText}
          </ConsoleWriter>
        </div>

        <button
          type="button"
          onClick={handleListenClick}
          className="flex items-center justify-center gap-4 self-center w-full sm:px-24 border-2 border-grey/20 px-6 py-4 text-sm sm:text-base text-grey hover:border-purple hover:text-white hover:cursor-pointer transition-colors shadow-[0_0_15px_rgba(197,133,56,0.2)] hover:shadow-[0_0_25px_rgba(197,133,56,0.4)]"
          style={{
            opacity: visible ? 1 : 0,
            // Opacity transition for fade-in, keyframe animation for the
            // border pulse — they're independent properties so they coexist
            // cleanly. The pulse waits out the fade by matching the
            // animation-delay to the fade duration so the user reads the
            // text before the border starts breathing.
            transition: `opacity ${fadeDuration} ease-out`,
            animation: `border-pulse 2s ease-in-out ${fadeDuration} infinite`,
          }}
          suppressHydrationWarning
        >
          <span className="text-gold">›</span>
          <span>{listenLabel}</span>
        </button>

        <div
          className="flex items-center justify-center gap-10 my-(--fit-gap) sm:my-8"
          style={{
            opacity: visible ? 1 : 0,
            transition: `opacity ${fadeDuration} ease-out`,
          }}
          suppressHydrationWarning
        >
          <SocialLink
            href="https://www.instagram.com/form.at_glasgow/"
            androidPackage="com.instagram.android"
            className="text-sm text-grey hover:text-white transition-colors tracking-widest"
          >
            <BracketLabel>instagram</BracketLabel>
          </SocialLink>
          <BookingsButton className="text-sm text-grey hover:text-white transition-colors tracking-widest cursor-pointer" />
        </div>

        {/* One slot, two display modes: a browser tab gets [ install_app ]
            (InstallAppButton; nothing on a desktop browser that can't
            install), the installed app gets notify_me (PushOptInCta) while
            the Push API is there and the ask is unspent. Below the socials
            so neither competes with the play button. */}
        {/* Pulled up by half the socials gap (16px of 32 at full size), so
            the two rows can't overlap when the gap shrinks. Gone when both
            render nothing (the installed app with notify_me spent): empty, its
            margins would still be space the page can scroll by. No bottom
            margin on phones: PageLayout's fitBottom already clears the chrome
            and the swipe dots. */}
        <div className="flex flex-col items-center gap-3 -mt-[calc(var(--fit-gap)/2)] sm:-mt-4 sm:mb-8 empty:hidden">
          {/* Only while this device holds a ticket for a night still to come:
              its own row, since a third bracket beside the socials overflows
              a phone. */}
          <YourTicketsLink className="text-sm text-grey hover:text-white transition-colors tracking-widest" />
          <InstallAppButton />
          <PushOptInCta />
        </div>
      </div>
    </PageLayout>
  );
}
