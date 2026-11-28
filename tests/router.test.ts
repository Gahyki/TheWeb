import assert from "node:assert/strict";
import { test } from "node:test";
import { ROUTE_PATHS, routeFromPath, routeOf } from "../src/router.js";

test("every route's canonical path round-trips through routeFromPath", () => {
  for (const [route, path] of Object.entries(ROUTE_PATHS)) {
    assert.equal(routeFromPath(path), route);
  }
});

test("trailing slashes resolve to the canonical route", () => {
  assert.equal(routeFromPath("/system/"), "overview");
  assert.equal(routeFromPath("/experience///"), "saturn");
  assert.equal(routeFromPath("/void/"), "blackHole");
});

test("unknown paths (including the retired /home) fall back to Home", () => {
  for (const path of ["/nope", "/home", "/home/", "/home/extra", "/CONTACT", "/experience/edu", "/VOID", "/void/x"]) {
    assert.equal(routeFromPath(path), "earth");
  }
});

test("the root path is Home", () => {
  assert.equal(routeFromPath("/"), "earth");
});

test("the overview lives at /system", () => {
  assert.equal(routeFromPath("/system"), "overview");
});

test("the black hole lives at /void, over the overview only", () => {
  assert.equal(ROUTE_PATHS.blackHole, "/void");
  assert.equal(routeOf({ view: "overview", blackHole: "collapsing" }), "blackHole");
  assert.equal(routeOf({ view: "overview", blackHole: "open" }), "blackHole");
  assert.equal(routeOf({ view: "overview", blackHole: "off" }), "overview");
  assert.equal(routeOf({ view: "sun", blackHole: "off" }), "sun");
});
