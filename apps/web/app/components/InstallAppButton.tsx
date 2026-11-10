import { Button, InstallMobileIcon } from "@form-at/ui";
import { useEffect, useState } from "react";

import { type InstallGateCopy, SaveGateModal } from "~/components/SaveGateModal";
import { useFirstLoad } from "~/hooks/useFirstLoad";
import { useSaveGate, useTriggerInstallPrompt } from "~/hooks/useSaveGate";
import { useTrackEvent } from "~/hooks/useTrackEvent";
import { type FormFactor, detectFormFactor } from "~/utils/deviceFormFactor";

const INSTALL_COPY: InstallGateCopy = {
  ariaLabel: "Form:at — install the app",
  label: "install_the_app",
  prompt:
    "Form:at installs to your home screen — sets saved for offline listening, notifications for new sets, fullscreen with no browser chrome.",
  manual:
    "Form:at installs to your home screen — sets saved offline, notifications for new sets — ",
  ios: "Form:at installs to your home screen — sets saved offline, notifications for new sets. on iOS it installs from the share menu:",
  openApp:
    "Form:at is already on your device — open it from your home screen. this tab streams sets; the app also saves them offline and sends notifications.",
  cannotInstall: "Form:at installs to your home screen as an app —",
};

// [ install_the_app ] — the home page's install CTA in a browser tab, in the slot
// the installed app gives to notify_me (routes/index.tsx). Push subscriptions
// are app-only, so in a tab the one useful ask is the install.
//
// Who sees it: every tab whose gate isn't `allow` (that's the app) or
// `pending` (not hydrated yet), EXCEPT desktop browsers that can't install
// (desktop Safari / Firefox): there's nothing to do there but switch
// browsers. A phone that can't install still sees it, because "open this in
// Chrome / Safari" is something it can act on.
//
// What a tap does: with Chrome's install prompt captured, fire it directly —
// one tap, no modal in between. Anything else opens SaveGateModal with the
// install copy, the same branching save_for_offline uses (manual hint, iOS
// share-menu steps per browser, open-app, where to install instead).
//
// Always visible once it applies, even after a dismissed prompt: an explicit
// button, like save_for_offline, not a passive nudge.
export function InstallAppButton() {
  const gate = useSaveGate();
  const triggerInstall = useTriggerInstallPrompt();
  const trackEvent = useTrackEvent();
  const [open, setOpen] = useState(false);
  const [formFactor] = useState<FormFactor>(() =>
    typeof window !== "undefined" ? detectFormFactor() : "desktop",
  );

  if (gate.allow || gate.reason === "pending") return null;
  if (gate.reason === "cannot-install" && formFactor === "desktop") return null;

  const promptReady = gate.reason === "needs-install" && gate.canPrompt;
  const onTap = () => {
    if (promptReady) {
      triggerInstall();
      return;
    }
    trackEvent("install_cta_instructions_shown");
    setOpen(true);
  };

  return (
    <>
      <InstallAppButtonView promptReady={promptReady} onTap={onTap} />
      <SaveGateModal open={open} onClose={() => setOpen(false)} gate={gate} copy={INSTALL_COPY} />
    </>
  );
}

// Split from the gate above so the fade and `install_prompt_shown` run from
// the button's own mount. Keyframe classes, as in PushOptInCta: the button
// mounts after hydration, too late for an opacity transition to paint its
// first frame.
function InstallAppButtonView({ promptReady, onTap }: { promptReady: boolean; onTap: () => void }) {
  const isFirstLoad = useFirstLoad();
  const trackEvent = useTrackEvent();
  // `install_prompt_shown` keeps meaning what it meant for the old
  // install_form:at button: an install CTA on screen with Chrome's prompt
  // behind it. Without a prompt the tap opens instructions instead, counted
  // separately as install_cta_instructions_shown.
  useEffect(() => {
    if (promptReady) trackEvent("install_prompt_shown");
  }, [promptReady, trackEvent]);

  return (
    <div className={isFirstLoad ? "animate-slow-fade-in" : "animate-fade-in"}>
      <Button variant="secondary" onClick={onTap}>
        <InstallMobileIcon className="inline-block align-[-0.15em]" /> install_the_app
      </Button>
    </div>
  );
}
