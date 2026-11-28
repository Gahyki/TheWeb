import { expect, type Page } from "@playwright/test";
import vercel from "../vercel.json" with { type: "json" };
import { CODE, OWNER, test } from "./authStubs";
import { clickSun, waitForArmedSun, waitForArrival, waitForSunPhase } from "./helpers";

/**
 * Production smoke (the "prod" project): the built bundle under
 * `vite preview`, which serves vercel.json's headers and proxies /api to the
 * real API.
 */

type Violation = { directive: string; blocked: string };

const DEPLOYED_CSP = vercel.headers
  .flatMap((rule) => rule.headers)
  .find((header) => header.key === "Content-Security-Policy")?.value;

let errors: string[] = [];

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const violations: Violation[] = [];
    (window as unknown as { __csp: Violation[] }).__csp = violations;
    document.addEventListener("securitypolicyviolation", (event) =>
      violations.push({ directive: event.violatedDirective, blocked: event.blockedURI }),
    );
  });
  // The real route would call GitHub.
  await page.route("**/api/github", (route) =>
    route.fulfill({ json: { repos: [], contributions: null } }),
  );
});

test.afterEach(async ({ page }) => {
  const violations = await page.evaluate(
    () => (window as unknown as { __csp: Violation[] }).__csp,
  );
  expect(violations, "CSP violations").toEqual([]);
  expect(errors, "page errors").toEqual([]);
});

test("the home page loads the vendor chunks and renders under the deployed CSP", async ({
  page,
}) => {
  const served = new Map<string, number>();
  page.on("response", (response) =>
    served.set(new URL(response.url()).pathname, response.status()),
  );

  const response = await page.goto("/");
  expect(DEPLOYED_CSP).toBeTruthy();
  expect(response?.headers()["content-security-policy"]).toBe(DEPLOYED_CSP);
  await waitForArrival(page, "earth");

  const modules = await page
    .locator('script[type="module"], link[rel="modulepreload"]')
    .evaluateAll((elements) =>
      elements.map(
        (element) =>
          new URL((element as HTMLScriptElement).src || (element as HTMLLinkElement).href)
            .pathname,
      ),
    );
  for (const chunk of ["react-vendor", "three-vendor", "vendor"]) {
    const path = modules.find((module) => module.startsWith(`/assets/${chunk}-`));
    expect(path, chunk).toBeDefined();
    expect(served.get(path as string), chunk).toBe(200);
  }
});

for (const [path, view] of [
  ["/system", "overview"],
  ["/thinking", "jupiter"],
] as const) {
  test(`the ${path} deep link renders its view`, async ({ page }) => {
    await page.goto(path);
    await waitForArrival(page, view);
  });
}

/** Every chunk the page fetches, by path, with its status. */
function recordChunks(page: Page) {
  const served = new Map<string, number>();
  page.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (pathname.startsWith("/assets/")) {
      served.set(pathname, response.status());
    }
  });
  /** Statuses of the chunks named `name` (`/assets/<name>-<hash>.js`). */
  return (name: string) =>
    [...served].filter(([path]) => path.startsWith(`/assets/${name}-`)).map(([, status]) => status);
}

const SIGN_IN_CHUNKS = ["LoginDialog", "supabase-vendor"];

test("supabase-js loads only on the sun click, then signs in under the deployed CSP", async ({
  page,
}) => {
  const chunks = recordChunks(page);
  await page.goto("/");
  await waitForArrival(page, "earth");
  await page.keyboard.press("Escape");
  await waitForArrival(page, "overview");
  await waitForArmedSun(page);
  for (const name of SIGN_IN_CHUNKS) {
    expect(chunks(name), `${name} before the click`).toEqual([]);
  }

  await clickSun(page);
  await waitForSunPhase(page, "collapsed");
  const dialog = page.getByRole("dialog", { name: "Sign in" });
  await expect(dialog.getByLabel("Email")).toBeFocused();
  for (const name of SIGN_IN_CHUNKS) {
    await expect.poll(() => chunks(name), name).toEqual([200]);
  }

  // Supabase (stubbed) is a connect-src origin; /api/me (stubbed) is 'self'.
  await dialog.getByLabel("Email").fill(OWNER.email);
  await dialog.getByLabel("Password").fill(OWNER.password);
  await dialog.getByRole("button", { name: "Sign in" }).click();
  await dialog.getByLabel("Authenticator code").fill(CODE);
  await dialog.getByRole("button", { name: "Verify" }).click();
  await expect(dialog.getByRole("status")).toHaveText("Signed in.");
});

test("/void opens the sign-in under the deployed CSP", async ({ page, auth }) => {
  const chunks = recordChunks(page);
  const response = await page.goto("/void");
  expect(response?.headers()["content-security-policy"]).toBe(DEPLOYED_CSP);
  await waitForSunPhase(page, "collapsed");
  await expect(page.getByRole("dialog", { name: "Sign in" }).getByLabel("Email")).toBeFocused();
  await expect(page).toHaveURL("/void");
  for (const name of SIGN_IN_CHUNKS) {
    await expect.poll(() => chunks(name), name).toEqual([200]);
  }
  // No stored session: nothing to ask Supabase yet.
  expect(auth.requests).toEqual([]);
});

test("the contact form's POST reaches the real API through the preview proxy", async ({
  page,
}) => {
  await page.goto("/contact");
  await expect(page.locator('input[name="name"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[name="name"]').fill("Ada Lovelace");
  await page.locator('input[name="email"]').fill("ada@example.com");
  // Non-ASCII fails the API's validation, so nothing sends even where SMTP
  // is configured.
  await page.locator('textarea[name="message"]').fill("Ünïcödé never passes validation.");
  const reply = page.waitForResponse("**/api/contact");
  await page.getByRole("button", { name: "Send message" }).click();

  // Whatever the API answers (today a 403 for the preview's origin), the
  // form shows it.
  const response = await reply;
  expect(response.ok()).toBe(false);
  expect(response.headers()["content-type"]).toContain("application/json");
  const { error } = await response.json();
  expect(typeof error).toBe("string");
  await expect(page.getByRole("alert")).toHaveText(error);
});
