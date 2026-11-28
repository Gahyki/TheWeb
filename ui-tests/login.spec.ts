import { expect, type Locator, type Page } from "@playwright/test";
import {
  type AuthStub,
  aalOf,
  authError,
  CHALLENGE_ID,
  CODE,
  FACTOR_ID,
  jwt,
  OWNER,
  PUBLISHABLE_KEY,
  type Reply,
  STORAGE_KEY,
  test,
} from "./authStubs";
import { clickSun, readSun, tapSun, waitForArrival, waitForSunPhase } from "./helpers";

/**
 * The owner sign-in behind the black hole, against a stubbed Supabase
 * project and /api/me. Every Supabase request must match a stub.
 */

const REFUSED = "Sign-in failed.";
const UNAVAILABLE = "Sign-in is unavailable.";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/github", (route) =>
    route.fulfill({ json: { repos: [], contributions: null } }),
  );
  await page.route("**/api/age", (route) => route.fulfill({ json: { age: 26 } }));
});

/** Clicks the overview's sun and waits for the form, email focused. */
async function openSignIn(page: Page) {
  await page.goto("/system");
  await waitForArrival(page, "overview");
  await clickSun(page);
  await waitForSunPhase(page, "collapsed");
  const dialog = page.getByRole("dialog", { name: "Sign in" });
  await expect(dialog.getByLabel("Email")).toBeFocused();
  await expect(page).toHaveURL("/void");
  return dialog;
}

async function submitPassword(dialog: Locator, password = OWNER.password) {
  await dialog.getByLabel("Email").fill(OWNER.email);
  await dialog.getByLabel("Password").fill(password);
  await dialog.getByRole("button", { name: "Sign in" }).click();
}

/** Opens the form and gets to the code step. */
async function toCodeStep(page: Page) {
  const dialog = await openSignIn(page);
  await submitPassword(dialog);
  await expect(dialog.getByLabel("Authenticator code")).toBeFocused();
  return dialog;
}

async function storedSession(page: Page) {
  return page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
}

/** Words login heuristics look for in names and ids. */
const LOGIN_WORDS = /mail|user|login|pass|otp|code/i;

/** Every form and field opts out of autofill, under names no heuristic matches. */
async function expectNoAutofill(dialog: Locator) {
  for (const element of await dialog.locator("form, input").all()) {
    await expect(element).toHaveAttribute("autocomplete", "off");
    await expect(element).toHaveAttribute("data-1p-ignore", "true");
    await expect(element).toHaveAttribute("data-lpignore", "true");
    await expect(element).toHaveAttribute("data-bwignore", "true");
    await expect(element).toHaveAttribute("data-form-type", "other");
  }
  for (const element of await dialog.locator("[name], [id]").all()) {
    for (const attribute of ["name", "id"]) {
      expect((await element.getAttribute(attribute)) ?? "").not.toMatch(LOGIN_WORDS);
    }
  }
}

const routes = (auth: AuthStub) => auth.requests.map(({ method, path, search }) => `${method} ${path}${search}`);

