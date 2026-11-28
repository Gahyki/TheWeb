import { expect, test } from "@playwright/test";

test.describe("degraded mode without WebGL", () => {
  test.beforeEach(async ({ context, page }) => {
    await page.route("**/api/github", (route) =>
      route.fulfill({ json: { repos: [], contributions: null } }),
    );
    await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
    await context.addInitScript(() => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (contextId: string, options?: unknown) {
        if (/^(experimental-)?webgl2?$/.test(contextId)) {
          return null;
        }
        return originalGetContext.call(this, contextId, options);
      } as typeof HTMLCanvasElement.prototype.getContext;
    });
  });

  test("scene failure is contained and overlay navigation still works", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/");
    await expect(
      page.getByText("This browser can’t render the 3D system — the sections above still work."),
    ).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);

    const nav = page.getByRole("navigation", { name: "Sections" });
    await nav.getByText("Experience", { exact: true }).click();
    await expect(page).toHaveURL("/experience");
    await expect(page.getByText("Experience & education")).toBeInViewport({ timeout: 10_000 });

    await page.keyboard.press("Escape");
    await expect(page).toHaveURL("/system");

    expect(errors.filter((message) => !message.includes("WebSocket"))).toEqual([]);
  });

  test("the black hole's URL lands on the plain overview, without history or supabase-js", async ({
    page,
  }) => {
    await page.goto("/system");
    const entries = await page.evaluate(() => history.length);
    const signIn: string[] = [];
    page.on("request", (request) => {
      const { hostname, pathname } = new URL(request.url());
      // Dev-server module paths: the lazy dialog, the client, the library.
      if (hostname.endsWith(".supabase.co") || /LoginDialog|supabase/.test(pathname)) {
        signIn.push(`${hostname}${pathname}`);
      }
    });
    await page.goto("/void");
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page).toHaveURL("/system");
    await expect(page).toHaveTitle("Solar System — Jason Kim");
    // One entry for the load itself; the correction replaces it.
    expect(await page.evaluate(() => history.length)).toBe(entries + 1);
    // Shown only while a black hole or section is open.
    await expect(page.getByRole("button", { name: /to system/ })).toHaveCSS("pointer-events", "none");
    // No scene, no sign-in: nothing of it loads.
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(signIn).toEqual([]);
  });

  test("Enter activates the focused tab, not the unseen overview highlight", async ({ page }) => {
    await page.goto("/system");
    await expect(page.locator("canvas")).toHaveCount(0);
    const nav = page.getByRole("navigation", { name: "Sections" });
    await nav.getByText("Experience", { exact: true }).click();
    await expect(page).toHaveURL("/experience");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL("/system");
    await expect(nav.getByText("Experience", { exact: true })).toBeFocused();

    // Without a scene the highlight is invisible, so Enter must not follow it.
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press("ArrowRight");
    }
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/experience");
  });
});
