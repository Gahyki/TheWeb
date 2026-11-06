import { expect, test } from "@playwright/test";

/**
 * Real-stack smoke: the only specs that run against the actual Express API
 * through the Vite proxy (everything else stubs /api/*). Catches wiring
 * regressions — renamed routes, broken proxy config — that the stubbed UI
 * suite and the direct API tests both miss. Assertions are limited to
 * responses that are deterministic without SMTP or GitHub credentials.
 */
test.describe("frontend-to-API wiring (real servers)", () => {
  test("the Vite proxy reaches the API health endpoint", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("the contact route is wired through the proxy", async ({ request }) => {
    const response = await request.post("/api/contact", {
      headers: { "Content-Type": "text/plain" },
      data: "not json",
    });
    expect(response.status()).toBe(415);
    expect(await response.json()).toEqual({
      error: "Content-Type must be application/json.",
    });
  });
});
