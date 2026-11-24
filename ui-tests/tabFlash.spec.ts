import { expect, type Page, test } from "@playwright/test";
import type { Pose } from "./helpers";
import { waitForArrival } from "./helpers";

/**
 * Tab switches must never show the destination page before the flight:
 * the outgoing content dissolves first, and the page underneath only jumps
 * to the target once it is invisible. A frame recorder samples, every
 * animation frame, the scroll container's opacity and which section fills
 * the viewport; any frame showing the target while the old page is still
 * fading out is the flash.
 */

const TABS = [
  ["Home", "earth"],
  ["Experience", "saturn"],
  ["How I Think", "jupiter"],
  ["GitHub", "mars"],
  ["Contact", "sun"],
] as const;

/** Eulerian circuit: all 20 ordered tab-to-tab pairs, once each. */
const CIRCUIT = [0, 1, 0, 2, 0, 3, 0, 4, 1, 2, 1, 3, 1, 4, 2, 3, 2, 4, 3, 4, 0];

type Frame = [opacity: number, section: string];
type Recorder = { trace: Frame[]; done: boolean };

/** Above this, text is perceptible on screen. */
const VISIBLE_OPACITY = 0.1;

/** SectionPanel jumps once the container is at or below this. */
const HIDDEN_OPACITY = 0.02;

/**
 * Clicks a tab and records frames until the page has jumped to `target`
 * behind hidden content (20s cap), then asserts the old page dissolved
 * first and the new one never showed before the jump.
 */
async function expectNoFlash(page: Page, label: string, target: string, name: string) {
  await page.evaluate(
    ([target, hidden]) => {
      const recorder: Recorder = { trace: [], done: false };
      (window as unknown as { __recorder: Recorder }).__recorder = recorder;
      const t0 = performance.now();
      const tick = () => {
        const root = document.querySelector("[data-scroll-root]");
        if (root) {
          const shown = [...root.querySelectorAll<HTMLElement>("[data-section]")].find(
            (section) => Math.abs(section.getBoundingClientRect().top) < 5,
          );
          const opacity = Number(getComputedStyle(root).opacity);
          const section = shown?.dataset.section ?? "-";
          recorder.trace.push([opacity, section]);
          if (section === target && opacity <= hidden) {
            recorder.done = true;
            return;
          }
        }
        if (performance.now() - t0 > 20_000) {
          recorder.done = true;
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    [target, HIDDEN_OPACITY] as const,
  );
  await page.getByRole("navigation", { name: "Sections" }).getByText(label, { exact: true }).click();
  const handle = await page.waitForFunction(
    () => {
      const recorder = (window as unknown as { __recorder: Recorder }).__recorder;
      return recorder.done ? recorder.trace : null;
    },
    undefined,
    { timeout: 30_000 },
  );
  const trace = (await handle.jsonValue()) as Frame[];
  expect(trace.findIndex(([opacity]) => opacity < 0.999), `${name}: fade-out`).toBeGreaterThan(-1);
  expect(Math.min(...trace.map(([opacity]) => opacity)), `${name}: hidden`).toBeLessThanOrEqual(
    HIDDEN_OPACITY,
  );
  expect(trace.at(-1)?.[1], `${name}: jump`).toBe(target);
  // A flash is the target on screen at a perceptible opacity; the bug
  // showed it at full opacity.
  const flashes = trace.filter(
    ([opacity, section]) => section === target && opacity > VISIBLE_OPACITY,
  ).length;
  expect(flashes, `${name}: flash frames`).toBe(0);
}

for (const [device, use] of [
  ["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ["desktop", { viewport: { width: 1280, height: 720 } }],
] as const) {
  test.describe(device, () => {
    test.use(use);

    test.beforeEach(async ({ page }) => {
      await page.route("**/api/github", (route) =>
        route.fulfill({ json: { repos: [], contributions: null } }),
      );
      await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
    });

    test("no tab switch shows the next page before the flight", async ({ page }) => {
      test.setTimeout(240_000);
      await page.goto("/");
      await page.waitForFunction(() => {
        const pose = (window as unknown as { __pose?: Pose }).__pose;
        return pose?.view === "earth" && !pose.moving;
      });
      for (let i = 1; i < CIRCUIT.length; i += 1) {
        const [label, id] = TABS[CIRCUIT[i]];
        const from = TABS[CIRCUIT[i - 1]][0];
        await expectNoFlash(page, label, id, `${from} → ${label}`);
        await waitForArrival(page, id);
        const top = await page
          .locator(`[data-section="${id}"]`)
          .evaluate((section) => Math.round(section.getBoundingClientRect().top));
        expect(Math.abs(top), `${label} lands at the top`).toBeLessThan(5);
      }
    });

    test("a full-motion tab switch fades the old page out before the jump", async ({ browser }) => {
      test.setTimeout(120_000);
      // Real motion exercises the 500ms container fade (reduced motion swaps
      // instantly), where the original flash lived.
      const context = await browser.newContext({ ...use, reducedMotion: "no-preference" });
      const page = await context.newPage();
      await page.route("**/api/github", (route) =>
        route.fulfill({ json: { repos: [], contributions: null } }),
      );
      await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
      await page.goto("/");
      await page.waitForFunction(
        () => {
          const pose = (window as unknown as { __pose?: Pose }).__pose;
          return pose?.view === "earth" && !pose.moving;
        },
        undefined,
        { timeout: 60_000 },
      );
      await expectNoFlash(page, "GitHub", "mars", "Home → GitHub");
      await context.close();
    });
  });
}
