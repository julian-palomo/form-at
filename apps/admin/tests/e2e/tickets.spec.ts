import { expect, test } from "@playwright/test";
import { gotoAndHydrate } from "./_helpers";

// The e2e server runs outside Cloudflare, so /tickets renders data/sales.ts's
// sample orders and tiers (marked "sample data") instead of reading D1.
test.describe("admin sales list", () => {
  test("renders the totals and the orders, newest first", async ({ page }) => {
    await gotoAndHydrate(page, "/tickets");
    await expect(page.getByRole("heading", { name: /tickets/i })).toBeVisible();
    await expect(page.getByText(/sample data/i)).toBeVisible();

    const totals = page.getByRole("region", { name: "totals" });
    await expect(totals).toContainText("24");
    await expect(totals).toContainText("£30.00");

    const orders = page.getByRole("listitem").filter({ hasText: "@example.com" });
    await expect(orders).toHaveCount(5);
    await expect(orders.first()).toContainText("Morven Bell");
    await expect(orders.first()).toContainText("holding until");
    await expect(page.getByText("1 of 3 in")).toBeVisible();
    await expect(page.getByText("lapsed")).toBeVisible();
  });
});
