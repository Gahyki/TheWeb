import { expect, test } from "@playwright/test";
import type { Perf, Pose } from "./helpers";

/**
 * Performance validations built on deterministic invariants — frame-pacing
 * decisions, draw-call budgets, and resource counts — which hold on any
 * machine, unlike wall-clock benchmarks that would flake on
 * software-rendered CI runners.
 *
 * Budgets come from measured values (overview 44 / focused 37–49 draw
 * calls, 69 geometries + 5 textures after a full tour) plus headroom; a
 * breach means something structural regressed (culling broken, a
 * component leaking geometry, runaway draw calls), not that a runner was
 * slow.
 */

const readPerf = () => (window as unknown as { __perf?: Perf }).__perf;

test.beforeEach(async ({ page }) => {
  await page.route("**/api/github", (route) =>
    route.fulfill({ json: { repos: [], contributions: null } }),
  );
  await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
});

async function waitForView(page: import("@playwright/test").Page, view: string) {
  await page.waitForFunction(
    (target) => {
      const pose = (window as unknown as { __pose?: Pose }).__pose;
      return pose !== undefined && pose.view === target && !pose.moving;
    },
    view,
    { timeout: 30_000 },
  );
}

/** FrameCap's contract: a whole number of measured vsyncs per render —
 * nearest divisor to 90fps in motion, at or below 45fps when settled. */
function expectedVsyncs(perf: Perf, active: boolean): number {
  return active
    ? Math.max(1, Math.round(1000 / 90 / perf.period))
    : Math.max(1, Math.ceil(1000 / 45 / perf.period - 0.05));
}

function expectWholeVsyncs(perf: Perf, active: boolean, label: string) {
  expect(perf.period, `${label}: measured vsync period`).toBeGreaterThan(2);
  const vsyncs = perf.interval / perf.period;
  expect(Math.abs(vsyncs - Math.round(vsyncs)), `${label}: whole vsyncs`).toBeLessThan(1e-6);
  expect(Math.round(vsyncs), `${label}: vsyncs per render`).toBe(expectedVsyncs(perf, active));
}

