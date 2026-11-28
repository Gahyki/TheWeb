/** Pure math for the planets falling into the black hole; CameraDirector tweens the infall. */

import { BODIES, PHOTON_RING_RADIUS } from "./config.js";

/** Seconds the full-motion infall takes, first planet to last. */
export const INFALL_SECONDS = 1.5;

/**
 * Fastest pace the planets spiral back out at, in seconds for a full
 * infall: keeps the turn under the no-strobe step per frame.
 */
export const RESTORE_MIN_SECONDS = 1.4;

/** Share of a fade's length before the planets start back out. */
export const RESTORE_DELAY = 0.15;

/**
 * Seconds the planets take to spiral back out from `infall` during a
 * singularity fade of `fadeSeconds`.
 */
export function restoreSeconds(fadeSeconds: number, infall: number): number {
  return Math.max(RESTORE_MIN_SECONDS, Math.min(INFALL_SECONDS, fadeSeconds * 0.8)) * infall;
}

/** Share of the infall each planet's own fall takes; the rest staggers the starts. */
const FALL_SHARE = 0.55;

/** Where a planet's fall ends, inside the photon ring. */
const END_RADIUS = PHOTON_RING_RADIUS * 0.5;

/** A planet shrinks and fades from here (just past the disk's arms) to the photon ring. */
const FADE_RADIUS = 3.4;

/** Peak turn rate, in radians per unit of a planet's own fall progress, for the deepest fall. */
const MAX_TURN_RATE = 9;

/** Progress over which that turn rate ramps up to its cap. */
const TURN_RAMP = 0.6;

const ORBITS = BODIES.map((body) => body.orbitRadius).filter((radius) => radius > 0);
const INNER = Math.min(...ORBITS);
const OUTER = Math.max(...ORBITS);
const DEEPEST = Math.log(OUTER / END_RADIUS);

/** A body's state in the fall, relative to its orbit. */
export type Infall = {
  /** Orbit radius now, in world units. */
  radius: number;
  /** Added to the orbital angle, in radians. */
  turn: number;
  scale: number;
  opacity: number;
};

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** A planet's progress through its own fall: inner orbits start first. 0 for the sun. */
export function fallProgress(orbitRadius: number, infall: number): number {
  if (orbitRadius <= 0) {
    return 0;
  }
  const start = ((orbitRadius - INNER) / (OUTER - INNER)) * (1 - FALL_SHARE);
  return Math.min(1, Math.max(0, (infall - start) / FALL_SHARE));
}

/**
 * Where a body of `orbitRadius` sits at `infall` (0 on its orbit, 1 swallowed).
 * Full motion spirals it in: the radius shrinks geometrically (ease-in), and
 * the turn rate rises with the fall to a cap. Reduced motion only fades.
 * Exactly identity at 0.
 */
export function infallOf(
  orbitRadius: number,
  infall: number,
  reduced: boolean,
  out: Infall = { radius: 0, turn: 0, scale: 1, opacity: 1 },
): Infall {
  out.radius = orbitRadius;
  out.turn = 0;
  out.scale = 1;
  out.opacity = 1;
  if (infall <= 0 || orbitRadius <= 0) {
    return out;
  }
  if (reduced) {
    out.opacity = Math.max(0, 1 - infall);
    return out;
  }
  const p = fallProgress(orbitRadius, infall);
  if (p === 0) {
    return out;
  }
  const depth = Math.log(orbitRadius / END_RADIUS);
  out.radius = p === 1 ? END_RADIUS : orbitRadius * Math.exp(-depth * p * p);
  // Integral of rate * smoothstep(0, TURN_RAMP, p): the rate ramps, then holds at its cap.
  const rate = MAX_TURN_RATE * (depth / DEEPEST);
  const u = Math.min(p, TURN_RAMP) / TURN_RAMP;
  out.turn = rate * (TURN_RAMP * (u ** 3 - u ** 4 / 2) + Math.max(0, p - TURN_RAMP));
  const visible = smoothstep(PHOTON_RING_RADIUS, FADE_RADIUS, out.radius);
  // Kept above zero so the body's matrix stays invertible.
  out.scale = Math.max(visible, 1e-3);
  out.opacity = visible;
  return out;
}
