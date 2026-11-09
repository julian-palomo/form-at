import { BracketLabel, Modal, TerminalRow } from "@form-at/ui";
import { useEffect } from "react";

import { StoryEntry, isStoryEntryShown } from "~/components/story/StoryEntry";
import { useStore } from "~/store";
import { getAudioCurrentTime } from "~/store/playerSlice";
import { buildAndroidIntent, isAndroid } from "~/utils/deeplink";
import { fmtTimestamp } from "~/utils/fmt";
import type { ShareTarget } from "~/utils/shareTarget";
import { applyStoryFlagFromUrl } from "~/utils/storyFlag";

// Each platform's `wa.me` / `t.me` URL is already a Universal Link / App Link
// in theory — but Android only honours them if the user has enabled "open
// supported links" in the app's settings. An `intent://` URL forces the OS
// hand-off to the installed app and uses the web URL as graceful fallback.
function whatsappHref(text: string, url: string): string {
  const web = `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
  return isAndroid() ? buildAndroidIntent(web, "com.whatsapp") : web;
}

function telegramHref(url: string, text: string): string {
  const web = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
  return isAndroid() ? buildAndroidIntent(web, "org.telegram.messenger") : web;
}

const rowClass =
  "text-left text-sm text-grey hover:text-white transition-colors tracking-widest cursor-pointer py-1 whitespace-nowrap";
const sectionLabelClass = "text-xs text-grey/60 tracking-widest mb-2";

// The modal's subject row and accessible name, per kind of target.
const SUBJECT_LABEL: Record<ShareTarget["kind"], string> = {
  set: "set",
  dj: "dj",
  event: "event",
  ticket: "ticket",
};
const ARIA_LABEL: Record<ShareTarget["kind"], string> = {
  set: "Share set",
  dj: "Share DJ",
  event: "Share event",
  ticket: "Send ticket",
};

export function ShareModal() {
  const shareTarget = useStore((s) => s.shareTarget);
  const closeShareModal = useStore((s) => s.closeShareModal);
  const setToast = useStore((s) => s.setToast);
  const nowPlaying = useStore((s) => s.nowPlaying);
  const openDjStory = useStore((s) => s.openDjStory);
  const markTicketSent = useStore((s) => s.markTicketSent);

  // ShareModal is mounted once at the root, so this reads the landing URL:
  // a later client-side navigation drops `?story=on` from it.
  useEffect(() => applyStoryFlagFromUrl(), []);

  if (!shareTarget) return null;

  // copy @ <timestamp> exists only for a set; instagram: for a set (the
  // Story video) and a DJ (the Story image).
  const shareSet = shareTarget.kind === "set" ? shareTarget.set : null;
  const shareDj = shareTarget.kind === "dj" ? shareTarget : null;
  const isCurrent = shareSet !== null && nowPlaying?.id === shareSet.id;
  const currentTime = isCurrent ? Math.floor(getAudioCurrentTime()) : 0;
  const { url, title, text } = shareTarget;
  const urlAt = (t?: number) => (t && t > 0 ? `${url}?t=${t}` : url);
  const subject = shareSet ? `${shareSet.artist} @ ${shareSet.title}` : title;
  // Native share is the only realistic way to reach Instagram (Story / DM) and
  // other apps installed on the device, since they don't expose web share URLs.
  const hasNativeShare = typeof navigator !== "undefined" && "share" in navigator;
  const waHref = whatsappHref(text, url);
  const tgHref = telegramHref(url, text);
  const isWaIntent = waHref.startsWith("intent:");
  const isTgIntent = tgHref.startsWith("intent:");

  // A ticket is marked sent once its link has left this modal: the copy
  // landed, the share sheet closed without an error, or whatsapp / telegram
  // opened. That's all the browser reports, so the card can undo it.
  const markSent = () => {
    if (shareTarget.kind === "ticket") markTicketSent(shareTarget.token);
  };

  const copy = async (t?: number) => {
    try {
      await navigator.clipboard.writeText(urlAt(t));
      setToast("link_copied");
      markSent();
    } catch {
      setToast("share_unavailable");
    }
    closeShareModal();
  };

  const shareViaApps = async () => {
    try {
      await navigator.share({ title, text, url });
      markSent();
    } catch {
      // user cancelled or share failed — fall through silently
    }
    closeShareModal();
  };

  const sendViaLink = () => {
    markSent();
    closeShareModal();
  };

  // instagram: for a set holds the Story video, shown only when its entry
  // renders (isStoryEntryShown: phone, flag or launch, recording support),
  // so the label never stands over an empty column. Only open after a tap,
  // on the client, so reading window state here can't mismatch hydration.
  // For a DJ it always holds the Story image: a still, for every browser.
  const showSetStory = shareSet !== null && isStoryEntryShown();

  // Copies the DJ page link inside this tap, while the gesture is fresh, for
  // Instagram's link sticker; then the DJ Story sheet replaces this modal.
  const openDjStoryImage = async () => {
    if (!shareDj) return;
    let linkCopied = false;
    try {
      await navigator.clipboard.writeText(url);
      linkCopied = true;
    } catch {
      // No clipboard: the sheet names the link to add instead.
    }
    openDjStory({ dj: shareDj.dj, nextEvent: shareDj.nextEvent, linkCopied });
  };

  return (
    <Modal
      open
      onClose={closeShareModal}
      ariaLabel={ARIA_LABEL[shareTarget.kind]}
      title={
        <div className="text-xs text-grey tracking-widest truncate">
          › <span className="text-white">share_signal</span>
        </div>
      }
    >
      {/* Subject row — names what's about to be shared, in the same
          terminal-row style as the rest of the app. Long artist names
          wrap inside the body instead of truncating in the title. */}
      <TerminalRow label={SUBJECT_LABEL[shareTarget.kind]} value={subject} className="mb-6" />
      {/* instagram: first, above link: and send:. A set's row is the
          recorded video (StoryEntry, only where isStoryEntryShown); a DJ's
          is the still image, for everyone. An event has none, and without
          it the modal is just the row below. */}
      {shareSet && showSetStory && (
        <div className="mb-4">
          <div className={sectionLabelClass}>instagram:</div>
          <div className="flex flex-col">
            <StoryEntry set={shareSet} rowClass={rowClass} />
          </div>
        </div>
      )}
      {shareDj && (
        <div className="mb-4">
          <div className={sectionLabelClass}>instagram:</div>
          <div className="flex flex-col">
            <button type="button" onClick={openDjStoryImage} className={rowClass}>
              <BracketLabel>image_story</BracketLabel>
            </button>
          </div>
        </div>
      )}
      {/* Flexbox + flex-shrink-0 lets each column auto-size to its widest
          button (e.g. `[ copy @ 49:00 ]`) instead of being forced into an
          equal half. When the two columns together can't fit the modal
          width, flex-wrap stacks them vertically — no manual breakpoint. */}
      <div className="flex flex-wrap gap-x-6 gap-y-4">
        <div className="flex-shrink-0">
          <div className={sectionLabelClass}>link:</div>
          <div className="flex flex-col">
            <button type="button" onClick={() => copy()} className={rowClass}>
              <BracketLabel>copy_link</BracketLabel>
            </button>
            {isCurrent && currentTime > 3 && (
              <button type="button" onClick={() => copy(currentTime)} className={rowClass}>
                <BracketLabel>copy @ {fmtTimestamp(currentTime)}</BracketLabel>
              </button>
            )}
          </div>
        </div>
        <div className="flex-shrink-0">
          <div className={sectionLabelClass}>send:</div>
          <div className="flex flex-col">
            {hasNativeShare && (
              <button type="button" onClick={shareViaApps} className={rowClass}>
                <BracketLabel>apps</BracketLabel>
              </button>
            )}
            <a
              href={waHref}
              target={isWaIntent ? undefined : "_blank"}
              rel={isWaIntent ? undefined : "noopener noreferrer"}
              onClick={sendViaLink}
              className={rowClass}
            >
              <BracketLabel>whatsapp</BracketLabel>
            </a>
            <a
              href={tgHref}
              target={isTgIntent ? undefined : "_blank"}
              rel={isTgIntent ? undefined : "noopener noreferrer"}
              onClick={sendViaLink}
              className={rowClass}
            >
              <BracketLabel>telegram</BracketLabel>
            </a>
          </div>
        </div>
      </div>
    </Modal>
  );
}
