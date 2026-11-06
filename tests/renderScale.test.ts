import assert from "node:assert/strict";
import { test } from "node:test";
import { dprLevels, maxDprFor, MIN_DPR, PIXEL_BUDGET } from "../src/scene/renderScale.js";

const backingStore = (dpr: number, width: number, height: number) => width * height * dpr * dpr;

test("a Retina Mac keeps its full dpr", () => {
  // MacBook Pro 14" default: 1512x982 CSS at dpr 2 (~5.9MP).
  assert.equal(maxDprFor(2, 1512, 982, 2), 2);
});

test("common Windows desktops are untouched by the budget", () => {
  assert.equal(maxDprFor(1, 1920, 1080, 2), 1); // 1080p @100%
  assert.equal(maxDprFor(1.25, 2048, 1152, 2), 1.25); // 1440p @125%
  assert.equal(maxDprFor(1.5, 1280, 720, 2), 1.5); // 1080p laptop @150%
});

test("an outsized backing store is trimmed to the pixel budget", () => {
  // 4K @150%: 2560x1440 CSS at dpr 1.5 = 8.3MP.
  const dpr = maxDprFor(1.5, 2560, 1440, 2);
  assert.ok(dpr < 1.5);
  assert.ok(Math.abs(backingStore(dpr, 2560, 1440) - PIXEL_BUDGET) < 1);
});

test("the budget never renders a 1x display below native resolution", () => {
  // 4K @100% is over budget at dpr 1, but blurring every frame is worse.
  assert.equal(maxDprFor(1, 3840, 2160, 2), 1);
});

test("the per-device ceiling still applies", () => {
  assert.equal(maxDprFor(3, 390, 844, 1.5), 1.5); // phone
  assert.equal(maxDprFor(3, 1512, 982, 2), 2);
});

test("every setup gets fallback steps, including 1x displays", () => {
  for (const max of [1, 1.25, 1.5, 2]) {
    const levels = dprLevels(max);
    assert.ok(levels.length >= 2, `dpr ${max} has steps: ${levels.join(", ")}`);
    assert.equal(levels[0], max);
    for (let i = 1; i < levels.length; i += 1) {
      assert.ok(levels[i] < levels[i - 1], `strictly descending: ${levels.join(", ")}`);
    }
    assert.ok(levels[levels.length - 1] >= MIN_DPR, `floor respected: ${levels.join(", ")}`);
  }
});
