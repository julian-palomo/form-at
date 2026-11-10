import { expect, test } from "@playwright/test";
import { gotoAndHydrate } from "./_helpers";

// One silent MP3 frame, as in player.spec.ts: <audio> needs real bytes to
// reach "playing".
const SILENT_MP3_BASE64 =
  "SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQwAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAACAAACgAB4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eAAAAAA";

test.describe("home page", () => {
  test("renders manifesto and main CTA", async ({ page }) => {
    await gotoAndHydrate(page, "/");
    await expect(
      page.locator(".Typewriter__wrapper", { hasText: /Based in Glasgow/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: /play_latest|resume_signal|pause/ }),
    ).toBeVisible();
  });

  test("the play button toggles the newest set in place, never navigating", async ({ page }) => {
    await page.route(/\.mp3(\?.*)?$/i, (route) =>
      route.fulfill({
        status: 200,
        contentType: "audio/mpeg",
        body: Buffer.from(SILENT_MP3_BASE64, "base64"),
      }),
    );
    await gotoAndHydrate(page, "/");

    await page.getByRole("button", { name: "play_latest" }).click();
    // The newest set is now loaded, so the button reads pause, or
    // resume_signal where headless Chromium reports a playback error on the
    // one-frame fixture. Either way it's the toggle for that set. Its name
    // carries the gold "›", which keeps the player bar's own control out.
    const toggle = page.getByRole("button", { name: /^›\s*(pause|resume_signal)$/ });
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    // A second tap used to navigate to /sets while playing; now it only
    // toggles.
    await toggle.click();
    await expect(toggle).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  // Regression guard for "Fitting the home page on a short phone" in
  // global.css: at idle on an iPhone SE-size screen (375×667), install_the_app
  // must end above the bottom nav, not under it. Phone projects only: the
  // bottom nav is sm:hidden.
  test("on an iPhone SE screen install_the_app clears the bottom nav at idle", async ({
    page,
  }, testInfo) => {
    test.skip(
      !["mobile-chrome", "mobile-safari"].includes(testInfo.project.name),
      "phones only: the bottom nav doesn't render on desktop",
    );
    await page.setViewportSize({ width: 375, height: 667 });
    await gotoAndHydrate(page, "/");

    const install = page.getByRole("button", { name: "[ install_the_app ]" });
    await expect(install).toBeVisible();
    const bottomNav = page.locator("nav").filter({ visible: true });
    await expect(bottomNav).toHaveCount(1);

    const installBox = await install.boundingBox();
    const navBox = await bottomNav.boundingBox();
    if (!installBox || !navBox) throw new Error("install_the_app or the bottom nav has no box");
    expect(installBox.y + installBox.height).toBeLessThanOrEqual(navBox.y);
  });

  test("renders the community and instagram links, and no bookings", async ({ page }) => {
    await gotoAndHydrate(page, "/");

    const ig = page.getByRole("link", { name: /instagram/i });
    await expect(ig).toBeVisible();
    await expect(ig).toHaveAttribute("href", /instagram\.com\/form\.at_glasgow/);

    const community = page.getByRole("link", { name: /community/i });
    await expect(community).toBeVisible();
    await expect(community).toHaveAttribute("href", /^https:\/\/chat\.whatsapp\.com\//);

    await expect(page.getByRole("button", { name: /bookings/i })).toHaveCount(0);
  });

  // The e2e server has no D1 and no Stripe secrets, so no sale is open: the
  // home page must not sell a night whose tickets can't be bought.
  test("with sales off the home page doesn't point at the night's tickets", async ({ page }) => {
    await gotoAndHydrate(page, "/");
    await expect(
      page.getByRole("button", { name: /play_latest|resume_signal|pause/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /get_tickets_for/ })).toHaveCount(0);
  });

  test("a device holding a ticket for the next night gets the way to it", async ({ page }) => {
    await page.addInitScript(() => {
      const token = "aaaaaaaa-0000-4000-8000-000000000001.sig";
      const ticket = {
        token,
        eventId: "format-004",
        tierName: "early",
        name: null,
        seq: 0,
        quantity: 1,
        storedAt: 1,
      };
      localStorage.setItem(
        "format-player",
        JSON.stringify({ state: { tickets: { [token]: ticket } }, version: 0 }),
      );
    });
    await gotoAndHydrate(page, "/");

    const mine = page.getByRole("link", { name: /your_ticket_for_004/ });
    await expect(mine).toBeVisible();
    await expect(mine).toHaveAttribute("href", "/tickets");
    await expect(page.getByRole("button", { name: /play_latest/ })).toHaveCount(0);
  });
});