test("the render loop paces on whole vsyncs and slows down when settled", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await waitForView(page, "earth");
  // Settled: idle pacing (period needs a moment to converge).
  await expect
    .poll(
      async () => {
        const perf = (await page.evaluate(readPerf)) as Perf;
        return Math.round(perf.interval / perf.period) === expectedVsyncs(perf, false);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  const idle = (await page.evaluate(readPerf)) as Perf;
  expectWholeVsyncs(idle, false, "settled");

  // In flight: active pacing, never slower than idle.
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByText("Experience", { exact: true })
    .click();
  const handle = await page.waitForFunction(
    () => {
      const pose = (window as unknown as { __pose?: Pose }).__pose;
      const perf = (window as unknown as { __perf?: Perf }).__perf;
      return pose?.moving === true && perf !== undefined ? perf : null;
    },
    undefined,
    { timeout: 20_000 },
  );
  const flight = (await handle.jsonValue()) as Perf;
  expectWholeVsyncs(flight, true, "in flight");
  // Compare vsync counts, not milliseconds: the median period drifts by
  // fractions of a millisecond between the two samples.
  expect(
    Math.round(flight.interval / flight.period),
    "flight renders at least as often as idle",
  ).toBeLessThanOrEqual(Math.round(idle.interval / idle.period));

  // Settled again: back to idle pacing.
  await waitForView(page, "saturn");
  await expect
    .poll(
      async () => {
        const perf = (await page.evaluate(readPerf)) as Perf;
        return Math.round(perf.interval / perf.period) === expectedVsyncs(perf, false);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
});

test("every view stays inside the draw-call budget", async ({ page }) => {
  test.setTimeout(60_000);
  // Deterministic epoch so the planet arrangement (and thus what is in
  // frame) is identical every run.
  for (const [path, view] of [
    ["/system?det=1", "overview"],
    ["/?det=1", "earth"],
    ["/experience?det=1", "saturn"],
  ] as const) {
    await page.goto(path);
    await waitForView(page, view);
    await page.waitForTimeout(500);
    const perf = (await page.evaluate(readPerf)) as Perf;
    // Floor guards a broken probe or blank scene; ceiling guards runaway
    // draw calls and a disabled dissolve-culling path.
    expect(perf.calls, `draw calls at ${path}`).toBeGreaterThan(10);
    expect(perf.calls, `draw calls at ${path}`).toBeLessThan(70);
  }
});

test("repeat visits leak no GPU resources, JS heap, DOM nodes, or listeners", async ({
  page,
}) => {
  test.setTimeout(180_000);
  // CDP gives the renderer-process truth: heap after a forced GC, live DOM
  // node count, and attached event listeners — all deterministic at a
  // given app state, unlike wall-clock CPU numbers.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("HeapProfiler.enable");
  const snapshot = async () => {
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const metric = (name: string) => metrics.find((m) => m.name === name)?.value ?? Number.NaN;
    return {
      heapBytes: metric("JSHeapUsedSize"),
      nodes: metric("Nodes"),
      listeners: metric("JSEventListeners"),
    };
  };

  await page.goto("/");
  await waitForView(page, "earth");

  const tour = async () => {
    for (const [label, view] of [
      ["Experience", "saturn"],
      ["How I Think", "jupiter"],
      ["GitHub", "mars"],
      ["Contact", "sun"],
      ["Home", "earth"],
    ] as const) {
      await page
        .getByRole("navigation", { name: "Sections" })
        .getByText(label, { exact: true })
        .click();
      await waitForView(page, view);
    }
    await page.keyboard.press("Escape");
    await waitForView(page, "overview");
    await page.waitForTimeout(500);
    return (await page.evaluate(readPerf)) as Perf;
  };

  // Everything a tour can lazily create exists after the first pass; a
  // second identical pass growing any of these counts is a leak.
  const first = await tour();
  const firstProcess = await snapshot();
  const second = await tour();
  const secondProcess = await snapshot();

  expect(second.geometries, "geometries after second tour").toBeLessThanOrEqual(first.geometries);
  expect(second.textures, "textures after second tour").toBeLessThanOrEqual(first.textures);
  expect(first.geometries, "absolute geometry count").toBeLessThan(100);

  // Post-GC heap may still wobble a little run to run; two megabytes of
  // slack stays far below any real per-tour leak compounding over visits.
  expect(secondProcess.heapBytes, "JS heap after second tour").toBeLessThanOrEqual(
    firstProcess.heapBytes + 2 * 1024 * 1024,
  );
  expect(secondProcess.nodes, "DOM nodes after second tour").toBeLessThanOrEqual(
    firstProcess.nodes,
  );
  expect(secondProcess.listeners, "event listeners after second tour").toBeLessThanOrEqual(
    firstProcess.listeners,
  );
});

test("the canvas backing store respects the pixel budget", async ({ browser }) => {
  test.setTimeout(60_000);
  // 4K @150% (trimmed) and a Retina Mac (untouched), as real browser
  // viewports: the canvas's own width×height is the backing store.
  for (const [width, height, scale, maxPixels, minPixels] of [
    [2560, 1440, 1.5, 6_000_000 * 1.01, 5_000_000],
    [1512, 982, 2, 1512 * 982 * 4 * 1.01, 1512 * 982 * 4 * 0.99],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.route("**/api/github", (route) =>
      route.fulfill({ json: { repos: [], contributions: null } }),
    );
    await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
    await page.goto("/?det=1");
    await waitForView(page, "earth");
    const pixels = await page
      .locator("canvas")
      .evaluate((canvas: HTMLCanvasElement) => canvas.width * canvas.height);
    expect(pixels, `${width}x${height}@${scale} backing store`).toBeLessThanOrEqual(maxPixels);
    expect(pixels, `${width}x${height}@${scale} backing store`).toBeGreaterThanOrEqual(minPixels);
    await context.close();
  }
});
