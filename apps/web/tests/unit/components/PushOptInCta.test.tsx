import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushOptInCta } from "~/components/PushOptInCta";
import type { SaveGate } from "~/hooks/useSaveGate";
import { useStore } from "~/store";

// CTA gating: installed app only. Standalone offers the real subscribe
// (needs the Push API + an unspent ask); a browser tab never shows notify_me,
// whose slot there belongs to InstallAppButton.

const { gateRef } = vi.hoisted(() => ({
  gateRef: { current: { allow: true } as unknown },
}));

vi.mock("~/hooks/useSaveGate", () => ({
  useSaveGate: () => gateRef.current,
  useTriggerInstallPrompt: () => async () => "no-prompt" as const,
}));

function setGate(gate: SaveGate) {
  gateRef.current = gate;
}

function mockNotification(permission: NotificationPermission) {
  const requestPermission = vi.fn().mockResolvedValue(permission);
  Object.defineProperty(window, "Notification", {
    configurable: true,
    value: { permission, requestPermission },
  });
  return requestPermission;
}

const existingSubscriptionJson = {
  endpoint: "https://push.example/existing",
  keys: { p256dh: "p", auth: "a" },
};

// `isStandalone()` checks `navigator.standalone` before falling through to
// matchMedia — defining it is the cheapest way to fake app context per test.
function mockStandaloneDisplayMode() {
  Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
}

function mockPushSupport({
  subscribed,
  subscribeImpl = () => Promise.reject(new Error("not exercised here")),
}: {
  subscribed: boolean;
  subscribeImpl?: () => Promise<unknown>;
}) {
  Object.defineProperty(window, "PushManager", {
    configurable: true,
    value: class PushManager {},
  });
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: vi
            .fn()
            .mockResolvedValue(subscribed ? { toJSON: () => existingSubscriptionJson } : null),
          subscribe: vi.fn(subscribeImpl),
        },
      }),
    },
  });
}

function clearPushGlobals() {
  Reflect.deleteProperty(window, "PushManager");
  Reflect.deleteProperty(navigator, "serviceWorker");
  Reflect.deleteProperty(window, "Notification");
  Reflect.deleteProperty(navigator, "standalone");
}

function pushSubscribeBeacons(): Blob[] {
  const spy = navigator.sendBeacon as unknown as ReturnType<typeof vi.fn>;
  return spy.mock.calls
    .filter(([url]) => url === "/api/push-subscribe")
    .map(([, blob]) => blob as Blob);
}

const tabGate: SaveGate = {
  allow: false,
  reason: "needs-install",
  platform: "chromium",
  canPrompt: false,
};

beforeEach(async () => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
    };
  }
  // The store is a module-level singleton and setState writes through to
  // localStorage — clear BOTH, then rehydrate, so no flag set by a previous
  // test (e.g. the suppression cases) leaks into the next one.
  localStorage.clear();
  useStore.setState({ pushOptInDismissed: false, pushOptInDeclinedSession: false });
  await useStore.persist.rehydrate();
  vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  clearPushGlobals();
});

const ctaButton = () => screen.queryByRole("button", { name: "[ notify_me ]" });

describe("PushOptInCta gating — standalone", () => {
  it("shows when the Push API is present and permission is still default", async () => {
    setGate({ allow: true });
    mockPushSupport({ subscribed: false });
    mockNotification("default");
    render(<PushOptInCta />);

    expect(await screen.findByRole("button", { name: "[ notify_me ]" })).toBeInTheDocument();
  });

  it("hides when permission is granted AND a live subscription exists", async () => {
    setGate({ allow: true });
    mockPushSupport({ subscribed: true });
    mockNotification("granted");
    render(<PushOptInCta />);

    await new Promise((r) => setTimeout(r, 10));
    expect(ctaButton()).not.toBeInTheDocument();
  });

  it("returns when permission is granted but no subscription survived (failed-subscribe recovery)", async () => {
    setGate({ allow: true });
    mockPushSupport({ subscribed: false });
    mockNotification("granted");
    render(<PushOptInCta />);

    expect(await screen.findByRole("button", { name: "[ notify_me ]" })).toBeInTheDocument();
  });

  it("hides when the Push API is absent in standalone (nothing to offer)", async () => {
    setGate({ allow: true });
    render(<PushOptInCta />);

    await new Promise((r) => setTimeout(r, 10));
    expect(ctaButton()).not.toBeInTheDocument();
  });
});

