import type { Vector3 } from "three";
import type { SceneBodyId } from "./config";
import { BODY_MAP } from "./config";

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

/** Rate at which sim.speed eases toward its target (see SolarSystem). */
export const SIM_RAMP_RATE = 7;

/** Shader clock shared by every scene material (one uniform object). */
export const uTime = { value: 0 };

/**
 * Computes a body's live world position analytically from the sim clock,
 * so the camera and the meshes can never disagree about where a planet is.
 */
export function computeBodyPosition(id: SceneBodyId, out: Vector3): Vector3 {
  const def = BODY_MAP[id];
  const angle = def.phase + sim.t * def.orbitSpeed;
  return out.set(
    Math.cos(angle) * def.orbitRadius,
    0,
    Math.sin(angle) * def.orbitRadius,
  );
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
