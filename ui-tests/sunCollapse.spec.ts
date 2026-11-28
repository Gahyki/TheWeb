import { expect, type Page } from "@playwright/test";
import { test } from "./authStubs";
import type { Clip, Label, Pose, Sun } from "./helpers";
import {
  around,
  clickSun,
  expectContentShown,
  expectNoPivot,
  expectWithinBand,
  litIn,
  readSun,
  tapSun,
  waitForArrival,
  waitForArmedSun,
  waitForSunPhase,
} from "./helpers";

/**
 * The hidden entrance: a click or tap on the overview's sun collapses it
 * into a black hole at /void, and every exit re-forms it. `?det=1` frames
 * are reproducible, so lit-pixel counts compare within one page.
 */

/** Photon ring radius over the sun's radius (Singularity.tsx, config.ts). */
const RING_OVER_SUN = 0.9 / 2.3;

/**
 * The desktop black hole in half viewport heights, which fix its framing
 * (the field of view is vertical). Measured at 1280x720: 162.1px left of
 * center, sun radius 161.4px.
 */
const DESKTOP_HOLE = { left: 162.1 / 360, r: 161.4 / 360 };

/**
 * Waits for the compose glide to settle (it advances per rendered frame,
 * so slow renderers need longer), then expects the desktop framing on an
 * 844x390 screen.
 */
async function expectSideFraming(page: Page): Promise<Sun> {
  await expect
    .poll(async () => Math.abs((422 - (await readSun(page)).x) / 195 / DESKTOP_HOLE.left - 1), {
      message: "left of center",
      timeout: 15_000,
    })
    .toBeLessThan(0.01);
  const hole = await readSun(page);
  expect(Math.abs((422 - hole.x) / 195 / DESKTOP_HOLE.left - 1), "left of center").toBeLessThan(0.01);
  expect(Math.abs(hole.y - 195), "mid-height").toBeLessThan(2);
  expect(Math.abs(hole.r / 195 / DESKTOP_HOLE.r - 1), "size").toBeLessThan(0.01);
  return hole;
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/github", (route) =>
    route.fulfill({ json: { repos: [], contributions: null } }),
  );
  await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
});

function tab(page: Page, label: string) {
  return page.getByRole("navigation", { name: "Sections" }).getByText(label, { exact: true });
}

/** The URL's path; det pages keep their query on load. */
async function expectPath(page: Page, path: string) {
  await expect.poll(() => new URL(page.url()).pathname).toBe(path);
}

async function openOverview(page: Page, path = "/system?det=1") {
  await page.goto(path);
  await waitForArrival(page, "overview");
  // Lets the settle's radius glide finish its last sub-pixel fraction.
  await page.waitForTimeout(500);
}

/** The collapsed state: URL, title, no active tab, and a dark horizon inside a lit ring. */
async function expectBlackHole(page: Page) {
  await waitForSunPhase(page, "collapsed");
  await expectPath(page, "/void");
  await expect(page).toHaveTitle("Sign in — Jason Kim");
  await expect(page.locator('[aria-current="page"]')).toHaveCount(0);
  const sun = await readSun(page);
  expect(sun.progress).toBe(1);
  expect(sun.infall, "planets swallowed").toBe(1);
  expect(sun.armed).toBe(false);
  const ring = sun.r * RING_OVER_SUN;
  const [inside, withRing] = await litIn(
    page,
    around(page, sun.x, sun.y, ring * 0.6),
    around(page, sun.x, sun.y, ring * 1.15),
  );
  // The horizon hides every star and line behind it.
  expect(inside, "inside the horizon").toBe(0);
  expect(withRing, "photon ring").toBeGreaterThan(200);
  return sun;
}

/**
 * Records the sun's screen position, and whether the camera moves, on every
 * animation frame: from now, or from the next page load.
 */
