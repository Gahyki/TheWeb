import { expect, type Page } from "@playwright/test";
import { test } from "./authStubs";
import type { Perf, Sun } from "./helpers";
import {
  around,
  clickSun,
  expectContentShown,
  expectNoPivot,
  expectWithinBand,
  lightOf,
  litIn,
  readSun,
  waitForArmedSun,
  waitForArrival,
  waitForSunPhase,
} from "./helpers";

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

/** Photon ring radius over the sun's radius (config.ts). */
const RING_OVER_SUN = 0.9 / 2.3;

/**
 * One rendered frame: the sun's phase, the infall, Earth's distance from
 * the hole in photon-ring radii (which cancels the dolly), whether the
 * sign-in is live, and FrameCap's vsyncs per render vs its active cadence.
 */
type Frame = [phase: Sun["phase"], infall: number, earth: number, live: boolean, vsyncs: number, active: number];

/** Records a Frame whenever the scene renders. */
async function recordFrames(page: Page) {
  await page.evaluate((ringOverSun) => {
    const frames: Frame[] = [];
    (window as unknown as { __frames: Frame[] }).__frames = frames;
    let last: Sun | undefined;
    const tick = () => {
      const sun = (window as unknown as { __sun?: Sun }).__sun;
      const perf = (window as unknown as { __perf?: Perf }).__perf;
      if (sun && perf && sun !== last) {
        last = sun;
        const ring = sun.r * ringOverSun;
        const form = document.querySelector<HTMLElement>('[role="dialog"]');
        frames.push([
          sun.phase,
          sun.infall,
          Math.hypot(sun.earth.x - sun.x, sun.earth.y - sun.y) / ring,
          Boolean(form && !form.inert),
          Math.round(perf.interval / perf.period),
          Math.max(1, Math.round(1000 / 90 / perf.period)),
        ]);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, RING_OVER_SUN);
  return () => page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames.splice(0));
}

test("the planets spiral into the black hole before the sign-in shows, and Escape returns them", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/system?det=1");
  await waitForArrival(page, "overview", FLIGHT_TIMEOUT);
  await page.waitForTimeout(500);
  const before = await waitForArmedSun(page);
  const sunClip = around(page, before.x, before.y, before.r * 1.3);
  const [sunLit] = await litIn(page, sunClip);

  const frames = await recordFrames(page);
  await clickSun(page);
  await waitForSunPhase(page, "collapsed", FLIGHT_TIMEOUT);
  await expect(page.getByRole("dialog", { name: "Sign in" }).getByLabel("Email")).toBeFocused();
  const opening = await frames();
  const formed = opening.findIndex(([phase]) => phase === "collapsed");
  expect(formed, "a collapsed frame").toBeGreaterThan(0);
  const fall = opening.slice(0, formed + 1);
  // Earth's orbit is 7.8 ring radii; it ends inside the ring.
  expect(fall[0][2], "Earth on its orbit").toBeGreaterThan(7);
  expect(fall[formed][2], "Earth inside the ring").toBeLessThan(1);
  // Measured frame to frame: up to 0.6% out from perspective once swallowed.
  for (let i = 1; i < fall.length; i += 1) {
    expect(fall[i][2], `Earth never backs out, frame ${i}`).toBeLessThan(fall[i - 1][2] * 1.03);
  }
  expect(fall.filter(([, , earth]) => earth > 1.5 && earth < 6).length, "frames mid-fall").toBeGreaterThanOrEqual(2);
  expect(fall[formed][1], "infall when formed").toBe(1);
  expect(opening.filter(([, infall, , live]) => live && infall < 1), "sign-in live mid-fall").toEqual([]);

  await page.keyboard.press("Escape");
  await waitForSunPhase(page, "idle", FLIGHT_TIMEOUT);
  await expect(page).toHaveURL("/system");
  await page.waitForTimeout(500);
  const after = await readSun(page);
  expect(Math.hypot(after.earth.x - before.earth.x, after.earth.y - before.earth.y), "Earth home, px").toBeLessThan(
    0.5,
  );
  expect(after.infall, "planets home").toBe(0);
  // Never vacuous: the opening has frames mid-fall.
  const falling = [...opening, ...(await frames())].filter(([, infall]) => infall > 0 && infall < 1);
  expect(
    falling.filter(([, , , , vsyncs, active]) => vsyncs !== active),
    "FrameCap at its active cadence mid-infall",
  ).toEqual([]);
  const [sunNow] = await litIn(page, sunClip);
  expectWithinBand(sunNow, sunLit, "sun");
});

test("Escape mid-fall, then Back mid-restore: the planets turn straight around, and the sign-in waits for them", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/system?det=1");
  await waitForArrival(page, "overview", FLIGHT_TIMEOUT);
  await page.waitForTimeout(500);
  await waitForArmedSun(page);

  const frames = await recordFrames(page);
  await page.evaluate(() => {
    let escapedAt = 0;
    const tick = () => {
      const sun = (window as unknown as { __sun?: Sun }).__sun;
      if (!escapedAt && sun?.phase === "collapsing" && sun.infall > 0.4 && sun.infall < 0.8) {
        escapedAt = sun.infall;
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      } else if (escapedAt && sun?.phase === "restoring" && sun.infall < escapedAt * 0.6) {
        (window as unknown as { __interrupts: number[] }).__interrupts = [escapedAt, sun.infall];
        history.back();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await clickSun(page);
  const interrupts = await page.waitForFunction(
    () => (window as unknown as { __interrupts?: number[] }).__interrupts,
    undefined,
    { timeout: FLIGHT_TIMEOUT },
  );
  const [, backAt] = (await interrupts.jsonValue()) as number[];
  expect(backAt, "Back mid-restore").toBeGreaterThan(0);
  await waitForSunPhase(page, "collapsed", FLIGHT_TIMEOUT);
  await expect(page.getByRole("dialog", { name: "Sign in" }).getByLabel("Email")).toBeFocused();

  const recorded = await frames();
  const reopen = recorded.slice(recorded.map(([phase]) => phase).lastIndexOf("restoring") + 1);
  const turn = reopen.reduce((lowest, [, infall], i) => (infall < reopen[lowest][1] ? i : lowest), 0);
  const swallowed = reopen.findIndex(([, infall]) => infall === 1);
  expect(swallowed, "swallowed after turning around").toBeGreaterThan(turn);
  // Every rendered frame advances the timeline, so only a delayed start holds the infall still.
  const rising = reopen.slice(turn, swallowed + 1);
  const held = rising.filter(([, infall], i) => i > 0 && infall <= rising[i - 1][1]);
  expect(held.length, "frames the infall held after Back").toBe(0);
  expect(recorded.filter(([, infall, , live]) => live && infall < 1), "sign-in live mid-fall").toEqual([]);

  await page.keyboard.press("Escape");
  await waitForSunPhase(page, "idle", FLIGHT_TIMEOUT);
  await expect(page).toHaveURL("/system");
  expect((await readSun(page)).infall, "planets home").toBe(0);
});
