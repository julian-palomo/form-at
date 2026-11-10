import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstallAppButton } from "~/components/InstallAppButton";
import type { SaveGate } from "~/hooks/useSaveGate";

// The home page's [ install_the_app ]: who sees it, and what a tap does, per
// gate. The gate itself (UA → platform → reason) is useSaveGate's and
// installCapability's to test; here it's an input.

const { gateRef, formFactorRef, triggerInstall, trackEvent } = vi.hoisted(() => ({
  gateRef: { current: { allow: true } as unknown },
  formFactorRef: { current: "mobile" as "mobile" | "desktop" },
  triggerInstall: vi.fn(async () => "accepted" as const),
  trackEvent: vi.fn(),
}));

vi.mock("~/hooks/useSaveGate", () => ({
  useSaveGate: () => gateRef.current,
  useTriggerInstallPrompt: () => triggerInstall,
}));
vi.mock("~/hooks/useTrackEvent", () => ({ useTrackEvent: () => trackEvent }));
vi.mock("~/utils/deviceFormFactor", () => ({ detectFormFactor: () => formFactorRef.current }));

const setGate = (gate: SaveGate) => {
  gateRef.current = gate;
};
const button = () => screen.queryByRole("button", { name: "[ install_the_app ]" });

afterEach(() => {
  formFactorRef.current = "mobile";
  triggerInstall.mockClear();
  trackEvent.mockClear();
});

describe("InstallAppButton — who sees it", () => {
  it("isn't there in the installed app (notify_me has that slot)", () => {
    setGate({ allow: true });
    render(<InstallAppButton />);
    expect(button()).not.toBeInTheDocument();
  });

  it("isn't there before the store hydrates", () => {
    setGate({ allow: false, reason: "pending" });
    render(<InstallAppButton />);
    expect(button()).not.toBeInTheDocument();
  });

  it("isn't there on a desktop browser that can't install (desktop Safari / Firefox)", () => {
    formFactorRef.current = "desktop";
    setGate({ allow: false, reason: "cannot-install", hint: "use-chrome-or-safari" });
    render(<InstallAppButton />);
    expect(button()).not.toBeInTheDocument();
  });

  it("is there on a phone that can't install: switching browser is actionable", () => {
    setGate({ allow: false, reason: "cannot-install", hint: "use-chrome" });
    render(<InstallAppButton />);
    expect(button()).toBeInTheDocument();
  });

  it("is there on desktop Chromium, a secondary bracket button with the phone icon", () => {
    formFactorRef.current = "desktop";
    setGate({ allow: false, reason: "needs-install", platform: "chromium", canPrompt: true });
    render(<InstallAppButton />);
    expect(button()).toHaveClass("text-grey");
    // The icon is decorative: the accessible name is the bracketed label alone.
    expect(button()?.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  });
});

describe("InstallAppButton — what a tap does", () => {
  it("with Chrome's prompt ready: fires it directly, no modal, counted as install_prompt_shown", async () => {
    setGate({ allow: false, reason: "needs-install", platform: "chromium", canPrompt: true });
    render(<InstallAppButton />);
    expect(trackEvent).toHaveBeenCalledWith("install_prompt_shown");

    await userEvent.setup().click(button() as HTMLElement);
    expect(triggerInstall).toHaveBeenCalledTimes(1);
    expect(trackEvent).not.toHaveBeenCalledWith("install_cta_instructions_shown");
    expect(screen.queryByText(/installs to your home screen/)).not.toBeInTheDocument();
  });

  it("iOS Safari: opens the share-menu steps, counted as install_cta_instructions_shown", async () => {
    setGate({ allow: false, reason: "needs-install", platform: "ios-safari", canPrompt: false });
    render(<InstallAppButton />);
    expect(trackEvent).not.toHaveBeenCalledWith("install_prompt_shown");

    await userEvent.setup().click(button() as HTMLElement);
    expect(trackEvent).toHaveBeenCalledWith("install_cta_instructions_shown");
    expect(screen.getByText(/at the bottom of Safari/)).toBeInTheDocument();
  });

  it("Chrome on iOS 16.4+: the steps are worded for Chrome", async () => {
    setGate({
      allow: false,
      reason: "needs-install",
      platform: "ios-other",
      browser: "Chrome",
      canPrompt: false,
    });
    render(<InstallAppButton />);
    await userEvent.setup().click(button() as HTMLElement);
    expect(screen.getByText(/in Chrome's address bar/)).toBeInTheDocument();
  });

  it("Firefox on Android: says to install from Chrome", async () => {
    setGate({ allow: false, reason: "cannot-install", hint: "use-chrome" });
    render(<InstallAppButton />);
    await userEvent.setup().click(button() as HTMLElement);
    expect(screen.getByText(/and install from there/)).toBeInTheDocument();
    expect(screen.getByText("Chrome")).toBeInTheDocument();
  });

  it("an iOS browser older than 16.4: says to install from Safari", async () => {
    setGate({ allow: false, reason: "cannot-install", hint: "use-safari" });
    render(<InstallAppButton />);
    await userEvent.setup().click(button() as HTMLElement);
    expect(screen.getByText(/only installs from Safari/)).toBeInTheDocument();
  });
});