async function recordSunPath(page: Page, { fromLoad = false } = {}) {
  const install = () => {
    const frames: [number, number, boolean][] = [];
    (window as unknown as { __sunPath: typeof frames }).__sunPath = frames;
    const tick = () => {
      const sun = (window as unknown as { __sun?: Sun }).__sun;
      const pose = (window as unknown as { __pose?: Pose }).__pose;
      if (sun && pose) {
        frames.push([sun.x, sun.y, pose.moving]);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  await (fromLoad ? page.addInitScript(install) : page.evaluate(install));
  /**
   * Expects each flight to hand over to rest without a jump: the first frame
   * at rest moves the sun no more than twice the flight's last frames did.
   * Turning the offset at rest jumps ~150px; a loaded runner's flight frames
   * move up to ~30px.
   */
  return async (label: string) => {
    const frames = await page.evaluate(() => {
      const path = (window as unknown as { __sunPath: [number, number, boolean][] }).__sunPath;
      return path.splice(0);
    });
    const step = (i: number) =>
      Math.hypot(frames[i][0] - frames[i - 1][0], frames[i][1] - frames[i - 1][1]);
    const landings = frames.flatMap(([, , moving], i) => (i > 0 && frames[i - 1][2] && !moving ? [i] : []));
    expect(landings.length, `${label}: a landing was recorded`).toBeGreaterThan(0);
    for (const i of landings) {
      let flight = 0;
      for (let j = Math.max(1, i - 5); j < i; j += 1) {
        flight = Math.max(flight, step(j));
      }
      expect(step(i), `${label}: landing step vs the flight's ${flight.toFixed(1)}px`).toBeLessThan(
        Math.max(10, 2 * flight),
      );
    }
    return frames;
  };
}

/** One frame: the sun's phase and progress, and the sign-in's state. */
type Frame = [phase: Sun["phase"], progress: number, form: "none" | "inert" | "live"];

/** Records a Frame on every animation frame. */
async function recordSun(page: Page) {
  await page.evaluate(() => {
    const frames: Frame[] = [];
    (window as unknown as { __sunFrames: typeof frames }).__sunFrames = frames;
    const tick = () => {
      const sun = (window as unknown as { __sun?: Sun }).__sun;
      if (sun) {
        const form = document.querySelector<HTMLElement>('[role="dialog"]');
        frames.push([sun.phase, sun.progress, form ? (form.inert ? "inert" : "live") : "none"]);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return async () => page.evaluate(() => (window as unknown as { __sunFrames: Frame[] }).__sunFrames);
}

test("the overview sun is armed, centered, and shows a pointer on hover", async ({ page }) => {
  await openOverview(page);
  const sun = await waitForArmedSun(page);
  expect(Math.abs(sun.x - 640), "x").toBeLessThan(2);
  expect(Math.abs(sun.y - 360), "y").toBeLessThan(2);
  expect(sun.hitR).toBeGreaterThanOrEqual(22);
  expect(sun.hitR).toBeGreaterThan(sun.r);
  expect(sun.phase).toBe("idle");

  const canvas = page.locator("canvas");
  const cursor = () => canvas.evaluate((element) => getComputedStyle(element).cursor);
  await page.mouse.move(sun.x + sun.hitR - 3, sun.y);
  await expect.poll(cursor).toBe("pointer");
  await page.mouse.move(sun.x + sun.hitR + 30, sun.y);
  await expect.poll(cursor).toBe("auto");
});

test("clicking the sun collapses it into the black hole at /void", async ({ page }) => {
  await openOverview(page);
  const sun = await waitForArmedSun(page);
  const entries = await page.evaluate(() => history.length);
  // A double click lands open, with one new history entry.
  await page.mouse.dblclick(sun.x, sun.y);
  const hole = await expectBlackHole(page);
  expect(await page.evaluate(() => history.length)).toBe(entries + 1);
  // Composed left of center, like a focused section, leaving the panel slot free.
  expect(hole.x).toBeLessThan(1280 * 0.45);
  await expect(page.getByRole("button", { name: /to system/ })).toHaveCSS("pointer-events", "auto");

  // Arrows and Enter stay native while it is open, outside the form too: nothing flies.
  await expect(page.getByRole("dialog", { name: "Sign in" }).getByLabel("Email")).toBeFocused();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  await expectPath(page, "/void");
  expect((await readSun(page)).phase).toBe("collapsed");
});

test("a click beside the sun does nothing", async ({ page }) => {
  await openOverview(page);
  const sun = await waitForArmedSun(page);
  await page.mouse.click(sun.x + sun.hitR + 30, sun.y);
  await page.waitForTimeout(800);
  await expectPath(page, "/system");
  expect((await readSun(page)).phase).toBe("idle");
});

test("the sun is inert outside the overview", async ({ page }) => {
  await page.goto("/experience?det=1");
  await waitForArrival(page, "saturn");
  const sun = await readSun(page);
  expect(sun.armed).toBe(false);
  await page.mouse.click(sun.x, sun.y);
  await page.waitForTimeout(800);
  await expectPath(page, "/experience");
  expect((await readSun(page)).phase).toBe("idle");
});

test("Escape, the pill, the wordmark, and Back each re-form the sun; Forward reopens it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openOverview(page);
  const before = await waitForArmedSun(page);
  const sunClip = around(page, before.x, before.y, before.r * 1.3);
  const scene: Clip = { x: 0, y: 64, width: 1280, height: 656 };
  const [sunLit, sceneLit] = await litIn(page, sunClip, scene);
  expect(sunLit, "lit sun").toBeGreaterThan(500);

  const exits: [string, () => Promise<void>][] = [
    ["Escape", () => page.keyboard.press("Escape")],
    ["the pill", () => page.getByRole("button", { name: /to system/ }).click()],
    ["the wordmark", () => page.getByRole("button", { name: "gahyki" }).click()],
    [
      "Back",
      async () => {
        await page.goBack();
      },
    ],
  ];
  for (const [label, exit] of exits) {
    await clickSun(page);
    await expectBlackHole(page);
    await exit();
    await waitForSunPhase(page, "idle");
    await expect(page).toHaveURL("/system");
    await expect(page).toHaveTitle("Solar System — Jason Kim");
    await page.waitForTimeout(500);
    const after = await readSun(page);
    expect(after.armed, `${label}: armed again`).toBe(true);
    expect(after.infall, `${label}: planets home`).toBe(0);
    expect(Math.abs(after.r - before.r), `${label}: sun size`).toBeLessThan(0.5);
    const [sunNow, sceneNow] = await litIn(page, sunClip, scene);
    expectWithinBand(sunNow, sunLit, `${label}: sun`);
    expectWithinBand(sceneNow, sceneLit, `${label}: scene`);
  }

  await page.goForward();
  await expectBlackHole(page);
});

test("/void loads straight into the black hole", async ({ page }) => {
  await page.goto("/void?det=1");
  await expectBlackHole(page);
  await page.keyboard.press("Escape");
  await waitForSunPhase(page, "idle");
  await expect(page).toHaveURL("/system");
  await waitForArmedSun(page);
});

test("the form stays inert until the hole forms, and Escape mid-collapse re-forms the sun", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await openOverview(page);
  const before = await waitForArmedSun(page);
  const sunClip = around(page, before.x, before.y, before.r * 1.3);
  const [sunLit] = await litIn(page, sunClip);
  const email = page.getByRole("dialog", { name: "Sign in" }).getByLabel("Email");

  // A first open loads the form, so the next one mounts it while the sun collapses.
  await clickSun(page);
  await waitForSunPhase(page, "collapsed");
  await page.keyboard.press("Escape");
  await waitForSunPhase(page, "idle");
  const frames = await recordSun(page);
  await clickSun(page);
  await waitForSunPhase(page, "collapsed");
  await expect(email).toBeFocused();
  const recorded = await frames();
  const formed = recorded.findIndex(([phase]) => phase === "collapsed");
  // __sun is written on rendered frames only, so it can lag a frame behind.
  const collapsing = recorded.slice(0, formed - 1);
  expect(collapsing.filter(([, , form]) => form === "live"), "live before formed").toEqual([]);
  const inert = collapsing.filter(([, , form]) => form === "inert").length;
  expect(inert, "mounted while collapsing").toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await waitForSunPhase(page, "idle");

  // Escape in the first frame the sun shows collapsing.
  await page.evaluate(() => {
    const tick = () => {
      const sun = (window as unknown as { __sun?: Sun }).__sun;
      if (sun?.phase === "collapsing" && sun.progress > 0) {
        (window as unknown as { __closedAt: number }).__closedAt = sun.progress;
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      } else {
        requestAnimationFrame(tick);
      }
    };
    requestAnimationFrame(tick);
  });
  await clickSun(page);
  const closedAt = await page.waitForFunction(
    () => (window as unknown as { __closedAt?: number }).__closedAt,
  );
  expect(await closedAt.jsonValue(), "closed mid-collapse").toBeLessThan(1);
  await expectPath(page, "/system");
  await waitForSunPhase(page, "idle");
  await page.waitForTimeout(500);
  const after = await readSun(page);
  expect(after.armed, "armed again").toBe(true);
  expect(after.infall, "planets home").toBe(0);
  const [sunNow] = await litIn(page, sunClip);
  expectWithinBand(sunNow, sunLit, "sun");
});

test("the Contact tab and Enter on the highlighted sun leave it whole", async ({ page }) => {
  test.setTimeout(60_000);
  await openOverview(page, "/system");
  const frames = await recordSun(page);
  await tab(page, "Contact").click();
  await expect(page).toHaveURL("/contact");
  await expectContentShown(page, "sun");

  await page.keyboard.press("Escape");
  await waitForArrival(page, "overview");
  // ArrowLeft with nothing highlighted lands on the sun.
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/contact");
  await expectContentShown(page, "sun");
  expect(new Set((await frames()).map(([phase, progress]) => `${phase}:${progress}`))).toEqual(
    new Set(["idle:0"]),
  );
});

test("a tab click while open lands on Contact with the sun lit", async ({ page }) => {
  test.setTimeout(60_000);
  const settledContact = async () => {
    await expectContentShown(page, "sun");
    await page.waitForFunction(
      () => ((window as unknown as { __label?: Label }).__label?.opacity ?? 0) > 0.84,
    );
    await page.waitForTimeout(500);
    return readSun(page);
  };
  await page.goto("/contact?det=1");
  const sun = await settledContact();
  const sunClip = around(page, sun.x, sun.y, sun.r * 0.9);
  const [sunLit] = await litIn(page, sunClip);
  expect(sunLit, "lit sun").toBeGreaterThan(2_000);

  await page.keyboard.press("Escape");
  await waitForArrival(page, "overview");
  await clickSun(page);
  await expectBlackHole(page);
  await tab(page, "Contact").click();
  await expect(page).toHaveURL("/contact");
  const after = await settledContact();
  expect(after.phase).toBe("idle");
  expect(after.progress).toBe(0);
  expect(after.infall).toBe(0);
  const [sunNow] = await litIn(page, sunClip);
  expectWithinBand(sunNow, sunLit, "sun at Contact");
});

test.describe("in full motion", () => {
  // Bloom still mounts at 960px, which is cheaper in software GL (see fullMotion.spec).
  test.use({ reducedMotion: "no-preference", viewport: { width: 960, height: 600 } });

  /** Waits for the sun to hold still on screen (the compose glide is per frame). */
  async function stillSun(page: Page): Promise<Sun> {
    let last = await readSun(page);
    await expect
      .poll(
        async () => {
          await page.waitForTimeout(300);
          const next = await readSun(page);
          const moved = Math.hypot(next.x - last.x, next.y - last.y);
          last = next;
          return moved;
        },
        { message: "sun still on screen", timeout: 30_000 },
      )
      .toBeLessThan(0.05);
    return last;
  }

  test("a tab click while open lands on Saturn's real orbit, without drifting", async ({ page }) => {
    test.setTimeout(240_000);
    // Where a plain flight from the overview frames Saturn.
    await page.goto("/system?det=1");
    await waitForArrival(page, "overview", 90_000);
    await tab(page, "Experience").click();
    await waitForArrival(page, "saturn", 90_000);
    const plain = await stillSun(page);

    await page.goto("/system?det=1");
    await waitForArrival(page, "overview", 90_000);
    await clickSun(page);
    await waitForSunPhase(page, "collapsed", 90_000);
    await tab(page, "Experience").click();
    // Read in the landing frame itself.
    const landing = await page.waitForFunction(
      () => {
        const pose = (window as unknown as { __pose?: Pose }).__pose;
        const sun = (window as unknown as { __sun?: Sun }).__sun;
        return pose?.view === "saturn" && !pose.moving && sun
          ? { azimuth: pose.azimuth, infall: sun.infall }
          : null;
      },
      undefined,
      { timeout: 90_000 },
    );
    const { azimuth, infall } = (await landing.jsonValue()) as { azimuth: number; infall: number };
    expect.soft(infall, "planets home at landing").toBe(0);
    await expectNoPivot(page, azimuth, "black hole → Experience");
    const fromHole = await stillSun(page);
    expect(
      Math.hypot(fromHole.x - plain.x, fromHole.y - plain.y),
      "framed like a plain flight, px",
    ).toBeLessThan(1);
  });
});

test("closing right after Back from a section leaves its moons dark", async ({ page }) => {
  test.setTimeout(60_000);
  const moons = () =>
    page.evaluate(() => (window as unknown as { __pose?: Pose }).__pose?.moons ?? null);
  await openOverview(page);
  await clickSun(page);
  await waitForSunPhase(page, "collapsed");
  await tab(page, "Experience").click();
  await expectContentShown(page, "saturn");
  await expect.poll(moons).toBe(1);

  // Back reopens the black hole and starts fading Saturn's moons. Escape goes
  // in the frame the fade shows, so the fade cannot finish first.
  const atClose = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const deadline = performance.now() + 10_000;
        const tick = () => {
          const pose = (window as unknown as { __pose?: Pose }).__pose;
          const sun = (window as unknown as { __sun?: Sun }).__sun;
          if (pose && sun?.phase === "collapsing" && pose.moons < 0.95) {
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
            resolve(pose.moons);
          } else if (performance.now() > deadline) {
            reject(new Error("the moons never started fading"));
          } else {
            requestAnimationFrame(tick);
          }
        };
        history.back();
        requestAnimationFrame(tick);
      }),
  );
  expect(atClose, "closed mid-fade").toBeGreaterThan(0);
  await waitForSunPhase(page, "idle");
  await expectPath(page, "/system");
  expect(await moons()).toBe(0);
});

test.describe("phone on its side", () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test("the black hole sits left, mid-height, and turns to and from a section without a jump", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await openOverview(page);
    const landed = await recordSunPath(page);
    await tapSun(page);
    await expectBlackHole(page);
    await landed("open");
    // Composed like desktop, leaving the right half for the form.
    const hole = await expectSideFraming(page);

    await page.getByRole("navigation", { name: "Sections" }).getByText("Experience", { exact: true }).tap();
    await expectContentShown(page, "saturn");
    await landed("to a section");

    await page.goBack();
    await expectBlackHole(page);
    await landed("back from a section");
    const again = await expectSideFraming(page);
    expect(Math.hypot(again.x - hole.x, again.y - hole.y), "same framing").toBeLessThan(2);

    await page.getByRole("button", { name: "Back to the solar system" }).tap();
    await waitForSunPhase(page, "idle");
    await landed("close");
  });

  test.describe("in full motion", () => {
    test.use({ reducedMotion: "no-preference" });

    test("from the overview the hole slides left without rising", async ({ page }) => {
      test.setTimeout(240_000);
      await page.goto("/system?det=1");
      await waitForArrival(page, "overview", 90_000);
      await page.waitForTimeout(500);
      const landed = await recordSunPath(page);
      await tapSun(page);
      await waitForSunPhase(page, "collapsed", 90_000);
      const opening = await landed("open");
      // Measured off mid-height: 3-8px; turning the offset in flight, 16-23px.
      expect(Math.max(...opening.map(([, y]) => Math.abs(y - 195))), "off mid-height, px").toBeLessThan(12);
    });
  });

  test("/void loads straight into the side framing", async ({ page }) => {
    const landed = await recordSunPath(page, { fromLoad: true });
    await page.goto("/void?det=1");
    await expectBlackHole(page);
    await landed("load");
    await expectSideFraming(page);
  });

  test("turning the phone on /void moves the hole beside the form", async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await openOverview(page);
    await tapSun(page);
    expect((await expectBlackHole(page)).y, "upright: high on the screen").toBeLessThan(844 * 0.4);

    await page.setViewportSize({ width: 844, height: 390 });
    const hole = await expectSideFraming(page);
    const email = await page.getByRole("dialog").getByLabel("Email").boundingBox();
    expect(email?.x ?? 0, "form right of the disk").toBeGreaterThan(hole.x + hole.r * (3.2 / 2.3));
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("a tap collapses the sun, with a 44px+ target, and the back button re-forms it", async ({
    page,
  }) => {
    await openOverview(page);
    const sun = await waitForArmedSun(page);
    expect(sun.hitR).toBeGreaterThanOrEqual(22);
    // Past the drawn sun, still on the target.
    expect(sun.r).toBeLessThan(20);
    await tapSun(page, 20);
    const hole = await expectBlackHole(page);
    // High on the screen, leaving the lower area for the form.
    expect(hole.y).toBeLessThan(844 * 0.4);

    await page.getByRole("button", { name: "Back to the solar system" }).tap();
    await waitForSunPhase(page, "idle");
    await expect(page).toHaveURL("/system");
    await waitForArmedSun(page);
  });
});