test("the owner signs in with password, then code, one request at a time", async ({ page, auth }) => {
  const logs: string[] = [];
  page.on("console", (message) => logs.push(message.text()));
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  auth.token = async () => {
    await held;
    return undefined;
  };

  const dialog = await openSignIn(page);
  await expectNoAutofill(dialog);
  await expect(dialog.getByLabel("Email")).toHaveAttribute("type", "text");
  await expect(dialog.getByLabel("Email")).toHaveAttribute("inputmode", "email");
  await submitPassword(dialog);
  const submit = dialog.getByRole("button", { name: "Sign in" });
  await expect(submit).toBeDisabled();
  await expect(dialog.getByRole("status")).toHaveText("Signing in…");
  // A submit while in flight sends nothing more; the disabled button would block Enter.
  await dialog.locator("form").evaluate((form) => (form as HTMLFormElement).requestSubmit());
  release();

  const code = dialog.getByLabel("Authenticator code");
  await expect(code).toBeFocused();
  await expectNoAutofill(dialog);
  await expect(code).toHaveAttribute("inputmode", "numeric");
  await expect(code).toHaveAttribute("pattern", "[0-9]{6}");
  await expect(code).toHaveAttribute("maxlength", "6");
  await code.fill(CODE);
  await code.press("Enter");

  await expect(dialog.getByRole("status")).toHaveText("Signed in.");
  await expect(dialog.getByRole("button", { name: "Sign out" })).toBeFocused();
  await expect(page).toHaveURL("/void");

  expect(routes(auth)).toEqual([
    "POST /auth/v1/token?grant_type=password",
    "GET /auth/v1/user",
    "GET /auth/v1/user",
    `POST /auth/v1/factors/${FACTOR_ID}/challenge`,
    `POST /auth/v1/factors/${FACTOR_ID}/verify`,
  ]);
  const [token, ...rest] = auth.requests;
  expect(token.body).toMatchObject({ email: OWNER.email, password: OWNER.password });
  expect(token.apikey).toBe(PUBLISHABLE_KEY);
  expect(rest.map((request) => [request.apikey, aalOf(request.authorization)])).toEqual([
    [PUBLISHABLE_KEY, "aal1"],
    [PUBLISHABLE_KEY, "aal1"],
    [PUBLISHABLE_KEY, "aal1"],
    [PUBLISHABLE_KEY, "aal1"],
  ]);
  expect(rest[3].body).toMatchObject({ challenge_id: CHALLENGE_ID, code: CODE });
  expect(auth.me.map((request) => [request.path, aalOf(request.authorization)])).toEqual([
    ["/api/me", "aal1"],
    ["/api/me", "aal2"],
  ]);

  const stored = JSON.parse((await storedSession(page)) ?? "null") as { access_token?: string } | null;
  expect(aalOf(`Bearer ${stored?.access_token}`)).toBe("aal2");
  // The password went only to the token grant, and nothing logged a secret.
  expect(rest.some((request) => JSON.stringify(request.body).includes(OWNER.password))).toBe(false);
  expect(logs.filter((text) => text.includes("eyJ") || text.includes(OWNER.password))).toEqual([]);
});

test("a wrong password keeps the email and re-asks for the password", async ({ page, auth }) => {
  const dialog = await openSignIn(page);
  await submitPassword(dialog, "not the password");

  await expect(dialog.getByRole("alert")).toHaveText(REFUSED);
  await expect(dialog.getByLabel("Email")).toHaveValue(OWNER.email);
  const password = dialog.getByLabel("Password");
  await expect(password).toHaveValue("");
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(password).toBeFocused();
  expect(routes(auth)).toEqual(["POST /auth/v1/token?grant_type=password"]);
  expect(auth.me).toEqual([]);
  expect(await storedSession(page)).toBeNull();
});

test("a rate limit says to wait and keeps what was typed", async ({ page, auth }) => {
  auth.token = () => authError(429, "over_request_rate_limit", "Request rate limit reached");
  const dialog = await openSignIn(page);
  await submitPassword(dialog);

  await expect(dialog.getByRole("alert")).toHaveText("Too many attempts. Try again later.");
  await expect(dialog.getByLabel("Password")).toHaveValue(OWNER.password);
  await expect(dialog.getByLabel("Password")).not.toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("button", { name: "Sign in" })).toBeEnabled();
  expect(auth.me).toEqual([]);
});

