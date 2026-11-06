import assert from "node:assert/strict";
import { test } from "node:test";
import { medianPeriod, shouldRender, vsyncsPerRender } from "../src/scene/framePacing.js";

/**
 * Drives the pacing rule over a simulated display (with ±0.3ms timestamp
 * jitter) and returns the gaps between rendered frames, in vsyncs.
 */
function renderedGaps(hz: number, fps: number, active: boolean): number[] {
  const period = 1000 / hz;
  const vsyncs = vsyncsPerRender(period, fps, active);
  const gaps: number[] = [];
  let lastRender = Number.NEGATIVE_INFINITY;
  let lastIndex = 0;
  for (let i = 0; i < hz * 5; i += 1) {
    const time = i * period + Math.sin(i * 12.9898) * 0.3;
    if (shouldRender(time - lastRender, vsyncs, period)) {
      if (lastRender !== Number.NEGATIVE_INFINITY) {
        gaps.push(i - lastIndex);
      }
      lastRender = time;
      lastIndex = i;
    }
  }
  return gaps;
}

const DISPLAYS = [60, 75, 100, 120, 144, 165, 240];

test("every common refresh rate renders on a uniform whole-vsync cadence", () => {
  for (const hz of DISPLAYS) {
    for (const [fps, active] of [
      [90, true],
      [45, false],
    ] as const) {
      const gaps = renderedGaps(hz, fps, active);
      const unique = [...new Set(gaps)];
      assert.equal(unique.length, 1, `${hz}Hz @${fps}fps cadence ${unique.join("/")}`);
    }
  }
});

test("high-refresh displays get the divisor nearest the active target", () => {
  assert.equal(vsyncsPerRender(1000 / 144, 90, true), 2); // 72fps, was judder at 90
  assert.equal(vsyncsPerRender(1000 / 165, 90, true), 2); // 82.5fps
  assert.equal(vsyncsPerRender(1000 / 240, 90, true), 3); // 80fps
  assert.equal(vsyncsPerRender(1000 / 60, 90, true), 1); // every vsync
});

test("idle pacing never renders faster than its target", () => {
  for (const hz of DISPLAYS) {
    const vsyncs = vsyncsPerRender(1000 / hz, 45, false);
    assert.ok(hz / vsyncs <= 45 * 1.05, `${hz}Hz idle renders at ${hz / vsyncs}fps`);
  }
});

test("the period estimate shrugs off dropped frames and jitter", () => {
  const period = 1000 / 144;
  const samples = Array.from({ length: 60 }, (_, i) =>
    i % 7 === 0 ? period * 2 : period + Math.sin(i) * 0.2,
  );
  assert.ok(Math.abs(medianPeriod(samples, 16.7) - period) < 0.25);
  assert.equal(medianPeriod([], 16.7), 16.7);
});
