import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "../server/app.js";
import { startApiServer } from "./apiServer.js";

let api: Awaited<ReturnType<typeof startApiServer>>;

before(async () => {
  api = await startApiServer(createApp({ env: {} }));
});

after(async () => {
  await api.close();
});

test("health endpoint is ready without optional configuration", async () => {
  const response = await fetch(`${api.baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
  assert.ok(response.headers.get("content-security-policy"));
});
