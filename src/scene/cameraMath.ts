/** Pure camera framing math; CameraDirector supplies the live state. */

import type { BodyId } from "../state/store.js";
import { BLACK_HOLE_DISTANCE, BODY_MAP, FOCUS_ELEVATION, SIM_RAMP_RATE } from "./config.js";

const TAU = Math.PI * 2;

/** Shortest signed angular difference, in (-PI, PI]. */
export function shortestDelta(from: number, to: number): number {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) {
    delta -= TAU;
  }
  if (delta <= -Math.PI) {
    delta += TAU;
  }
  return delta;
}

export function focusElevationOf(id: BodyId): number {
  return BODY_MAP[id].focusElevation ?? FOCUS_ELEVATION;
}

/**
 * Focus distance, widened on narrow screens so the whole body — Saturn's
 * rings included — fits the portrait frame.
 */
export function fitDistance(id: BodyId, isMobile: boolean): number {
  return BODY_MAP[id].focusDistance * (isMobile ? 2.1 : 1);
}

/**
 * Azimuth that places the camera on the planet's outward side at sim time
 * `simTime`, looking back toward the system center — so the Sun sits small
 * and distant behind the body instead of photobombing the frame at close
 * range.
 */
export function outwardAzimuth(id: BodyId, simTime: number, isMobile: boolean): number {
  const def = BODY_MAP[id];
  // The sun's projected screen offset scales with orbit/(orbit + camera
  // distance), so a flat bearing constant reads wider on Mars (far orbit,
  // close camera) than on Earth. Normalize per planet to Earth's ratio so
  // the sun lands in the same screen spot from every section. The sun
  // itself has no orbit — any bearing works; keep the base constant.
  let offset = 0.35;
  if (def.orbitRadius > 0) {
    const earth = BODY_MAP.earth;
    const reference = earth.orbitRadius / (earth.orbitRadius + fitDistance("earth", isMobile));
    const ratio = def.orbitRadius / (def.orbitRadius + fitDistance(id, isMobile));
    offset = 0.35 * (reference / ratio);
  }
  return def.phase + simTime * def.orbitSpeed - offset;
}

/**
 * Sim-time the orbits will advance during a flight of this real duration.
 * sim.speed ramps toward 1 (rate SIM_RAMP_RATE) once a flight starts, so
 * predicting with the launch-time speed misses the landing: the sun ends
 * off its centered-behind-the-planet arrangement and the settle glide
 * visibly pivots it into place.
 */
export function simAdvanceDuring(durationSeconds: number, simSpeed: number): number {
  return (
    durationSeconds -
    ((1 - simSpeed) * (1 - Math.exp(-SIM_RAMP_RATE * durationSeconds))) / SIM_RAMP_RATE
  );
}

/**
 * Outward azimuth where a flight launched now, lasting `durationSeconds`,
 * lands. Predicting ahead matters: a flight that aims at the launch-time
 * azimuth lands behind the still-orbiting planet and visibly corrects on
 * arrival.
 */
export function landingAzimuth(
  id: BodyId,
  durationSeconds: number,
  sim: { t: number; speed: number },
  isMobile: boolean,
): number {
  return outwardAzimuth(id, sim.t + simAdvanceDuring(durationSeconds, sim.speed), isMobile);
}

/** Camera distance from the black hole; phones pull back to fit the disk. */
export function holeDistance(isMobile: boolean): number {
  return BLACK_HOLE_DISTANCE * (isMobile ? 1.4 : 1);
}

/**
 * Off-center composition distance for the black hole. CameraDirector's
 * phone offset assumes the camera sits 2.1x the compose distance away (see
 * fitDistance), so this keeps the hole where a focused planet would sit.
 */
export function holeComposeDistance(isMobile: boolean): number {
  return holeDistance(isMobile) / (isMobile ? 2.1 : 1);
}

/**
 * On-screen radius, in CSS pixels, of a sphere seen dead-on from `distance`
 * by a camera with vertical field of view `fovDeg` over `viewportHeight`.
 */
export function projectedRadiusPx(
  radius: number,
  distance: number,
  fovDeg: number,
  viewportHeight: number,
): number {
  if (distance <= radius) {
    return Number.POSITIVE_INFINITY;
  }
  const halfAngle = Math.asin(radius / distance);
  return ((Math.tan(halfAngle) / Math.tan((fovDeg * Math.PI) / 360)) * viewportHeight) / 2;
}

/** Smallest sun hit radius: a 44px touch target. */
export const MIN_SUN_HIT_PX = 22;

/** Sun hit radius: a little past its edge, never under MIN_SUN_HIT_PX. */
export function sunHitRadiusPx(projectedRadius: number): number {
  return Math.max(projectedRadius * 1.25, MIN_SUN_HIT_PX);
}