for (const [label, token, me] of [
  ["a network failure", "abort", undefined],
  ["a non-JSON 502", { status: 502, contentType: "text/html", body: "<h1>Bad gateway</h1>" }, undefined],
  ["a JSON 503", authError(503, "unexpected_failure", "Down"), undefined],
  ["an unconfigured /api/me", undefined, { status: 503, json: { error: "Sign-in is not configured." } }],
  ["an unreachable /api/me", undefined, "abort"],
] satisfies [string, Reply | undefined, Reply | undefined][]) {
  test(`${label} says sign-in is unavailable`, async ({ page, auth }) => {
    auth.token = () => token;
    auth.meReply = () => me;
    const dialog = await openSignIn(page);
    await submitPassword(dialog);
    await expect(dialog.getByRole("alert")).toHaveText(UNAVAILABLE);
    await expect(dialog.getByLabel("Authenticator code")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
}

for (const [label, verdict] of [
  ["a user off the allowlist", { status: 403, json: { error: "This account is not allowed here.", code: "not_allowed" } }],
  ["a token the API rejects", { status: 401, json: { error: "Sign-in required." } }],
] as const) {
  test(`${label} looks like a wrong password and is signed out locally`, async ({ page, auth }) => {
    auth.meReply = () => verdict;
    const dialog = await openSignIn(page);
    await submitPassword(dialog);

    await expect(dialog.getByRole("alert")).toHaveText(REFUSED);
    const password = dialog.getByLabel("Password");
    await expect(password).toHaveValue("");
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(password).toBeFocused();
    await expect(dialog.getByLabel("Authenticator code")).toHaveCount(0);
    await expect.poll(() => routes(auth)).toEqual([
      "POST /auth/v1/token?grant_type=password",
      "POST /auth/v1/logout?scope=local",
    ]);
    expect(aalOf(auth.requests[1].authorization)).toBe("aal1");
    expect(await storedSession(page)).toBeNull();
  });
}

test("a wrong code clears the field and the next code signs in", async ({ page, auth }) => {
  const dialog = await toCodeStep(page);
  const code = dialog.getByLabel("Authenticator code");
  await code.fill("000000");
  await dialog.getByRole("button", { name: "Verify" }).click();

  await expect(dialog.getByRole("alert")).toHaveText("That code didn't work.");
  await expect(code).toHaveValue("");
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(code).toBeFocused();

  await code.fill(CODE);
  await code.press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("Signed in.");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  // Each try gets its own challenge.
  expect(routes(auth).filter((route) => route.includes("/factors/"))).toEqual([
    `POST /auth/v1/factors/${FACTOR_ID}/challenge`,
    `POST /auth/v1/factors/${FACTOR_ID}/verify`,
    `POST /auth/v1/factors/${FACTOR_ID}/challenge`,
    `POST /auth/v1/factors/${FACTOR_ID}/verify`,
  ]);
});

test("an owner without a verified authenticator is told so and signed out", async ({
  page,
  auth,
}) => {
  auth.factors = [{ id: FACTOR_ID, factor_type: "totp", status: "unverified" }];
  const dialog = await openSignIn(page);
  await submitPassword(dialog);

  await expect(dialog.getByRole("alert")).toHaveText("The authenticator is not set up.");
  await expect(dialog.getByLabel("Authenticator code")).toHaveCount(0);
  await expect(dialog.getByLabel("Password")).toBeVisible();
  await expect.poll(() => routes(auth)).toEqual([
    "POST /auth/v1/token?grant_type=password",
    "GET /auth/v1/user",
    "POST /auth/v1/logout?scope=local",
  ]);
  expect(await storedSession(page)).toBeNull();
});

test("reloading /void mid-sign-in resumes at the code step", async ({ page, auth }) => {
  await toCodeStep(page);
  const before = auth.requests.length;
  await page.reload();
  await expect(page).toHaveURL("/void");
  await waitForSunPhase(page, "collapsed");

  const dialog = page.getByRole("dialog", { name: "Sign in" });
  const code = dialog.getByLabel("Authenticator code");
  await expect(code).toBeFocused();
  // Resumed from the stored session: no new password grant.
  expect(routes(auth).slice(before)).toEqual(["GET /auth/v1/user"]);
  await code.fill(CODE);
  await code.press("Enter");
  await expect(dialog.getByRole("status")).toHaveText("Signed in.");
});

test("signing out returns to the form and clears the session", async ({ page, auth }) => {
  const dialog = await toCodeStep(page);
  await dialog.getByLabel("Authenticator code").fill(CODE);
  await dialog.getByRole("button", { name: "Verify" }).click();
  await dialog.getByRole("button", { name: "Sign out" }).click();

  await expect(dialog.getByLabel("Email")).toBeFocused();
  await expect(dialog.getByLabel("Password")).toHaveValue("");
  await expect(dialog.getByRole("status")).toHaveText("");
  expect(routes(auth).at(-1)).toBe("POST /auth/v1/logout?scope=local");
  expect(aalOf(auth.requests.at(-1)?.authorization)).toBe("aal2");
  expect(await storedSession(page)).toBeNull();
  await expect(page).toHaveURL("/void");
});

test("a link carrying tokens in its URL signs nobody in", async ({ page, auth }) => {
  const tokens = new URLSearchParams({
    access_token: jwt("aal2"),
    refresh_token: "refresh-link",
    expires_in: "3600",
    token_type: "bearer",
  });
  await page.goto(`/void#${tokens}`);
  await waitForSunPhase(page, "collapsed");
  const dialog = page.getByRole("dialog", { name: "Sign in" });
  await expect(dialog.getByLabel("Email")).toBeFocused();
  expect(routes(auth)).toEqual([]);
  expect(auth.me).toEqual([]);
  expect(await storedSession(page)).toBeNull();
});

test("Escape inside a field closes it and gives focus back to the tab that had it", async ({ page }) => {
  const dialog = await openSignIn(page);
  await page.goBack();
  await waitForSunPhase(page, "idle");
  // Focused when Forward reopens the form.
  const tab = page.getByRole("navigation", { name: "Sections" }).getByText("Experience", { exact: true });
  await tab.focus();
  await page.goForward();
  await waitForSunPhase(page, "collapsed");
  await expect(dialog.getByLabel("Email")).toBeFocused();
  await dialog.getByLabel("Email").fill(OWNER.email);
  await page.keyboard.press("Escape");

  await expect(page).toHaveURL("/system");
  await expect(dialog).toHaveCount(0);
  await waitForSunPhase(page, "idle");
  await expect(tab).toBeFocused();
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the sign-in uses 16px fields with 44px+ targets", async ({ page }) => {
    await page.goto("/system");
    await waitForArrival(page, "overview");
    await tapSun(page);
    await waitForSunPhase(page, "collapsed");
    const dialog = page.getByRole("dialog", { name: "Sign in" });
    await expect(dialog.getByLabel("Email")).toBeFocused();
    for (const field of await dialog.locator("input").all()) {
      const fontSize = await field.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
      expect(fontSize).toBeGreaterThanOrEqual(16);
      expect((await field.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const submit = dialog.getByRole("button", { name: "Sign in" });
    expect((await submit.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    // Clear of the tab bar.
    const bar = await page.getByRole("navigation", { name: "Sections" }).boundingBox();
    const box = await submit.boundingBox();
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(bar?.y ?? 0);
  });
});

test.describe("phone on its side", () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test("the sign-in fits beside the black hole, error line included", async ({ page, auth }) => {
    await page.goto("/system");
    await waitForArrival(page, "overview");
    await tapSun(page);
    const dialog = page.getByRole("dialog", { name: "Sign in" });
    await waitForSunPhase(page, "collapsed");
    await expect(dialog.getByLabel("Email")).toBeFocused();
    const hole = await readSun(page);
    await dialog.getByLabel("Email").fill(OWNER.email);
    await dialog.getByLabel("Password").fill("not the password");
    await dialog.getByRole("button", { name: "Sign in" }).tap();
    await expect(dialog.getByRole("alert")).toHaveText(REFUSED);
    expect(auth.me).toEqual([]);

    const bar = await page.getByRole("navigation", { name: "Sections" }).boundingBox();
    const back = await page.getByRole("button", { name: "Back to the solar system" }).boundingBox();
    expect(bar && back).toBeTruthy();
    const parts = await dialog
      .locator("h2, input, button, [role=alert]")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
    expect(parts.length).toBe(5);
    for (const part of parts as DOMRect[]) {
      expect(part.top, "below the top edge").toBeGreaterThanOrEqual(0);
      expect(part.bottom, "above the tab bar").toBeLessThanOrEqual(bar?.y ?? 0);
      expect(part.right, "left of the back button").toBeLessThanOrEqual(back?.x ?? 0);
      // Right of the disk, whose spiral arms reach 3.2 against the sun's 2.3.
      expect(part.left, "right of the disk").toBeGreaterThan(hole.x + hole.r * (3.2 / 2.3));
    }
  });

  test("on a shorter screen a drag scrolls the error line into view", async ({ page, auth }) => {
    await page.setViewportSize({ width: 667, height: 320 });
    await page.goto("/system");
    await waitForArrival(page, "overview");
    await tapSun(page);
    const dialog = page.getByRole("dialog", { name: "Sign in" });
    await waitForSunPhase(page, "collapsed");
    await expect(dialog.getByLabel("Email")).toBeFocused();
    await dialog.getByLabel("Email").fill(OWNER.email);
    await dialog.getByLabel("Password").fill("not the password");
    await dialog.getByRole("button", { name: "Sign in" }).tap();
    const alert = dialog.getByRole("alert");
    await expect(alert).toHaveText(REFUSED);
    expect(auth.me).toEqual([]);

    const bar = (await page.getByRole("navigation", { name: "Sections" }).boundingBox())?.y ?? 0;
    const alertBottom = async () => {
      const box = await alert.boundingBox();
      return (box?.y ?? 0) + (box?.height ?? 0);
    };
    expect(await alertBottom(), "starts under the tab bar").toBeGreaterThan(bar);
    const heading = await dialog.getByRole("heading").boundingBox();
    expect(heading?.y ?? -1, "the top is on screen").toBeGreaterThanOrEqual(0);

    // A finger drag up the form, as raw touches (Chromium only).
    const cdp = await page.context().newCDPSession(page);
    const from = (await dialog.getByLabel("Password").boundingBox()) ?? { x: 0, y: 0 };
    const x = from.x + 10;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: from.y }] });
    for (let step = 1; step <= 12; step += 1) {
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x, y: from.y - step * 12 }],
      });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(alertBottom, "scrolled above the tab bar").toBeLessThanOrEqual(bar);
  });
});
