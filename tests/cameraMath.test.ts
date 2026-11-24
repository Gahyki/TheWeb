import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fitDistance,
  focusElevationOf,
  landingAzimuth,
  outwardAzimuth,
  shortestDelta,
  simAdvanceDuring,
} from "../src/scene/cameraMath.js";
import { BODY_MAP, BODY_ORDER, FOCUS_ELEVATION, SIM_RAMP_RATE } from "../src/scene/config.js";

const TAU = Math.PI * 2;

/** How far the camera sits off the planet's own bearing, in radians. */
const bearingOffset = (id: (typeof BODY_ORDER)[number], isMobile: boolean) => {
  const def = BODY_MAP[id];
  return def.phase - outwardAzimuth(id, 0, isMobile);
};

test("shortestDelta takes the short way round, within (-PI, PI]", () => {
  for (let from = -10; from <= 10; from += 0.7) {
    for (let to = -10; to <= 10; to += 0.9) {
      const delta = shortestDelta(from, to);
      assert.ok(delta > -Math.PI && delta <= Math.PI);
      const turns = (from + delta - to) / TAU;
      assert.ok(Math.abs(turns - Math.round(turns)) < 1e-9);
    }
  }
  assert.equal(shortestDelta(0, Math.PI), Math.PI);
  assert.equal(shortestDelta(0, -Math.PI), Math.PI);
});

test("desktops frame at the configured distance, phones 2.1x farther out", () => {
  for (const id of BODY_ORDER) {
    assert.equal(fitDistance(id, false), BODY_MAP[id].focusDistance);
    assert.equal(fitDistance(id, true), BODY_MAP[id].focusDistance * 2.1);
  }
});

test("a body's own focus elevation overrides the default", () => {
  for (const id of BODY_ORDER) {
    assert.equal(focusElevationOf(id), BODY_MAP[id].focusElevation ?? FOCUS_ELEVATION);
  }
  assert.notEqual(focusElevationOf("sun"), FOCUS_ELEVATION);
});

test("the sun sits at the same screen offset behind every planet", () => {
  for (const isMobile of [false, true]) {
    const screenOffset = (id: (typeof BODY_ORDER)[number]) => {
      const radius = BODY_MAP[id].orbitRadius;
      return bearingOffset(id, isMobile) * (radius / (radius + fitDistance(id, isMobile)));
    };
    assert.ok(Math.abs(bearingOffset("earth", isMobile) - 0.35) < 1e-12);
    for (const id of BODY_ORDER) {
      if (BODY_MAP[id].orbitRadius > 0) {
        assert.ok(Math.abs(screenOffset(id) - screenOffset("earth")) < 1e-12, id);
      }
    }
  }
  assert.equal(bearingOffset("sun", false), 0.35);
});

test("the outward azimuth follows the planet along its orbit", () => {
  for (const id of BODY_ORDER) {
    const turned = outwardAzimuth(id, 30, false) - outwardAzimuth(id, 10, false);
    assert.ok(Math.abs(turned - 20 * BODY_MAP[id].orbitSpeed) < 1e-9, id);
  }
});

test("simAdvanceDuring matches the sim clock's speed ramp", () => {
  // Integrate the ramp SolarSystem applies: speed eases toward 1 at
  // SIM_RAMP_RATE while sim time accumulates.
  const integrate = (duration: number, startSpeed: number) => {
    const steps = 200_000;
    const dt = duration / steps;
    let speed = startSpeed;
    let advanced = 0;
    for (let i = 0; i < steps; i += 1) {
      const next = speed + (1 - speed) * dt * SIM_RAMP_RATE;
      advanced += ((speed + next) / 2) * dt;
      speed = next;
    }
    return advanced;
  };
  for (const duration of [0.5, 1.6, 2.9]) {
    assert.equal(simAdvanceDuring(duration, 1), duration);
    for (const startSpeed of [0, 0.03, 0.5]) {
      assert.ok(Math.abs(simAdvanceDuring(duration, startSpeed) - integrate(duration, startSpeed)) < 1e-4);
    }
  }
});

test("landingAzimuth aims where the planet will be when the flight lands", () => {
  const sim = { t: 42, speed: 0.03 };
  for (const isMobile of [false, true]) {
    for (const id of BODY_ORDER) {
      assert.equal(
        landingAzimuth(id, 2.9, sim, isMobile),
        outwardAzimuth(id, sim.t + simAdvanceDuring(2.9, sim.speed), isMobile),
      );
    }
  }
  assert.notEqual(landingAzimuth("saturn", 2.9, sim, true), landingAzimuth("saturn", 2.9, sim, false));
});
