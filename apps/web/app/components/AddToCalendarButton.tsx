import { BracketLabel, Button, Modal, TerminalRow } from "@form-at/ui";

import type { Event } from "@form-at/data/events";
import { useState } from "react";
import { useTrackEvent } from "~/hooks/useTrackEvent";
import { isAndroid } from "~/utils/deeplink";
import { buildGoogleCalendarTargetUrl, buildIcs, buildOutlookCalendarTargetUrl } from "~/utils/ics";

// Dropdown anchor row — same visual vocabulary as <Button variant="secondary">
// but on an <a> because these are navigations, not actions. Bracket rendering
// comes from <BracketLabel> inside; layout/typography stays here.
const anchorRowClass =
  "text-left text-sm text-grey hover:text-white transition-colors tracking-widest cursor-pointer py-1";

// Calendar options that are pure navigation render as <a>. Apple/.ics
// stays a <button> because it's an action (build blob → download), not a
// navigation, so there's no URL to put in href.
type CalendarLink = { label: string; href: string };

export function AddToCalendarButton({ event }: { event: Event }) {
  const [open, setOpen] = useState(false);
  const trackEvent = useTrackEvent();

  // The .ics route is best for Apple Calendar — on iOS Safari it triggers the
  // native "Add to Calendar" sheet directly; on desktop it downloads the file
  // and the user opens it with their default calendar app.
  const downloadIcs = () => {
    trackEvent("calendar_add_click");
    const ics = buildIcs(event);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${event.id}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  const links: CalendarLink[] = [
    { label: "google", href: buildGoogleCalendarTargetUrl(event) },
    { label: "outlook", href: buildOutlookCalendarTargetUrl(event) },
  ];

  return (
    <>
      {/* A bracket button at the same weight as [ share ] beside it: the
          page's one heavy call to action is the buy button. */}
      <Button variant="secondary" onClick={() => setOpen(true)}>
        add_to_calendar
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Add to calendar"
        title={
          <div className="text-xs text-grey tracking-widest truncate">
            › <span className="text-white">add_to_calendar</span>
          </div>
        }
      >
        {/* Subject row — confirms which event the calendar entry is for,
            keeps the title bar uncluttered, and matches the rest of the
            app's terminal-row metadata convention. */}
        <TerminalRow label="event" value={`${event.title} · ${event.date}`} className="mb-6" />
        <div className="flex flex-col">
          {links.map(({ label, href }) => {
            // `intent://` URLs need same-window navigation so the OS can
            // hand off to the target app — opening them in a new tab tends
            // to leave a blank window behind on Android Chrome.
            const isIntent = href.startsWith("intent:");
            return (
              <a
                key={label}
                href={href}
                target={isIntent ? undefined : "_blank"}
                rel={isIntent ? undefined : "noopener noreferrer"}
                onClick={() => {
                  trackEvent("calendar_add_click");
                  setOpen(false);
                }}
                className={anchorRowClass}
              >
                <BracketLabel>{label}</BracketLabel>
              </a>
            );
          })}
          {/* Hide the .ics route on Android — `[ google ]` above already
              hands off to the native Google Calendar app via intent URL,
              and a `.ics` download on Android lands in /Downloads with no
              prompt to open it. iOS Safari, by contrast, turns the same
              download into the native "Add to Calendar" sheet, so the
              option stays for everyone except Android. */}
          {!isAndroid() && (
            <Button variant="secondary" onClick={downloadIcs} className="text-left py-1">
              apple / .ics
            </Button>
          )}
        </div>
      </Modal>
    </>
  );
}
