import type { Vector3 } from "three";
import { useSiteStore } from "../state/store";
import type { BodyDef, SceneBodyId } from "./config";
import { BODY_MAP } from "./config";
import type { Infall } from "./infall";
import { infallOf } from "./infall";

/**
 * Visual-regression determinism: loading any route with `?det=1` pins all
 * scene randomness (orbital epoch, shader phases, starfield) and freezes
 * the shader clock, so two loads render pixel-identical frames.
 */
export const DETERMINISTIC =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("det");

/** Park–Miller LCG factory: independent streams stay reproducible even
 * when a consumer remounts (a shared stream would shift on re-draw). */
export function seededRandom(initialSeed: number): () => number {
  let seed = Math.max(1, Math.floor(initialSeed) % 2147483647);
  return () => {
    seed = (seed * 48271) % 2147483647;
    return seed / 2147483647;
  };
}

const sharedRandom = seededRandom(DETERMINISTIC ? 12345 : Math.random() * 2147483646 + 1);

/** Shared scene stream — material phases and the orbital epoch. */
export function sceneRandom(): number {
  return sharedRandom();
}

/** Simulation clock. `speed` drops near zero under reduced motion. */
export const sim = { t: DETERMINISTIC ? 120 : sceneRandom() * 400, speed: 1 };

/** Shader clock shared by every scene material (one uniform object). */
export const uTime = { value: 0 };

/** Shared by every call: read the result before the next one. */
const fall: Infall = { radius: 0, turn: 0, scale: 1, opacity: 1 };

/** A body's place in the black hole's infall right now; identity at rest. */
export function infallNow(def: BodyDef, out: Infall = fall): Infall {
  return infallOf(def.orbitRadius, singularity.infall.value, useSiteStore.getState().reducedMotion, out);
}

/** A body's live place on its orbit, from the sim clock alone. The camera frames this. */
export function orbitPosition(id: SceneBodyId, out: Vector3): Vector3 {
  const def = BODY_MAP[id];
  const angle = def.phase + sim.t * def.orbitSpeed;
  return out.set(
    Math.cos(angle) * def.orbitRadius,
    0,
    Math.sin(angle) * def.orbitRadius,
  );
}

/**
 * Where a body's mesh is: its orbit position with the infall applied. It
 * matches orbitPosition whenever the infall is 0, and flights restore the
 * infall to 0 before landing.
 */
export function computeBodyPosition(id: SceneBodyId, out: Vector3): Vector3 {
  if (singularity.infall.value > 0) {
    const def = BODY_MAP[id];
    const angle = def.phase + sim.t * def.orbitSpeed;
    const { radius, turn } = infallNow(def);
    return out.set(Math.cos(angle + turn) * radius, 0, Math.sin(angle + turn) * radius);
  }
  return orbitPosition(id, out);
}

export type RevealRef = { value: number };
export type BodyReveals = { orbits: RevealRef; moons: RevealRef };

const reveals = new Map<SceneBodyId, BodyReveals>();

/** GSAP tweens these refs; moon materials read them as uniforms. */
export function revealOf(id: SceneBodyId): BodyReveals {
  let entry = reveals.get(id);
  if (!entry) {
    entry = { orbits: { value: 0 }, moons: { value: 0 } };
    reveals.set(id, entry);
  }
  return entry;
}

/**
 * The black hole, as refs GSAP tweens (CameraDirector) and the scene reads:
 * `collapse` implodes the sun (0 = untouched), `horizon` draws the photon
 * ring, `disk` the accretion disk, `infall` swallows the planets (see
 * infall.ts). All zero at rest.
 */
export const singularity = {
  collapse: { value: 0 },
  horizon: { value: 0 },
  disk: { value: 0 },
  infall: { value: 0 },
};
