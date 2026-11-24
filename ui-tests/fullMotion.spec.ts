import { expect, type Page, test } from "@playwright/test";
import { expectContentShown, expectNoPivot, lightOf, waitForArrival } from "./helpers";

/**
 * The default desktop experience: full motion with bloom. 960px is still
 * desktop (bloom mounts above 768px) but cheaper to render in software GL.
 */
test.use({ reducedMotion: "no-preference", viewport: { width: 960, height: 600 } });

/** CI's software GL runs full-motion flights many times slower than real time. */
const FLIGHT_TIMEOUT = 90_000;

/** Min mean-luma gain from bloom. Measured: 3.8× with bloom, 0.97× without. */
const BLOOM_GAIN = 1.5;

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/github", (route) =>
    route.fulfill({ json: { repos: [], contributions: null } }),
  );
  await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
});

test.afterEach(() => {
  expect(errors.filter((message) => !message.includes("WebSocket")), "page errors").toEqual([]);
});

test("the overview sweep lands still with content, and Escape pulls back", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/system");
  await waitForArrival(page, "overview", FLIGHT_TIMEOUT);

  const nav = page.getByRole("navigation", { name: "Sections" });
  await nav.getByText("Experience", { exact: true }).click();
  await expect(page).toHaveURL("/experience");
  const landed = await waitForArrival(page, "saturn", FLIGHT_TIMEOUT);
  await expectNoPivot(page, landed, "System → Experience");
  await expectContentShown(page, "saturn");

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL("/system");
  await waitForArrival(page, "overview", FLIGHT_TIMEOUT);
  await expect(page.locator("[data-scroll-root]")).toHaveCount(0);
});

async function settledOverviewLight(page: Page) {
  await waitForArrival(page, "overview", FLIGHT_TIMEOUT);
  return lightOf(page, await page.screenshot());
}

test("bloom brightens the overview", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/system?det=1");
  const bloom = await settledOverviewLight(page);
  // The same ?det=1 frame under reduced motion, which drops bloom (and
  // star twinkle, which dims the full-motion frame).
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  const plain = await settledOverviewLight(page);
  expect(
    bloom.mean / plain.mean,
    `mean luma ${bloom.mean.toFixed(2)} with bloom vs ${plain.mean.toFixed(2)} without`,
  ).toBeGreaterThan(BLOOM_GAIN);
});
