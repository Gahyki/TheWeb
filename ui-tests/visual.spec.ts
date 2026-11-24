import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import type { Clip, Label, Pose } from "./helpers";
import { lightOf } from "./helpers";

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

/** Lit-pixel tolerance vs the baseline, over scene-only regions. Measured:
 * clean runs within 0.8%; hidden canvas −100%; Saturn without rings −10%
 * (focused) and −16% (sheet). */
const LIT_BAND = 0.03;
/** Luma (0–255) above which a pixel counts as lit. */
const LIT_LUMA = 16;

/**
 * SHOT's tolerance also passes an all-black canvas, so the frame's
 * lit-pixel count must stay near the baseline's too. `scene` excludes all
 * HTML text, which each machine's fonts draw differently.
 */
async function expectBaseline(page: Page, name: string, scene: Clip) {
  await expect(page).toHaveScreenshot(name, SHOT);
  const baseline = readFileSync(test.info().snapshotPath(name, { kind: "screenshot" }));
  const expected = await lightOf(page, baseline, LIT_LUMA, scene);
  const shot = await page.screenshot({ animations: "disabled" });
  const actual = await lightOf(page, shot, LIT_LUMA, scene);
  expect(
    Math.abs(actual.lit / expected.lit - 1),
    `${name}: ${actual.lit} lit pixels vs the baseline's ${expected.lit}`,
  ).toBeLessThan(LIT_BAND);
}

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
  // Below the nav.
  await expectBaseline(page, "system-overview.png", { x: 0, y: 64, width: 1280, height: 656 });
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
  // Saturn and its moons: below the nav, left of the panel, above the caption.
  await expectBaseline(page, "focused-saturn.png", { x: 0, y: 64, width: 730, height: 376 });
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
    // Between the top bar and the Earth caption.
    await expectBaseline(page, "phone-home.png", { x: 0, y: 60, width: 390, height: 235 });
  });

  test("the Experience sheet matches its baseline", async ({ page }) => {
    await page.goto("/experience?det=1");
    await waitSettled(page);
    await page.locator('[data-section="saturn"]').getByRole("button", { name: /all 4 entries/i }).click();
    await expect(page.getByRole("dialog", { name: "Experience" })).toBeVisible();
    await page.waitForTimeout(600);
    // Above the Saturn caption and the sheet.
    await expectBaseline(page, "phone-experience-sheet.png", { x: 0, y: 60, width: 390, height: 235 });
  });
});
