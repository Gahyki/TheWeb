import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "../server/app.js";
import { getProfileAge, parseProfileBirthMonth } from "../server/profileAge.js";
import { startApiServer } from "./apiServer.js";

let configuredApi: Awaited<ReturnType<typeof startApiServer>>;
let unconfiguredApi: Awaited<ReturnType<typeof startApiServer>>;

before(async () => {
  configuredApi = await startApiServer(
    createApp({
      env: {
        PROFILE_BIRTH_YEAR: "2000",
        PROFILE_BIRTH_MONTH: "1",
        PROFILE_TIME_ZONE: "UTC",
      },
    }),
  );
  unconfiguredApi = await startApiServer(createApp({ env: {} }));
});

after(async () => {
  await Promise.all([configuredApi.close(), unconfiguredApi.close()]);
});

test("age endpoint returns only the server-calculated age", async () => {
  const response = await fetch(`${configuredApi.baseUrl}/api/age`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, max-age=3600");

  const result: unknown = await response.json();
  assert.ok(typeof result === "object" && result !== null && "age" in result);
  assert.deepEqual(Object.keys(result), ["age"]);
  assert.ok(typeof result.age === "number" && Number.isInteger(result.age));
  assert.ok(result.age >= 0 && result.age <= 130);
});

test("age endpoint reports missing server configuration", async () => {
  const response = await fetch(`${unconfiguredApi.baseUrl}/api/age`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "Age display is not configured.",
  });
});

test("age changes on the first day of the configured birth month", () => {
  const birthMonth = parseProfileBirthMonth("1999", "8");
  assert.ok(birthMonth);
  assert.equal(getProfileAge(birthMonth, "UTC", new Date("2026-07-31T23:59:59Z")), 26);
  assert.equal(getProfileAge(birthMonth, "UTC", new Date("2026-08-01T00:00:00Z")), 27);
});

test("birth year and month must both be valid", () => {
  assert.throws(() => parseProfileBirthMonth("1999"), /must be set/);
  assert.throws(() => parseProfileBirthMonth("1999", "13"), /valid past year and month/);
});
