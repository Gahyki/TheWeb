import { expect, test } from "@playwright/test";
import type { Pose } from "./helpers";
import {
  expectNoPivot,
  MAX_DRIFT,
  readAzimuth,
  waitForArrival,
  wrappedDelta,
} from "./helpers";

/**
 * Sun-pivot regression suite: once a flight lands on a section, the camera
 * azimuth must hold perfectly still — any drift right after arrival reads
 * as the sun pivoting into place behind the planet.
 *
 * Runs reduced-motion like the rest of the suite (software-rendered frames
 * plus GSAP lag smoothing stretch full-motion flights ~15× past every
 * timeout). The invariant is motion-independent: any post-arrival
 * re-centering glide — the pivot's mechanism — drifts the azimuth and
 * fails the assertion regardless of how the flight itself was animated.
 */

const TABS = ["Home", "Experience", "How I Think", "GitHub", "Contact"] as const;
const VIEWS = ["earth", "saturn", "jupiter", "mars", "sun"] as const;

/**
 * Eulerian circuit over the five sections: every ordered tab-to-tab
 * combination (all 20) appears exactly once, in one page session.
 */
const CIRCUIT = [0, 1, 0, 2, 0, 3, 0, 4, 1, 2, 1, 3, 1, 4, 2, 3, 2, 4, 3, 4, 0];

test.beforeEach(async ({ page }) => {
  await page.route("**/api/github", (route) =>
    route.fulfill({ json: { repos: [], contributions: null } }),
  );
    await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
});

test("every tab-to-tab flight lands without a sun pivot", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Sections" });
  await waitForArrival(page, VIEWS[CIRCUIT[0]]);

  for (let i = 1; i < CIRCUIT.length; i += 1) {
    const target = CIRCUIT[i];
    const label = `${TABS[CIRCUIT[i - 1]]} → ${TABS[target]}`;
    await nav.getByText(TABS[target], { exact: true }).click();
    const landed = await waitForArrival(page, VIEWS[target]);
    await expectNoPivot(page, landed, label);
  }
});

test("every overview-to-tab flight lands without a sun pivot", async ({ page }) => {
  test.setTimeout(120_000);
  for (let i = 0; i < TABS.length; i += 1) {
    await page.goto("/system");
    await page.waitForFunction(() => {
      const pose = (window as unknown as { __pose?: Pose }).__pose;
      return pose && pose.view === "overview" && !pose.moving;
    });
    await page
      .getByRole("navigation", { name: "Sections" })
      .getByText(TABS[i], { exact: true })
      .click();
    const landed = await waitForArrival(page, VIEWS[i]);
    await expectNoPivot(page, landed, `System → ${TABS[i]}`);
  }
});

test("a scroll-driven settle comes to rest without residual drift", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await waitForArrival(page, "earth");

  // Scroll like a visitor until the next section takes the view…
  for (let i = 0; i < 120; i += 1) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(80);
    const view = await page.evaluate(
      () => (window as unknown as { __pose?: Pose }).__pose?.view,
    );
    if (view === "saturn") {
      break;
    }
  }
  // …then land exactly on the section top (what a finished scroll or a
  // mobile snap does), which is the scroll path's settle trigger.
  await page.evaluate(() => {
    const root = document.querySelector("[data-scroll-root]") as HTMLElement;
    const section = document.querySelector('[data-section="saturn"]') as HTMLElement;
    root.scrollTop = section.offsetTop;
  });

  // Scroll settles keep an intentional glide. It advances per rendered
  // frame with a clamped step, so on a loaded machine it needs more wall
  // time — wait for the camera to actually come to rest (two reads 300ms
  // apart agree) instead of a fixed window. A camera that never rests
  // fails via the timeout; one that rests and then pivots fails below.
  await expect
    .poll(
      async () => {
        const first = await readAzimuth(page);
        await page.waitForTimeout(300);
        return Math.abs(wrappedDelta(first, await readAzimuth(page)));
      },
      { timeout: 15_000, intervals: [0] },
    )
    .toBeLessThan(0.001);
  const settled = await readAzimuth(page);
  await page.waitForTimeout(1_200);
  const later = await readAzimuth(page);
  expect(Math.abs(wrappedDelta(settled, later)), "drift after scroll settle").toBeLessThan(
    MAX_DRIFT,
  );
});
