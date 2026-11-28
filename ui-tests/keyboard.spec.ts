import { expect, type Page } from "@playwright/test";
import { test } from "./authStubs";
import { clickSun, waitForArrival, waitForSunPhase } from "./helpers";

/** README's keyboard promise: arrows/Enter move between sections. */

const SECTIONS = {
  earth: ["Home", "/"],
  saturn: ["Experience", "/experience"],
  jupiter: ["How I Think", "/thinking"],
  mars: ["GitHub", "/github"],
  sun: ["Contact", "/contact"],
} as const;

test.beforeEach(async ({ page }) => {
  await page.route("**/api/github", (route) =>
    route.fulfill({ json: { repos: [], contributions: null } }),
  );
  await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
});

function tab(page: Page, label: string) {
  return page.getByRole("navigation", { name: "Sections" }).getByText(label, { exact: true });
}

/** URL, active tab, and camera arrival all agree on `view`. */
async function expectAt(page: Page, view: keyof typeof SECTIONS) {
  const [label, path] = SECTIONS[view];
  await expect(page).toHaveURL(path);
  await expect(tab(page, label)).toHaveAttribute("aria-current", "page");
  await waitForArrival(page, view);
}

async function openOverview(page: Page) {
  await page.goto("/system");
  await waitForArrival(page, "overview");
}

test("section arrows step to the neighbors and wrap at both ends", async ({ page }) => {
  await page.goto("/");
  await waitForArrival(page, "earth");

  await page.keyboard.press("ArrowRight");
  await expectAt(page, "saturn");
  await page.keyboard.press("ArrowLeft");
  await expectAt(page, "earth");
  await page.keyboard.press("ArrowLeft");
  await expectAt(page, "sun");
  await page.keyboard.press("ArrowRight");
  await expectAt(page, "earth");
});

test("overview arrows move the highlight and Enter flies to it", async ({ page }) => {
  await openOverview(page);
  for (const key of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowLeft"]) {
    await page.keyboard.press(key);
  }
  await page.keyboard.press("Enter");
  await expectAt(page, "saturn");
});

test("ArrowLeft with nothing highlighted starts at the last body", async ({ page }) => {
  await openOverview(page);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expectAt(page, "sun");
});

test("Escape closes the black hole, and the overview's keys work as before", async ({ page }) => {
  await openOverview(page);
  await page.keyboard.press("ArrowRight");
  await clickSun(page);
  await waitForSunPhase(page, "collapsed");
  await expect(page.getByRole("dialog", { name: "Sign in" }).getByLabel("Email")).toBeFocused();
  // From the page, not a field (login.spec covers that); keys meanwhile do nothing.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape");
  await waitForSunPhase(page, "idle");
  await expect(page).toHaveURL("/system");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);

  // A fresh highlight, as in "overview arrows move the highlight".
  for (const key of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowLeft"]) {
    await page.keyboard.press(key);
  }
  await page.keyboard.press("Enter");
  await expectAt(page, "saturn");
});

test("Enter flies to the highlight even while a tab has focus", async ({ page }) => {
  await page.goto("/");
  await waitForArrival(page, "earth");
  // Clicking a tab focuses it; Escape leaves that focus in place.
  await tab(page, "Experience").click();
  await expectAt(page, "saturn");
  await page.keyboard.press("Escape");
  await waitForArrival(page, "overview");
  await expect(tab(page, "Experience")).toBeFocused();

  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("ArrowRight");
  }
  const entries = await page.evaluate(() => history.length);
  await page.keyboard.press("Enter");
  await expectAt(page, "jupiter");
  // A second entry means the tab's native click fired too.
  expect(await page.evaluate(() => history.length)).toBe(entries + 1);
});

test("tabbing to a control drops the highlight, so Enter activates it", async ({ page }) => {
  await openOverview(page);
  await page.keyboard.press("ArrowRight");
  // Wordmark, then Home, then Experience.
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(tab(page, "Experience")).toBeFocused();
  await page.keyboard.press("Enter");
  await expectAt(page, "saturn");
});

test("arrows in the contact form move the caret, not the section", async ({ page }) => {
  await page.goto("/contact");
  await waitForArrival(page, "sun");
  const message = page.locator('textarea[name="message"]');
  await message.fill("ab");

  await message.press("ArrowLeft");
  await page.keyboard.type("X");
  await message.press("ArrowRight");
  await page.keyboard.type("Y");
  await expect(message).toHaveValue("aXbY");
  await expect(page).toHaveURL("/contact");
});
