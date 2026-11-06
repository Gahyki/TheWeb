import { expect, type Page, test } from "@playwright/test";

const MESSAGE = "A thoughtful message with plenty of length to pass validation.";

/** Deep-link to the contact section and fill the form. */
async function fillContactForm(page: Page) {
  await page.goto("/contact");
  await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[name="name"]').fill("Ada Lovelace");
  await page.locator('input[name="email"]').fill("ada@example.com");
  await page.locator('textarea[name="message"]').fill(MESSAGE);
}

test.describe("contact form submission", () => {
  test.beforeEach(async ({ page }) => {
    // Every section mounts in the continuous page; keep the GitHub panel's
    // fetch hermetic.
    await page.route("**/api/github", (route) =>
      route.fulfill({ json: { repos: [], contributions: null } }),
    );
    await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
  });

  test("an accepted submission shows the success status and clears the form", async ({ page }) => {
    await page.route("**/api/contact", (route) =>
      route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ status: "accepted" }),
      }),
    );
    await fillContactForm(page);
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByRole("status")).toHaveText("Thanks, your message was sent.");
    await expect(page.locator('input[name="name"]')).toHaveValue("");
    await expect(page.locator('input[name="email"]')).toHaveValue("");
    await expect(page.locator('textarea[name="message"]')).toHaveValue("");
  });

  test("a field validation error surfaces and preserves the typed message", async ({ page }) => {
    await page.route("**/api/contact", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "Please enter a valid email address.", field: "email" }),
      }),
    );
    await fillContactForm(page);
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByRole("alert")).toHaveText("Please enter a valid email address.");
    await expect(page.locator('textarea[name="message"]')).toHaveValue(MESSAGE);
    const email = page.locator('input[name="email"]');
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toBeFocused();
  });

  test("an unconfigured delivery backend surfaces the server error", async ({ page }) => {
    await page.route("**/api/contact", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Contact delivery is not configured yet." }),
      }),
    );
    await fillContactForm(page);
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByRole("alert")).toHaveText("Contact delivery is not configured yet.");
  });
});
