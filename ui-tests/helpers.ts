/** Shared shapes, math, and waits for the camera-pose test hooks. */

import { expect, type Page } from "@playwright/test";

/** Mirror of the `window.__pose` test hook written by CameraDirector. */
export type Pose = {
  azimuth: number;
  view: string;
  moving: boolean;
  /** Brightest moon-system reveal: 0 dark, 1 fully lit. */
  moons: number;
};

/** Mirror of the `window.__label` test hook written by PlanetCaption. */
export type Label = {
  opacity: number;
  settled: boolean;
  /** Focused planet's display name, or null when nothing is focused. */
  name: string | null;
  /** Planet-center minus label-midpoint, in CSS pixels; null unfocused. */
  screenDeltaX: number | null;
};

/** Mirror of the `window.__perf` probe written by PerfProbe. */
export type Perf = {
  /** Previous frame's draw calls (renderer info auto-resets per render). */
  calls: number;
  geometries: number;
  textures: number;
  /** Frame interval FrameCap chose for the current tick, in ms. */
  interval: number;
  /** Measured display vsync period (median), in ms. */
  period: number;
};

/** Mirror of the `window.__sun` test hook written by SunGate. */
export type Sun = {
  /** Projected sun center and radius, in CSS pixels. */
  x: number;
  y: number;
  r: number;
  /** Click/tap radius around (x, y), in CSS pixels. */
  hitR: number;
  /** A click on the sun would open the black hole right now. */
  armed: boolean;
  phase: "idle" | "collapsing" | "collapsed" | "restoring";
  /** How far the sun has collapsed: 0 whole, 1 gone. */
  progress: number;
  /** How far the planets have fallen in: 0 on their orbits, 1 swallowed. */
  infall: number;
  /** Earth's projected center, in CSS pixels: a sample planet for the infall. */
  earth: { x: number; y: number };
};

export async function readSun(page: Page): Promise<Sun> {
  const sun = await page.evaluate(() => (window as unknown as { __sun?: Sun }).__sun ?? null);
  expect(sun, "window.__sun").not.toBeNull();
  return sun as Sun;
}

/** Waits for the sun to reach `phase` with the camera at rest. */
export async function waitForSunPhase(page: Page, phase: Sun["phase"], timeout = 30_000) {
  await page.waitForFunction(
    (target) => {
      const sun = (window as unknown as { __sun?: Sun }).__sun;
      const pose = (window as unknown as { __pose?: Pose }).__pose;
      return sun?.phase === target && pose?.moving === false;
    },
    phase,
    { timeout },
  );
}

/** Waits until a click on the sun would open the black hole. */
export async function waitForArmedSun(page: Page): Promise<Sun> {
  await expect
    .poll(async () => (await readSun(page)).armed, {
      message: "sun never armed: is a reused dev server missing VITE_SUPABASE_URL?",
      timeout: 30_000,
    })
    .toBe(true);
  return readSun(page);
}

/** Clicks `dx` CSS pixels right of the armed sun's center. */
export async function clickSun(page: Page, dx = 0) {
  const sun = await waitForArmedSun(page);
  await page.mouse.click(sun.x + dx, sun.y);
}

/** Taps `dx` CSS pixels right of the armed sun's center. */
export async function tapSun(page: Page, dx = 0) {
  const sun = await waitForArmedSun(page);
  await page.touchscreen.tap(sun.x + dx, sun.y);
}

/** Shortest signed angular distance from one azimuth to another. */
export function wrappedDelta(from: number, to: number): number {
  const delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) {
    return delta - Math.PI * 2;
  }
  if (delta < -Math.PI) {
    return delta + Math.PI * 2;
  }
  return delta;
}

/**
 * Waits until the camera has landed on `view` (a body or "overview") and
 * resolves with the landing azimuth.
 */
export async function waitForArrival(page: Page, view: string, timeout = 30_000) {
  const handle = await page.waitForFunction(
    (target) => {
      const pose = (window as unknown as { __pose?: Pose }).__pose;
      return pose && pose.view === target && !pose.moving ? { azimuth: pose.azimuth } : null;
    },
    view,
    { timeout },
  );
  const { azimuth } = (await handle.jsonValue()) as { azimuth: number };
  return azimuth;
}

