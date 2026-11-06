import { expect, test } from "@playwright/test";

test.describe("solar system navigation", () => {
  test.beforeEach(async ({ page }) => {
    // All section panels mount together in the continuous page, so the
    // GitHub panel fetches on every load; this suite stubs all /api/*
    // (wiring.spec.ts is the only real-stack exception).
    await page.route("**/api/github", (route) =>
      route.fulfill({ json: { repos: [], contributions: null } }),
    );
    await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
  });

  test("the root path lands on Home with tab navigation and no page errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Sections" });
    await expect(nav.getByText("Home", { exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByText("Experience", { exact: true })).toBeVisible();
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.locator('[data-section="earth"]')).toBeInViewport();

    expect(errors.filter((message) => !message.includes("WebSocket"))).toEqual([]);
  });

  test("the solar-system overview lives at /system", async ({ page }) => {
    await page.goto("/system");
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.locator("[data-scroll-root]")).toHaveCount(0);
    await expect(
      page.getByRole("navigation", { name: "Sections" }).getByText("Home", { exact: true }),
    ).not.toHaveAttribute("aria-current", "page");
  });

  test("every section round-trips from the overview with its caption", async ({ page }) => {
    const sections: Array<{ label: string; path: string; section: string; planet: string }> = [
      { label: "Home", path: "/", section: "earth", planet: "Earth" },
      { label: "Experience", path: "/experience", section: "saturn", planet: "Saturn" },
      { label: "How I Think", path: "/thinking", section: "jupiter", planet: "Jupiter" },
      { label: "GitHub", path: "/github", section: "mars", planet: "Mars" },
      { label: "Contact", path: "/contact", section: "sun", planet: "Sun" },
    ];
    await page.goto("/system");
    const nav = page.getByRole("navigation", { name: "Sections" });

    for (const { label, path, section } of sections) {
      // Overview → section flight completes: URL and content land. The
      // planet caption is a scene sprite now, invisible to the DOM.
      await nav.getByText(label, { exact: true }).click();
      await expect(page).toHaveURL(path, { timeout: 10_000 });
      await expect(page.locator(`[data-section="${section}"]`)).toBeInViewport({
        timeout: 10_000,
      });

      // Section → overview flight completes and tears the scroller down.
      await page.getByRole("button", { name: /to system/ }).click();
      await expect(page).toHaveURL("/system", { timeout: 10_000 });
      await expect(page.locator("[data-scroll-root]")).toHaveCount(0, { timeout: 10_000 });
    }
  });

  test("a non-adjacent tab click flies directly to its planet", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-section="earth"]')).toBeInViewport();

    // Home → GitHub skips Experience and How I Think: the URL moves in one
    // step and the journey still lands with content and caption.
    await page.getByRole("navigation", { name: "Sections" }).getByText("GitHub", { exact: true }).click();
    await expect(page).toHaveURL("/github");
    await expect(page.locator('[data-section="mars"]')).toBeInViewport({ timeout: 10_000 });
  });

  test("tabs navigate to sections and Escape goes to the overview", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Sections" });

    await nav.getByText("Experience", { exact: true }).click();
    await expect(page).toHaveURL("/experience");
    await expect(page.getByText("Experience & education")).toBeInViewport({ timeout: 10_000 });

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL("/system");
  });

  test("continuous scrolling flows into the next section", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('[data-section="earth"]')).toBeInViewport();

    // Scroll like a visitor: repeated wheel ticks over the page center.
    await page.mouse.move(640, 360);
    await expect
      .poll(
        async () => {
          if (new URL(page.url()).pathname === "/") {
            await page.mouse.wheel(0, 400);
          }
          return new URL(page.url()).pathname;
        },
        { timeout: 10_000 },
      )
      .toBe("/experience");
    await expect(page.locator('[data-section="saturn"]')).toBeInViewport();
  });

  test("browser back and forward move through visited sections", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Sections" });
    // The URL updates natively on history traversal, so each step must also
    // assert a store-derived signal (the active tab) — otherwise this spec
    // passes even with a dead popstate handler.
    const activeTab = (label: string) =>
      expect(nav.getByText(label, { exact: true })).toHaveAttribute("aria-current", "page", {
        timeout: 10_000,
      });

    await nav.getByText("Experience", { exact: true }).click();
    await expect(page).toHaveURL("/experience", { timeout: 10_000 });
    await nav.getByText("GitHub", { exact: true }).click();
    await expect(page).toHaveURL("/github", { timeout: 10_000 });

    await page.goBack();
    await expect(page).toHaveURL("/experience", { timeout: 10_000 });
    await activeTab("Experience");
    await page.goBack();
    await expect(page).toHaveURL("/", { timeout: 10_000 });
    await activeTab("Home");
    await expect(nav.getByText("Experience", { exact: true })).not.toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.goForward();
    await expect(page).toHaveURL("/experience", { timeout: 10_000 });
    await activeTab("Experience");
  });

  test("deep links land on the section", async ({ page }) => {
    await page.goto("/thinking");
    await expect(page.getByText("A point of view")).toBeInViewport({ timeout: 10_000 });
    await expect(
      page.getByRole("navigation", { name: "Sections" }).getByText("How I Think"),
    ).toHaveAttribute("aria-current", "page");
    // The planet name is a scene sprite, never DOM text in the panel.
    await expect(page.locator('[data-section="jupiter"]')).not.toContainText("Jupiter");
  });

  test("escape inside the contact form does not navigate away", async ({ page }) => {
    await page.goto("/contact");
    const message = page.locator('textarea[name="message"]');
    await expect(message).toBeVisible({ timeout: 10_000 });
    await message.fill("draft message that must survive", { timeout: 15_000 });
    await message.press("Escape");
    await expect(page).toHaveURL("/contact");
    await expect(message).toHaveValue("draft message that must survive");
  });

  test("switching tabs lands at the top of the target section", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/experience");
    const scroller = page.locator("[data-scroll-root]");
    await expect(page.locator('[data-section="saturn"]')).toBeInViewport();

    // Read partway into the section, then leave and come back.
    await scroller.evaluate((element) => element.scrollBy(0, 300));
    const nav = page.getByRole("navigation", { name: "Sections" });
    await nav.getByText("How I Think", { exact: true }).click();
    await expect(page).toHaveURL("/thinking");
    await nav.getByText("Experience", { exact: true }).click();
    await expect(page).toHaveURL("/experience");

    await expect
      .poll(async () => {
        const box = await page.locator('[data-section="saturn"]').boundingBox();
        return box ? Math.round(box.y) : null;
      })
      .toBe(0);
  });

  test("mobile viewport shows the tab nav", async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.route("**/api/github", (route) =>
      route.fulfill({ json: { repos: [], contributions: null } }),
    );
    await page.goto("/");
    await expect(
      page.getByRole("navigation", { name: "Sections" }).getByText("Contact", { exact: true }),
    ).toBeVisible();
    await context.close();
  });
});
