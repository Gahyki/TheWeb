import { expect, test } from "@playwright/test";
import type { Pose } from "./helpers";

/**
 * Phone reels layout: full-screen pages with the caption overlaid above a
 * bottom tab bar, and long content in bottom sheets. Assertions follow
 * mobile app conventions: 44px minimum touch targets, 16px+ form text
 * (iOS Safari zooms smaller inputs on focus), no content under the chrome.
 */

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const TABS = [
  ["Home", "earth", "/"],
  ["Experience", "saturn", "/experience"],
  ["How I Think", "jupiter", "/thinking"],
  ["GitHub", "mars", "/github"],
  ["Contact", "sun", "/contact"],
] as const;

test.beforeEach(async ({ page }) => {
  await page.route("**/api/github", (route) =>
    route.fulfill({
      json: {
        repos: [
          { name: "TheWeb", description: "This site.", stars: 0, language: "TypeScript", url: "https://github.com/Gahyki/TheWeb" },
        ],
        contributions: { total: 3, weeks: [[0, 0, 0, 0, 0, 0, 1], [0, 2, 0]] },
      },
    }),
  );
  await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
});

async function settled(page: import("@playwright/test").Page, view: string) {
  await page.waitForFunction(
    (target) => {
      const pose = (window as unknown as { __pose?: Pose }).__pose;
      return pose !== undefined && pose.view === target && !pose.moving;
    },
    view,
    { timeout: 30_000 },
  );
}

test("the tab bar sits at the bottom with 44px+ targets for every section", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Sections" });
  const navBox = await nav.boundingBox();
  expect(navBox, "tab bar rendered").not.toBeNull();
  expect((navBox?.y ?? 0) + (navBox?.height ?? 0)).toBeCloseTo(844, 0);
  for (const [label] of TABS) {
    const box = await nav.getByRole("button", { name: label, exact: true }).boundingBox();
    expect(box?.height ?? 0, `${label} tab height`).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0, `${label} tab width`).toBeGreaterThanOrEqual(44);
  }
  const back = page.getByRole("button", { name: "Back to the solar system" });
  const backBox = await back.boundingBox();
  expect(backBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(backBox?.width ?? 0).toBeGreaterThanOrEqual(44);
});

test("each tab lands on its reel with the caption clear of the tab bar", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  await settled(page, "earth");
  const nav = page.getByRole("navigation", { name: "Sections" });
  const navTop = (await nav.boundingBox())?.y ?? 0;
  for (const [label, id, path] of TABS) {
    await nav.getByRole("button", { name: label, exact: true }).click();
    await expect(page).toHaveURL(path);
    await settled(page, id);
    const section = page.locator(`[data-section="${id}"]`);
    await expect(section).toBeInViewport({ ratio: 0.99 });
    // Every visible caption element ends above the tab bar.
    const lowest = await section.evaluate((element) =>
      Math.max(
        ...[...element.querySelectorAll("h1, h2, p, button, a, li")]
          .map((node) => node.getBoundingClientRect())
          .filter((rect) => rect.height > 0)
          .map((rect) => rect.bottom),
      ),
    );
    expect(lowest, `${label} caption bottom`).toBeLessThanOrEqual(navTop);
  }
});

test("each reel is exactly one screen and snaps one page per swipe", async ({ page }) => {
  await page.goto("/");
  const root = page.locator("[data-scroll-root]");
  await expect(root).toBeVisible();
  const heights = await page
    .locator("[data-section]")
    .evaluateAll((sections) => sections.map((section) => section.getBoundingClientRect().height));
  expect(heights.every((height) => Math.abs(height - 844) < 1)).toBe(true);
  const stop = await page
    .locator('[data-section="earth"]')
    .evaluate((section) => getComputedStyle(section).scrollSnapStop);
  expect(stop).toBe("always");
});

