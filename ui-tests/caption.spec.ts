import { expect, test } from "@playwright/test";
import type { Label } from "./helpers";

/**
 * Planet-label lifecycle: the in-scene sprite must vanish the instant a
 * flight starts and come back only after the post-arrival settle delay —
 * read through the __label test hook (the sprite never touches the DOM).
 */

async function readLabel(page: import("@playwright/test").Page): Promise<Label> {
  const label = await page.evaluate(
    () => (window as unknown as { __label?: Label }).__label ?? null,
  );
  expect(label).not.toBeNull();
  return label as Label;
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/github", (route) =>
    route.fulfill({ json: { repos: [], contributions: null } }),
  );
  await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
});

test("the label hides the instant a flight starts and returns after the settle", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto("/");

  // Visible once Home has settled.
  await page.waitForFunction(
    () => ((window as unknown as { __label?: Label }).__label?.opacity ?? 0) > 0.8,
    undefined,
    { timeout: 20_000 },
  );

  // Starting a flight cuts the label instantly (within a frame or two).
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByText("Experience", { exact: true })
    .click();
  await page.waitForFunction(
    () => {
      const label = (window as unknown as { __label?: Label }).__label;
      return label !== undefined && label.opacity === 0;
    },
    undefined,
    { timeout: 2_000 },
  );

  // It stays hidden through the flight and the 0.45s settle delay…
  await page.waitForFunction(
    () => {
      const pose = (window as unknown as { __pose?: { moving: boolean; view: string } }).__pose;
      return pose && pose.view === "saturn" && !pose.moving;
    },
    undefined,
    { timeout: 30_000 },
  );
  const atArrival = await readLabel(page);
  // Settled (conditions hold) but still inside the 0.45s delay: hidden.
  expect(atArrival.settled).toBe(true);
  expect(atArrival.opacity).toBeLessThan(0.05);

  // …then fades back in.
  await page.waitForFunction(
    () => ((window as unknown as { __label?: Label }).__label?.opacity ?? 0) > 0.8,
    undefined,
    { timeout: 20_000 },
  );
});

test("the label names the focused planet and is centered on it", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.waitForFunction(
    () => ((window as unknown as { __label?: Label }).__label?.opacity ?? 0) > 0.8,
    undefined,
    { timeout: 20_000 },
  );
  const home = await readLabel(page);
  expect(home.name).toBe("Earth");
  // Centered: the label's midpoint sits on the planet's center. A small
  // tolerance covers the perspective skew of the below-sphere offset.
  expect(Math.abs(home.screenDeltaX ?? Number.NaN)).toBeLessThan(2);

  await page
    .getByRole("navigation", { name: "Sections" })
    .getByText("Experience", { exact: true })
    .click();
  await page.waitForFunction(
    () => {
      const label = (window as unknown as { __label?: Label }).__label;
      return label !== undefined && label.name === "Saturn" && label.opacity > 0.8;
    },
    undefined,
    { timeout: 30_000 },
  );
  const saturn = await readLabel(page);
  expect(Math.abs(saturn.screenDeltaX ?? Number.NaN)).toBeLessThan(2);
});