describe("PushOptInCta gating — browser tab", () => {
  it("never shows in a tab, even with an unspent ask (install_the_app holds that slot)", async () => {
    setGate(tabGate);
    mockPushSupport({ subscribed: false });
    mockNotification("default");
    render(<PushOptInCta />);

    await new Promise((r) => setTimeout(r, 10));
    expect(ctaButton()).not.toBeInTheDocument();
  });

  it("never shows in a tab without the Push API either (iOS Safari tab)", async () => {
    setGate(tabGate);
    render(<PushOptInCta />);

    await new Promise((r) => setTimeout(r, 10));
    expect(ctaButton()).not.toBeInTheDocument();
  });
});

describe("PushOptInCta gating — suppression flags", () => {
  // The persisted dismiss flag is covered under "persisted denial flag vs
  // live permission": in the app it only holds while permission is denied.
  it("hides on the session decline flag", async () => {
    setGate({ allow: true });
    mockPushSupport({ subscribed: false });
    mockNotification("default");
    useStore.setState({ pushOptInDeclinedSession: true });
    render(<PushOptInCta />);

    await new Promise((r) => setTimeout(r, 10));
    expect(ctaButton()).not.toBeInTheDocument();
  });
});

// Live permission outranks the persisted denial flag: permission can change
// outside the app (Android settings,
// Chrome site settings, permission resets), so the flag may only suppress
// the CTA while live permission is still "denied" — anything else means
// the flag is stale and must be cleared, or a Block later undone in device
// settings locks the CTA out forever.
describe("PushOptInCta — persisted denial flag vs live permission", () => {
  it("flag set but live permission granted: clears the flag, shows the CTA, tap resumes directly", async () => {
    setGate({ allow: true });
    useStore.setState({ pushOptInDismissed: true });
    mockPushSupport({
      subscribed: false,
      subscribeImpl: () =>
        Promise.resolve({ toJSON: () => ({ endpoint: "https://push.example/x", keys: {} }) }),
    });
    const requestPermission = mockNotification("granted");
    render(<PushOptInCta />);

    expect(await screen.findByRole("button", { name: "[ notify_me ]" })).toBeInTheDocument();
    expect(useStore.getState().pushOptInDismissed).toBe(false);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "[ notify_me ]" }));
    expect(await screen.findByText(/notifications on/i)).toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("flag set and live permission still denied: stays hidden, flag intact", async () => {
    setGate({ allow: true });
    useStore.setState({ pushOptInDismissed: true });
    mockPushSupport({ subscribed: false });
    mockNotification("denied");
    render(<PushOptInCta />);

    await new Promise((r) => setTimeout(r, 10));
    expect(ctaButton()).not.toBeInTheDocument();
    expect(useStore.getState().pushOptInDismissed).toBe(true);
  });

  it("flag set but permission reset to default: clears the flag, tap opens the full soft prompt", async () => {
    setGate({ allow: true });
    useStore.setState({ pushOptInDismissed: true });
    mockPushSupport({ subscribed: false });
    const requestPermission = mockNotification("default");
    render(<PushOptInCta />);

    expect(await screen.findByRole("button", { name: "[ notify_me ]" })).toBeInTheDocument();
    expect(useStore.getState().pushOptInDismissed).toBe(false);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "[ notify_me ]" }));
    expect(await screen.findByText(/hear about new sets/i)).toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