test("a sheet opens the full content, locks the reels, and Escape only closes it", async ({
  page,
}) => {
  await page.goto("/experience");
  await settled(page, "saturn");
  await page.locator('[data-section="saturn"]').getByRole("button", { name: /all 4 entries/i }).click();
  const dialog = page.getByRole("dialog", { name: "Experience" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Concordia University")).toBeVisible();
  await expect(page.locator("[data-scroll-root]")).toHaveCSS("overflow-y", "hidden");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL("/experience");
  await expect(page.locator("[data-scroll-root]")).toHaveCSS("overflow-y", "auto");
});

test("the contact sheet uses 16px fields with 44px+ targets (no iOS focus zoom)", async ({
  page,
}) => {
  await page.goto("/contact");
  await settled(page, "sun");
  await page.locator('[data-section="sun"]').getByRole("button", { name: "Send a message" }).click();
  const dialog = page.getByRole("dialog", { name: "Contact" });
  await expect(dialog).toBeVisible();
  for (const field of await dialog.locator("input, textarea").all()) {
    const fontSize = await field.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
    expect(fontSize).toBeGreaterThanOrEqual(16);
    expect((await field.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const submit = dialog.getByRole("button", { name: /send message/i });
  expect((await submit.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("the GitHub reel summarizes live contributions as weekly bars", async ({ page }) => {
  await page.goto("/github");
  await settled(page, "mars");
  const section = page.locator('[data-section="mars"]');
  await expect(section.getByText(/3 contributions this year · last active yesterday/)).toBeVisible();
  await expect(section.getByRole("img", { name: "3 contributions in the last 26 weeks" })).toBeVisible();
});

test("the back button returns to the solar system", async ({ page }) => {
  await page.goto("/github");
  await settled(page, "mars");
  await page.getByRole("button", { name: "Back to the solar system" }).click();
  await expect(page).toHaveURL("/system");
});

test("swiping one screen pages to the next section and back", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await settled(page, "earth");
  const root = page.locator("[data-scroll-root]");
  // One reel down, like a swipe up: the view, URL, and camera follow.
  await root.evaluate((element) => element.scrollBy({ top: element.clientHeight }));
  await expect(page).toHaveURL("/experience");
  await settled(page, "saturn");
  await expect(page.locator('[data-section="saturn"]')).toBeInViewport({ ratio: 0.99 });
  await root.evaluate((element) => element.scrollBy({ top: -element.clientHeight }));
  await expect(page).toHaveURL("/");
  await settled(page, "earth");
});

test("Home leads with the role and current employer", async ({ page }) => {
  await page.goto("/");
  await settled(page, "earth");
  const home = page.locator('[data-section="earth"]');
  await expect(home.getByRole("heading", { name: "Jason Kim" })).toBeVisible();
  await expect(home.getByText("Software engineer", { exact: true })).toBeVisible();
  await expect(home.getByText("Amazon Web Services", { exact: true })).toBeVisible();
  await expect(home.getByText("CloudFront · API team · since Jul 2022")).toBeVisible();
  // Languages moved off Home (they live in How I Think).
  await expect(home.getByText(/English · French · Korean/)).toHaveCount(0);
});

test("the location caption stays on one line on the narrowest phones", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 568 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.route("**/api/github", (route) => route.fulfill({ json: { repos: [], contributions: null } }));
  await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
  await page.goto("/");
  const caption = page.locator('[data-section="earth"]').getByText("Vancouver · 49.28° N 123.12° W");
  await expect(caption).toBeVisible();
  const fits = await caption.evaluate((element) => {
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
    const rect = element.getBoundingClientRect();
    return rect.height < lineHeight * 1.5 && rect.left + element.scrollWidth <= window.innerWidth;
  });
  expect(fits, "single line, fully on screen at 320px").toBe(true);
  await context.close();
});

test("the back button is spaced from the top edge and hidden on the overview", async ({ page }) => {
  await page.goto("/github");
  await settled(page, "mars");
  const back = page.getByRole("button", { name: "Back to the solar system" });
  expect((await back.boundingBox())?.y ?? 0, "top spacing").toBeGreaterThanOrEqual(12);
  await back.click();
  await expect(page).toHaveURL("/system");
  await expect(back).toHaveCSS("opacity", "0");
  await expect(back).toHaveAttribute("tabindex", "-1");
  await expect(page.getByRole("navigation", { name: "Sections" })).toBeVisible();
});

test("every sheet shows its full content and dismisses from close and backdrop", async ({
  page,
}) => {
  test.setTimeout(90_000);
  for (const [path, id, opener, title, expected, dismiss] of [
    ["/thinking", "jupiter", /read more/i, "How I Think", "A practice of asking better questions.", "close"],
    ["/github", "mars", /repositories/i, "GitHub", "TheWeb", "backdrop"],
    ["/contact", "sun", /send a message/i, "Contact", "Name", "close"],
  ] as const) {
    await page.goto(path);
    await settled(page, id);
    await page.locator(`[data-section="${id}"]`).getByRole("button", { name: opener }).click();
    const dialog = page.getByRole("dialog", { name: title });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(expected, { exact: true }).first()).toBeVisible();
    if (dismiss === "close") {
      await dialog.getByRole("button", { name: "Close" }).click();
    } else {
      // The backdrop is the area above the sheet.
      await page.mouse.click(195, 40);
    }
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(path);
  }
});

test("the contact reel offers a single send-a-message action", async ({ page }) => {
  await page.goto("/contact");
  await settled(page, "sun");
  const contact = page.locator('[data-section="sun"]');
  await expect(contact.getByRole("button", { name: "Send a message" })).toBeVisible();
  await expect(contact.getByText(/email me/i)).toHaveCount(0);
});
