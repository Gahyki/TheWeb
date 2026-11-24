import { expect, type Page, type Route, test } from "@playwright/test";

const MESSAGE = "A thoughtful message with plenty of length to pass validation.";
const DEFAULT_ERROR = "The contact form is unavailable right now. Please try again later.";

/** Deep-link to the contact section and fill the form. */
async function fillContactForm(page: Page, message = MESSAGE) {
  await page.goto("/contact");
  await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[name="name"]').fill("Ada Lovelace");
  await page.locator('input[name="email"]').fill("ada@example.com");
  await page.locator('textarea[name="message"]').fill(message);
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

  test("a multi-line message posts as LF-only JSON, one send at a time", async ({ page }) => {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/contact", async (route) => {
      await held;
      await route.fulfill({ status: 202, json: { status: "accepted" } });
    });
    // Chromium's FormData already gives LF; feed CRLF so the client's own
    // strip is what gets tested.
    await page.addInitScript(() => {
      const get = FormData.prototype.get;
      FormData.prototype.get = function (this: FormData, name: string) {
        const value = get.call(this, name);
        return typeof value === "string" ? value.replace(/\n/g, "\r\n") : value;
      };
    });
    await fillContactForm(page, "Line one is long enough.\nLine two.");
    const sent = page.waitForRequest("**/api/contact");
    const submit = page.locator('[data-section="sun"] button[type="submit"]');
    await submit.click();

    const request = await sent;
    expect(request.method()).toBe("POST");
    expect(await request.headerValue("content-type")).toBe("application/json");
    expect(request.postDataJSON()).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      message: "Line one is long enough.\nLine two.",
    });
    await expect(submit).toHaveText("Sending…");
    await expect(submit).toBeDisabled();

    release();
    await expect(page.getByRole("status")).toHaveText("Thanks, your message was sent.");
    await expect(submit).toHaveText("Send message");
    await expect(submit).toBeEnabled();
  });

  for (const [failure, reply] of [
    ["a network failure", (route: Route) => route.abort("failed")],
    [
      "a non-JSON 502",
      (route: Route) =>
        route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad gateway</h1>" }),
    ],
  ] as const) {
    test(`${failure} shows the generic error and keeps the draft`, async ({ page }) => {
      await page.route("**/api/contact", reply);
      await fillContactForm(page);
      await page.getByRole("button", { name: "Send message" }).click();

      await expect(page.getByRole("alert")).toHaveText(DEFAULT_ERROR);
      await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
      await expect(page.locator('input[name="name"]')).toHaveValue("Ada Lovelace");
      await expect(page.locator('input[name="email"]')).toHaveValue("ada@example.com");
      await expect(page.locator('textarea[name="message"]')).toHaveValue(MESSAGE);
    });
  }

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

  test("a non-ASCII message error marks and focuses the message field", async ({ page }) => {
    const error = "Messages can only use English letters, numbers, and basic punctuation.";
    await page.route("**/api/contact", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error, field: "message" }),
      }),
    );
    await fillContactForm(page);
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByRole("alert")).toHaveText(error);
    const messageField = page.locator('textarea[name="message"]');
    await expect(messageField).toHaveValue(MESSAGE);
    await expect(messageField).toHaveAttribute("aria-invalid", "true");
    await expect(messageField).toBeFocused();
    await expect(page.locator('input[name="email"]')).not.toHaveAttribute("aria-invalid", "true");
  });

  test("a name format error marks and focuses the name field", async ({ page }) => {
    const error = "Names can only use letters (accents are fine), numbers, and basic punctuation.";
    await page.route("**/api/contact", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error, field: "name" }),
      }),
    );
    await fillContactForm(page);
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByRole("alert")).toHaveText(error);
    const nameField = page.locator('input[name="name"]');
    await expect(nameField).toHaveAttribute("aria-invalid", "true");
    await expect(nameField).toBeFocused();
    await expect(page.locator('textarea[name="message"]')).toHaveValue(MESSAGE);
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
