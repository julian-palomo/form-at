import { expect, test } from "@playwright/test";
import { gotoAndHydrate } from "./_helpers";

// The e2e server runs outside Cloudflare, with no D1 binding and no Stripe
// secrets, so ticket sales are off: these check that the pages still render
// and that nothing for sale appears where sales aren't configured. The sales
// flow itself is covered by the unit tests; a real payment needs a test-mode
// purchase on a Preview deployment with the Stripe secrets set.

test.describe("tickets", () => {
  test("an upcoming event page renders without a buy block when sales are off", async ({
    page,
  }) => {
    await gotoAndHydrate(page, "/events");
    await page
      .getByRole("button", { name: /form:at 004/i })
      .first()
      .click();
    await expect(page).toHaveURL(/\/events\/format-004$/);
    await expect(page.getByRole("heading", { name: /form:at 004/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /buy ticket/i })).toHaveCount(0);
  });

  test("the return page explains an unknown checkout instead of failing", async ({ page }) => {
    await gotoAndHydrate(page, "/tickets/success?session_id=cs_test_unknown");
    await expect(page.getByText(/we can't find this checkout/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /events/i }).first()).toBeVisible();
  });
});
