import assert from "node:assert/strict";
import { test } from "node:test";
import { VIEW_PATHS, viewFromPath } from "../src/router.js";

test("every view's canonical path round-trips through viewFromPath", () => {
  for (const [view, path] of Object.entries(VIEW_PATHS)) {
    assert.equal(viewFromPath(path), view);
  }
});

test("trailing slashes resolve to the canonical view", () => {
  assert.equal(viewFromPath("/system/"), "overview");
  assert.equal(viewFromPath("/experience///"), "saturn");
});

test("unknown paths (including the retired /home) fall back to Home", () => {
  for (const path of ["/nope", "/home", "/home/", "/home/extra", "/CONTACT", "/experience/edu"]) {
    assert.equal(viewFromPath(path), "earth");
  }
});

test("the root path is Home", () => {
  assert.equal(viewFromPath("/"), "earth");
});

test("the overview lives at /system", () => {
  assert.equal(viewFromPath("/system"), "overview");
});
