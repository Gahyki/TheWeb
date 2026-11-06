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
});