/** Max tolerated azimuth drift after landing (radians, ≈0.6°). */
export const MAX_DRIFT = 0.01;

export async function readAzimuth(page: Page): Promise<number> {
  const azimuth = await page.evaluate(
    () => (window as unknown as { __pose?: Pose }).__pose?.azimuth ?? null,
  );
  expect(azimuth).not.toBeNull();
  return azimuth as number;
}

/** Asserts the camera stays put through the post-arrival settle window. */
export async function expectNoPivot(page: Page, landed: number, label: string) {
  // Two samples bracket the first ~1.2s after landing — the window where
  // every historical pivot variant showed (glide time constant ~250ms).
  await page.waitForTimeout(400);
  const early = await readAzimuth(page);
  await page.waitForTimeout(800);
  const late = await readAzimuth(page);
  expect
    .soft(Math.abs(wrappedDelta(landed, early)), `early pivot after ${label}`)
    .toBeLessThan(MAX_DRIFT);
  expect(Math.abs(wrappedDelta(landed, late)), `late pivot after ${label}`).toBeLessThan(MAX_DRIFT);
}

/**
 * Waits for the flight to `id` to land, then asserts its section is really
 * shown: Playwright's visibility and viewport checks ignore opacity and
 * pointer-events.
 */
export async function expectContentShown(page: Page, id: string) {
  await waitForArrival(page, id);
  const root = page.locator("[data-scroll-root]");
  await expect(root).toHaveCSS("opacity", "1");
  await expect(root).toHaveCSS("pointer-events", "auto");
  const heading = page.locator(`[data-section="${id}"]`).locator("h1, h2").first();
  await expect
    .poll(() =>
      heading.evaluate((element) => {
        let opacity = 1;
        for (let node: Element | null = element; node; node = node.parentElement) {
          opacity *= Number(getComputedStyle(node).opacity);
        }
        return opacity;
      }),
    )
    .toBeGreaterThan(0.99);
  // Hit test: fails if anything covers the heading or swallows its clicks.
  await heading.click({ trial: true, timeout: 5_000 });
}

/** Image region, in pixels. */
export type Clip = { x: number; y: number; width: number; height: number };

/**
 * Decodes a PNG in the page and returns its lit-pixel count (luma above
 * `threshold`, 0–255) and mean luma, over `clip` or the whole image.
 */
export async function lightOf(
  page: Page,
  png: Buffer,
  threshold = 16,
  clip?: Clip,
): Promise<{ lit: number; mean: number }> {
  return page.evaluate(
    async ([base64, threshold, clip]) => {
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
      context.drawImage(bitmap, 0, 0);
      const area = clip ?? { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
      const { data } = context.getImageData(area.x, area.y, area.width, area.height);
      let lit = 0;
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        sum += luma;
        if (luma > threshold) {
          lit += 1;
        }
      }
      return { lit, mean: sum / (data.length / 4) };
    },
    [png.toString("base64"), threshold, clip ?? null] as const,
  );
}

/** Lit-pixel tolerance between two renders of the same det frame (see visual.spec). */
export const LIT_BAND = 0.03;
/** Luma (0–255) above which a pixel counts as lit. */
const LIT_LUMA = 16;

/** Square clip of half-size `half` around (x, y), kept inside the viewport. */
export function around(page: Page, x: number, y: number, half: number): Clip {
  const { width, height } = page.viewportSize() ?? { width: 1280, height: 720 };
  const left = Math.max(0, Math.round(x - half));
  const top = Math.max(0, Math.round(y - half));
  return {
    x: left,
    y: top,
    width: Math.min(width, Math.round(x + half)) - left,
    height: Math.min(height, Math.round(y + half)) - top,
  };
}

/** Lit-pixel counts of `clips`, all from one screenshot. */
export async function litIn(page: Page, ...clips: Clip[]): Promise<number[]> {
  const png = await page.screenshot();
  const counts: number[] = [];
  for (const clip of clips) {
    counts.push((await lightOf(page, png, LIT_LUMA, clip)).lit);
  }
  return counts;
}

export function expectWithinBand(actual: number, expected: number, label: string) {
  expect(Math.abs(actual / expected - 1), `${label}: ${actual} lit vs ${expected}`).toBeLessThan(
    LIT_BAND,
  );
}
