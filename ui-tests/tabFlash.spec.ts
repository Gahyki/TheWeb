import { expect, test } from "@playwright/test";
import type { Pose } from "./helpers";

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

/** Above this, text is perceptible on screen. */
const VISIBLE_OPACITY = 0.1;

async function flashFrames(page: import("@playwright/test").Page, label: string, target: string) {
  await page.evaluate(() => {
    const trace: Frame[] = [];
    (window as unknown as { __trace: Frame[] }).__trace = trace;
    const t0 = performance.now();
    const tick = () => {
      const root = document.querySelector("[data-scroll-root]");
      if (root) {
        const shown = [...root.querySelectorAll<HTMLElement>("[data-section]")].find(
          (section) => Math.abs(section.getBoundingClientRect().top) < 5,
        );
        trace.push([Number(getComputedStyle(root).opacity), shown?.dataset.section ?? "-"]);
      }
      if (performance.now() - t0 < 1500) {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
  await page.getByRole("navigation", { name: "Sections" }).getByText(label, { exact: true }).click();
  await page.waitForFunction(
    (id) => {
      const pose = (window as unknown as { __pose?: Pose }).__pose;
      return pose?.view === id && !pose.moving;
    },
    target,
    // Full-motion flights render slowly on software-GL runners.
    { timeout: 90_000 },
  );
  const trace = await page.evaluate(() => (window as unknown as { __trace: Frame[] }).__trace);
  // The fade-out runs from the first dimmed frame to the lowest opacity
  // reached. Short flights reverse it before full transparency (content
  // returns), so the turnaround — not a fixed threshold — ends it.
  const start = trace.findIndex(([opacity]) => opacity < 0.999);
  if (start === -1) {
    return 0;
  }
  let lowest = start;
  for (let i = start; i < trace.length; i += 1) {
    if (trace[i][0] <= trace[lowest][0]) {
      lowest = i;
    } else if (trace[i][0] > trace[lowest][0] + 0.05) {
      break;
    }
  }
  // A flash is the target on screen at a perceptible opacity before the
  // turnaround; the bug showed it at full opacity.
  return trace
    .slice(start, lowest + 1)
    .filter(([opacity, section]) => section === target && opacity > VISIBLE_OPACITY).length;
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
        expect(await flashFrames(page, label, id), `${from} → ${label} flash frames`).toBe(0);
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
      expect(await flashFrames(page, "GitHub", "mars"), "Home → GitHub flash frames").toBe(0);
      await context.close();
    });
  });
}
