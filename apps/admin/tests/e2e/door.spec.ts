import { expect, test } from "@playwright/test";
import { gotoAndHydrate } from "./_helpers";

// The e2e server runs outside Cloudflare, so /door renders data/door.ts's
// sample orders (marked "sample data") instead of reading D1. Check-in itself
// isn't exercised here: with no Access config the endpoint answers 401, and
// its behaviour is covered by tests/unit/routes/api-tickets-check-in.test.ts.
test.describe("admin door list", () => {
  test("renders the list with counts and the checked-in time", async ({ page }) => {
    await gotoAndHydrate(page, "/door");
    await expect(page.getByRole("heading", { name: /door/i })).toBeVisible();
    await expect(page.getByText(/sample data/i)).toBeVisible();

    // One row per ticket: Callum's order of 2 is two rows.
    const rows = page.getByRole("listitem");
    await expect(rows).toHaveCount(5);
    await expect(page.getByText("second · 2 of 2")).toBeVisible();
    await expect(page.getByText("in at 23:42")).toBeVisible();
    await expect(page.getByRole("button", { name: /check in/i })).toHaveCount(4);
    await expect(page.getByRole("link", { name: /download csv/i })).toHaveAttribute(
      "href",
      "/api/tickets/door-csv",
    );
  });

  test("the door counter adds door sales to the online check-ins", async ({ page }) => {
    await gotoAndHydrate(page, "/door");
    const counter = page.getByRole("region", { name: "door sales" });
    // Sample data: 1 online in + 7 cash + 4 card; 300 − 5 paid online − 11.
    await expect(counter).toContainText("12 / 300");
    await expect(counter.getByText("284", { exact: true })).toBeVisible();
    await expect(counter.getByText("£84.00")).toBeVisible();
    await expect(counter.getByRole("button", { name: /\+1 cash/ })).toBeVisible();
    await expect(counter.getByRole("button", { name: /\+1 card/ })).toBeVisible();
    await expect(counter.getByRole("button", { name: /−1/ })).toBeVisible();
  });

  test("the search filters by name and by email", async ({ page }) => {
    await gotoAndHydrate(page, "/door");
    const search = page.getByLabel(/search name or email/i);
    const rows = page.getByRole("listitem");

    await search.fill("callum");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Callum Reid");

    await search.fill("no-name@");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("no-name@example.com");

    await search.fill("");
    await expect(rows).toHaveCount(5);
  });
});
