import { expect, test } from "@playwright/test";
import { gotoAndHydrate } from "./_helpers";

test.describe("navigation", () => {
  test("desktop nav links route between sections", async ({ page, isMobile }) => {
    test.skip(isMobile, "Desktop nav is hidden on small viewports");
    await gotoAndHydrate(page, "/");
    for (const [label, urlRe] of [
      ["events", /\/events$/],
      ["sets", /\/sets$/],
      ["djs", /\/djs$/],
      ["tickets", /\/tickets$/],
      ["home", /\/$/],
    ] as const) {
      await page.getByRole("link", { name: label, exact: true }).first().click();
      await expect(page).toHaveURL(urlRe);
    }
  });

  test("mobile bottom nav links route between sections", async ({ page, isMobile }) => {
    test.skip(!isMobile, "BottomNav is mobile-only");
    await gotoAndHydrate(page, "/");
    for (const [label, urlRe] of [
      ["events", /\/events$/],
      ["sets", /\/sets$/],
      ["djs", /\/djs$/],
      ["tickets", /\/tickets$/],
    ] as const) {
      await page.getByRole("link", { name: label, exact: true }).first().click();
      await expect(page).toHaveURL(urlRe);
    }
  });
});
