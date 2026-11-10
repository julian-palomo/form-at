import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SocialLink } from "~/components/SocialLink";

const ORIGINAL_UA = navigator.userAgent;
const ORIGINAL_LOCATION = window.location;
let openSpy: ReturnType<typeof vi.spyOn>;
let hrefSetter: ReturnType<typeof vi.fn>;

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    get: () => ua,
  });
}

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: "",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  });
}

function stubLocation() {
  hrefSetter = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      set href(v: string) {
        hrefSetter(v);
      },
      get href() {
        return "";
      },
    },
  });
}

beforeEach(() => {
  openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  vi.restoreAllMocks();
  setUserAgent(ORIGINAL_UA);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: ORIGINAL_LOCATION,
  });
});

describe("SocialLink", () => {
  it("renders an anchor with the provided href", () => {
    mockMatchMedia(true);
    render(<SocialLink href="https://example.com">link</SocialLink>);
    expect(screen.getByRole("link", { name: /link/ })).toHaveAttribute(
      "href",
      "https://example.com",
    );
  });

  it("opens in a new tab on mouse-first devices", async () => {
    mockMatchMedia(false); // pointer: coarse → false → mouse
    const user = userEvent.setup();
    render(<SocialLink href="https://example.com">link</SocialLink>);
    await user.click(screen.getByRole("link"));
    expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
  });

  it("falls through to default <a> navigation on touch devices (Universal Links)", async () => {
    mockMatchMedia(true);
    const user = userEvent.setup();
    render(<SocialLink href="https://example.com">link</SocialLink>);
    await user.click(screen.getByRole("link"));
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("calls onTap on a primary click, before navigating, and not on a modifier-click", async () => {
    mockMatchMedia(false);
    const onTap = vi.fn();
    render(
      <SocialLink href="https://example.com" onTap={onTap}>
        link
      </SocialLink>,
    );
    fireEvent.click(screen.getByRole("link"), { metaKey: true });
    expect(onTap).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("link"));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("leaves modifier-clicks alone for power users", () => {
    mockMatchMedia(false);
    render(<SocialLink href="https://example.com">link</SocialLink>);
    fireEvent.click(screen.getByRole("link"), { metaKey: true });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("rewrites to an intent:// URL on Android when a package is supplied", () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36");
    mockMatchMedia(true);
    stubLocation();

    render(
      <SocialLink
        href="https://instagram.com/form.at_glasgow"
        androidPackage="com.instagram.android"
      >
        link
      </SocialLink>,
    );
    fireEvent.click(screen.getByRole("link"));

    expect(hrefSetter).toHaveBeenCalledTimes(1);
    const navigatedTo = hrefSetter.mock.calls[0][0] as string;
    expect(navigatedTo).toMatch(/^intent:\/\//);
    expect(navigatedTo).toContain("package=com.instagram.android");
    expect(navigatedTo).toContain("S.browser_fallback_url=");
    // window.open should NOT have been called — the intent path takes over
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("on Android with no package, still falls through to default navigation", async () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 6) AppleWebKit/537.36");
    mockMatchMedia(true);
    const user = userEvent.setup();
    render(<SocialLink href="https://example.com">link</SocialLink>);
    await user.click(screen.getByRole("link"));
    expect(openSpy).not.toHaveBeenCalled();
  });
});
