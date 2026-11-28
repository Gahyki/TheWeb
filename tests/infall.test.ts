import assert from "node:assert/strict";
import { test } from "node:test";
import { BODIES, PHOTON_RING_RADIUS } from "../src/scene/config.js";
import {
  fallProgress,
  INFALL_SECONDS,
  infallOf,
  RESTORE_DELAY,
  RESTORE_MIN_SECONDS,
  restoreSeconds,
} from "../src/scene/infall.js";

const PLANETS = BODIES.filter((body) => body.orbitRadius > 0).sort(
  (a, b) => a.orbitRadius - b.orbitRadius,
);

/** Infall values from 0 to 1, one per 60Hz frame of the full-motion collapse. */
const FRAMES = Array.from({ length: INFALL_SECONDS * 60 + 1 }, (_, i) => i / (INFALL_SECONDS * 60));

test("at rest every body sits exactly on its orbit, whole and lit", () => {
  for (const reduced of [false, true]) {
    for (const body of BODIES) {
      assert.deepEqual(infallOf(body.orbitRadius, 0, reduced), {
        radius: body.orbitRadius,
        turn: 0,
        scale: 1,
        opacity: 1,
      });
    }
  }
});

test("the sun never falls: the collapse handles it", () => {
  for (const reduced of [false, true]) {
    for (const infall of FRAMES) {
      assert.deepEqual(infallOf(0, infall, reduced), { radius: 0, turn: 0, scale: 1, opacity: 1 });
    }
  }
});

test("fully swallowed, every planet is inside the photon ring and invisible", () => {
  for (const body of PLANETS) {
    const fallen = infallOf(body.orbitRadius, 1, false);
    assert.ok(fallen.radius <= PHOTON_RING_RADIUS, body.id);
    assert.equal(fallen.opacity, 0, body.id);
    assert.ok(fallen.scale > 0 && fallen.scale < 0.01, body.id);
    assert.equal(infallOf(body.orbitRadius, 1, true).opacity, 0, `${body.id} reduced`);
  }
});

test("the fall is monotonic: radius, scale, and opacity only shrink, the turn only grows", () => {
  for (const body of PLANETS) {
    let previous = infallOf(body.orbitRadius, 0, false);
    for (const infall of FRAMES.slice(1)) {
      const next = infallOf(body.orbitRadius, infall, false);
      assert.ok(next.radius <= previous.radius, `${body.id} radius at ${infall}`);
      assert.ok(next.turn >= previous.turn, `${body.id} turn at ${infall}`);
      assert.ok(next.scale <= previous.scale, `${body.id} scale at ${infall}`);
      assert.ok(next.opacity <= previous.opacity, `${body.id} opacity at ${infall}`);
      previous = next;
    }
  }
});

test("inner planets fall first and are swallowed first", () => {
  const swallowedAt = (radius: number) =>
    FRAMES.find((infall) => infallOf(radius, infall, false).opacity === 0) ?? Number.NaN;
  for (let i = 1; i < PLANETS.length; i += 1) {
    const inner = PLANETS[i - 1].orbitRadius;
    const outer = PLANETS[i].orbitRadius;
    for (const infall of FRAMES) {
      assert.ok(fallProgress(inner, infall) >= fallProgress(outer, infall), `${PLANETS[i].id} at ${infall}`);
    }
    assert.ok(swallowedAt(inner) < swallowedAt(outer), PLANETS[i].id);
  }
  // Mercury leaves its orbit at once; Neptune holds still for a while.
  assert.ok(infallOf(PLANETS[0].orbitRadius, 0.05, false).radius < PLANETS[0].orbitRadius);
  const outermost = PLANETS[PLANETS.length - 1].orbitRadius;
  assert.equal(infallOf(outermost, 0.3, false).radius, outermost);
});

test("the turn speeds up as the radius shrinks", () => {
  for (const body of PLANETS) {
    let previousStep = 0;
    for (let i = 1; i < FRAMES.length; i += 1) {
      const step = infallOf(body.orbitRadius, FRAMES[i], false).turn - infallOf(body.orbitRadius, FRAMES[i - 1], false).turn;
      if (fallProgress(body.orbitRadius, FRAMES[i]) < 1) {
        // Floating-point slack: the rate holds flat once capped.
        assert.ok(step >= previousStep - 1e-12, `${body.id} slowed at ${FRAMES[i]}`);
        previousStep = step;
      }
    }
    assert.ok(infallOf(body.orbitRadius, 1, false).turn > Math.PI, `${body.id} spirals at least half a turn`);
  }
});

test("at the collapse's pace and the fastest restore, no planet turns 12° in a 60Hz frame", () => {
  for (const seconds of [INFALL_SECONDS, RESTORE_MIN_SECONDS]) {
    const frames = Math.round(seconds * 60);
    for (const body of PLANETS) {
      for (let i = 1; i <= frames; i += 1) {
        const step =
          infallOf(body.orbitRadius, i / frames, false).turn - infallOf(body.orbitRadius, (i - 1) / frames, false).turn;
        assert.ok(step < 0.21, `${body.id} turned ${step} rad in one frame at ${seconds}s`);
      }
    }
  }
});

test("reduced motion only fades: no spiral, no shrink", () => {
  for (const body of PLANETS) {
    for (const infall of FRAMES) {
      const fallen = infallOf(body.orbitRadius, infall, true);
      assert.equal(fallen.radius, body.orbitRadius);
      assert.equal(fallen.turn, 0);
      assert.equal(fallen.scale, 1);
      assert.ok(Math.abs(fallen.opacity - (1 - infall)) < 1e-12);
    }
  }
});

test("planets spiral back out no faster than the strobe-safe pace, and home before a landing", () => {
  // Fades CameraDirector runs while the hole is open: the close (1.8s) and
  // 0.6x every flight away from it (2.1s, 2.4s, 2.9s).
  for (const [fade, flight] of [[1.8, 1.8], [1.26, 2.1], [1.44, 2.4], [1.74, 2.9]]) {
    assert.ok(restoreSeconds(fade, 1) >= RESTORE_MIN_SECONDS, `${fade}s fade`);
    assert.ok(fade * RESTORE_DELAY + restoreSeconds(fade, 1) < flight, `${flight}s flight`);
  }
  // A partly fallen system comes back in proportion.
  assert.equal(restoreSeconds(1.8, 0.5), restoreSeconds(1.8, 1) / 2);
});