// Reconcile path: a device subscribed BEFORE the
// push_subscriptions migration was applied holds a live local subscription
// with no server row. The CTA correctly hides on it — so the mount effect
// must re-POST the existing subscription (idempotent INSERT OR REPLACE) or
// that device silently never receives a send again.
describe("PushOptInCta — orphaned-subscription reconcile", () => {
  it("re-beacons an existing subscription on mount in standalone", async () => {
    setGate({ allow: true });
    mockStandaloneDisplayMode();
    mockPushSupport({ subscribed: true });
    mockNotification("granted");
    render(<PushOptInCta />);

    await waitFor(() => expect(pushSubscribeBeacons()).toHaveLength(1));
    const [blob] = pushSubscribeBeacons();
    expect(JSON.parse(await (blob as Blob).text())).toMatchObject(existingSubscriptionJson);
    // Still hidden — the device IS subscribed; only the server row was missing.
    expect(ctaButton()).not.toBeInTheDocument();
  });

  it("does NOT re-beacon from a browser tab (a shared subscription's row must keep is_standalone)", async () => {
    setGate(tabGate);
    mockPushSupport({ subscribed: true });
    mockNotification("granted");
    render(<PushOptInCta />);

    await new Promise((r) => setTimeout(r, 10));
    expect(pushSubscribeBeacons()).toHaveLength(0);
  });

  it("does not beacon when there is no existing subscription", async () => {
    setGate({ allow: true });
    mockStandaloneDisplayMode();
    mockPushSupport({ subscribed: false });
    mockNotification("granted");
    render(<PushOptInCta />);

    await new Promise((r) => setTimeout(r, 10));
    expect(pushSubscribeBeacons()).toHaveLength(0);
  });
});

describe("PushOptInCta → PushOptInModal wiring", () => {
  it("tapping the CTA opens the subscribe soft prompt", async () => {
    setGate({ allow: true });
    mockPushSupport({ subscribed: false });
    mockNotification("default");
    render(<PushOptInCta />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "[ notify_me ]" }));

    expect(await screen.findByText(/hear about new sets/i)).toBeInTheDocument();
  });

  it("granted-but-unsubscribed tap goes straight to subscribe — no soft prompt, no requestPermission", async () => {
    setGate({ allow: true });
    mockPushSupport({
      subscribed: false,
      subscribeImpl: () =>
        Promise.resolve({ toJSON: () => ({ endpoint: "https://push.example/x", keys: {} }) }),
    });
    const requestPermission = mockNotification("granted");
    render(<PushOptInCta />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "[ notify_me ]" }));

    expect(await screen.findByText(/notifications on/i)).toBeInTheDocument();
    expect(screen.queryByText(/hear about new sets/i)).not.toBeInTheDocument();
    expect(requestPermission).not.toHaveBeenCalled();
    // Subscribed → the CTA hides while the modal (a sibling) keeps its success copy.
    await waitFor(() => expect(ctaButton()).not.toBeInTheDocument());
    expect(screen.getByText(/notifications on/i)).toBeInTheDocument();
  });

  it("closing a failed direct subscribe keeps the CTA — not a decline, no session flag", async () => {
    setGate({ allow: true });
    mockPushSupport({
      subscribed: false,
      subscribeImpl: () => Promise.reject(new Error("push service unreachable")),
    });
    mockNotification("granted");
    render(<PushOptInCta />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "[ notify_me ]" }));
    await screen.findByRole("button", { name: /try_again/ });
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(ctaButton()).toBeInTheDocument();
    expect(useStore.getState().pushOptInDeclinedSession).toBe(false);
  });

  it("declining the modal suppresses the CTA for the session WITHOUT touching the persisted flag", async () => {
    setGate({ allow: true });
    mockPushSupport({ subscribed: false });
    mockNotification("default");
    render(<PushOptInCta />);

    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "[ notify_me ]" }));
    await user.click(screen.getByRole("button", { name: /not now/i }));

    await waitFor(() => expect(ctaButton()).not.toBeInTheDocument());
    expect(useStore.getState().pushOptInDeclinedSession).toBe(true);
    // The persisted flag is reserved for a spent NATIVE ask — a soft-prompt
    // decline must stay recoverable on the next visit.
    expect(useStore.getState().pushOptInDismissed).toBe(false);
  });
});
