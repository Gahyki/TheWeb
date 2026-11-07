import { expect, test } from "@playwright/test";
import type { Label, Pose } from "./helpers";

/**
 * Visual regression: pixel baselines for the looks the functional tests
 * can't see — planet tints, sizes, ring weight, overview framing, sun
 * brightness. `?det=1` pins all scene randomness (orbital epoch, shader
 * phases, starfield) and freezes the shader clock, so renders are
 * reproducible. Regenerate baselines with:
 *   npx playwright test ui-tests/visual.spec.ts --update-snapshots
 * Baselines are per-machine-ish: if a new CI runner image renders
 * differently, regenerate from the uploaded playwright-report artifact.
 */

test.beforeEach(async ({ page }) => {
  await page.route("**/api/github", (route) =>
    route.fulfill({ json: { repos: [], contributions: null } }),
  );
  await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
});

const SHOT = {
  // Generous per-pixel threshold: antialiasing of 1px additive lines moves
  // with tiny timing offsets; real regressions (tint, size, framing) move
  // whole regions, not scattered single pixels.
  maxDiffPixelRatio: 0.02,
  threshold: 0.3,
} as const;

/** Wait on state, not time: fixed sleeps capture whatever frame a given
 * machine's render speed happens to reach — state waits don't. */
async function waitSettled(page: import("@playwright/test").Page) {
  await page.waitForFunction(
    () => {
      const pose = (window as unknown as { __pose?: Pose }).__pose;
      return pose !== undefined && !pose.moving;
    },
    undefined,
    { timeout: 30_000 },
  );
}

test("the system overview matches its baseline", async ({ page }) => {
  await page.goto("/system?det=1");
  await waitSettled(page);
  // Short tail: lets the radius glide finish its last sub-pixel fraction.
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot("system-overview.png", SHOT);
});

test("a focused section matches its baseline", async ({ page }) => {
  // Saturn: the one view that covers rings, moons, tint, and the receded
  // sun in a single frame.
  await page.goto("/experience?det=1");
  await waitSettled(page);
  // The label is the last element to arrive (0.45s delay + fade).
  await page.waitForFunction(
    () => ((window as unknown as { __label?: Label }).__label?.opacity ?? 0) > 0.84,
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(500);
  await expect(page).toHaveScreenshot("focused-saturn.png", SHOT);
});

test.describe("phone reels", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the Home reel matches its baseline", async ({ page }) => {
    await page.goto("/?det=1");
    await waitSettled(page);
    await page.waitForFunction(
      () => ((window as unknown as { __label?: Label }).__label?.opacity ?? 0) > 0.84,
      undefined,
      { timeout: 30_000 },
    );
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("phone-home.png", SHOT);
  });

  test("the Experience sheet matches its baseline", async ({ page }) => {
    await page.goto("/experience?det=1");
    await waitSettled(page);
    await page.locator('[data-section="saturn"]').getByRole("button", { name: /all 4 entries/i }).click();
    await expect(page.getByRole("dialog", { name: "Experience" })).toBeVisible();
    await page.waitForTimeout(600);
    await expect(page).toHaveScreenshot("phone-experience-sheet.png", SHOT);
  });
});
