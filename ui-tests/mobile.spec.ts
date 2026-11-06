import { expect, test } from "@playwright/test";
import type { Pose } from "./helpers";
import { wrappedDelta } from "./helpers";

/** Phone-sized behavior: reels-style snap scrolling and the wider camera. */

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page }) => {
  await page.route("**/api/github", (route) =>
    route.fulfill({ json: { repos: [], contributions: null } }),
  );
  await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
});

test("phone widths get mandatory section snapping", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-scroll-root]")).toBeVisible();
  const snapType = await page
    .locator("[data-scroll-root]")
    .evaluate((element) => getComputedStyle(element).scrollSnapType);
  expect(snapType).toContain("y");
  expect(snapType).toContain("mandatory");
});

test("a tab flight lands and holds still on a phone viewport", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.waitForFunction(() => {
    const pose = (window as unknown as { __pose?: Pose }).__pose;
    return pose && pose.view === "earth" && !pose.moving;
  });

  await page
    .getByRole("navigation", { name: "Sections" })
    .getByText("Experience", { exact: true })
    .click();
  const handle = await page.waitForFunction(
    () => {
      const pose = (window as unknown as { __pose?: Pose }).__pose;
      return pose && pose.view === "saturn" && !pose.moving ? { azimuth: pose.azimuth } : null;
    },
    undefined,
    { timeout: 30_000 },
  );
  const { azimuth: landed } = (await handle.jsonValue()) as { azimuth: number };
  await expect(page.getByText("Experience & education")).toBeInViewport({ timeout: 10_000 });

  await page.waitForTimeout(1_200);
  const later = await page.evaluate(
    () => (window as unknown as { __pose?: Pose }).__pose?.azimuth as number,
  );
  expect(Math.abs(wrappedDelta(landed, later)), "post-arrival drift on mobile").toBeLessThan(0.01);
});

test("desktop widths scroll free of snapping", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.route("**/api/github", (route) =>
    route.fulfill({ json: { repos: [], contributions: null } }),
  );
  await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
  await page.goto("/");
  await expect(page.locator("[data-scroll-root]")).toBeVisible();
  const snapType = await page
    .locator("[data-scroll-root]")
    .evaluate((element) => getComputedStyle(element).scrollSnapType);
  expect(snapType).toContain("none");
  await context.close();
});
