import { cn } from "@form-at/ui";
import { createFileRoute } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useState } from "react";
import { ConsoleWriter } from "~/components/ConsoleWriter";
import { JsonLd } from "~/components/JsonLd";
import { PageLayout } from "~/components/PageLayout";
import { HomeCta } from "~/components/home/HomeCta";
import { HomeLinks } from "~/components/home/HomeLinks";
import { NightHome } from "~/components/home/NightHome";
import { useFirstLoad } from "~/hooks/useFirstLoad";
import { type HomeNight, useHomeNight } from "~/hooks/useHomeNight";
import { useTrackEvent } from "~/hooks/useTrackEvent";
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

// The home page has two layouts, picked by useHomeNight: the night layout
// (NightHome) while the next night's tickets are on sale or this device
// holds one, and the listening layout (the manifesto and the play button)
// the rest of the time. Both end in the same link rows (HomeLinks). While
// the hook is still `pending` the page is empty under the header, so
// nothing is typed and then replaced.
function Home() {
  const night = useHomeNight();

  return (
    <PageLayout fitBottom>
      <JsonLd data={organizationLd()} />
      {night.state !== "pending" && <HomeBody night={night} />}
    </PageLayout>
  );
}

function HomeBody({ night }: { night: Exclude<HomeNight, { state: "pending" }> }) {
  const isFirstLoad = useFirstLoad();

  // Opacity-transition fade-in to avoid the appear → disappear → fade flash
  // the previous keyframe-on-mount approach caused (full diagnosis in
  // BottomNav.tsx). Unlike the chrome components, Home *does* remount on
  // navigation back to /, so we still honour the first-load gating:
  // 5s on the user's very first visit, 0.6s on subsequent returns. The
  // state lives here, not in Home, so a body that mounts late (after the
  // sale's answer) still starts at opacity 0 and fades.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(true);
  }, []);
  const fadeDuration = isFirstLoad ? "5s" : "0.6s";
  const fade: CSSProperties = {
    opacity: visible ? 1 : 0,
    transition: `opacity ${fadeDuration} ease-out`,
  };

  return (
    // The night layout is taller, so above phone width it gives up the
    // listening layout's vertical padding to keep its button on screen.
    <div
      className={cn(
        "flex flex-col justify-start sm:justify-center",
        night.state === "night" ? "sm:py-2" : "sm:py-16",
      )}
    >
      {night.state === "night" ? (
        <NightHome
          event={night.event}
          ticketCount={night.ticketCount}
          style={fade}
          pulseDelay={fadeDuration}
        />
      ) : (
        <ListeningHome style={fade} pulseDelay={fadeDuration} />
      )}
      <HomeLinks style={fade} />
    </div>
  );
}

function ListeningHome({ style, pulseDelay }: { style: CSSProperties; pulseDelay: string }) {
  const isFirstLoading = useTypedOnce("home");
  const trackEvent = useTrackEvent();

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
    trackEvent("home_play_click");
    if (listenSet) playTrack(listenSet);
  };
  const listenLabel = !nowPlaying ? "play_latest" : isPlaying ? "pause" : "resume_signal";

  return (
    <>
      {/* On phones every gap from here to the install slot, and the
          manifesto (fitToHeight), shrinks on a short screen so play, the
          links and install_the_app stay above the bottom chrome, mini player
          included: the --fit-* values in global.css. From about 800px of
          height they're the old fixed values. */}
      <div className="space-y-2 mb-(--fit-gap) sm:mb-12 min-h-[20dvh]">
        <ConsoleWriter isFirstLoading={isFirstLoading} fitToHeight>
          {mainText}
        </ConsoleWriter>
      </div>

      {/* The fade and the border pulse are independent properties, so they
          coexist; the pulse waits out the fade (pulseDelay). */}
      <HomeCta style={style} pulseDelay={pulseDelay} onClick={handleListenClick}>
        {listenLabel}
      </HomeCta>
    </>
  );
}
