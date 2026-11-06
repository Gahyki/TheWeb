import type { BodyId } from "../state/store";

const TAU = Math.PI * 2;

/** Every body in the scene; only BodyId members map to sections. */
export type SceneBodyId = BodyId | "mercury" | "venus" | "uranus" | "neptune";

export type MoonDef = {
  name: string;
  /** Orbit radius in world units, from the planet's center. */
  orbitRadius: number;
  /** Angular speed in radians per simulated second. */
  speed: number;
  phase: number;
  inclination: number;
  radius: number;
};

export type BodyDef = {
  id: SceneBodyId;
  name: string;
  /** Present only on bodies that are site sections. */
  sectionLabel?: string;
  orbitRadius: number;
  orbitSpeed: number;
  phase: number;
  radius: number;
  meridians: number;
  parallels: number;
  spinSpeed: number;
  color: string;
  gridOpacity: number;
  /** Ring radii as multiples of the body radius. Always visible. */
  rings?: number[];
  ringTilt?: number;
  /** Highlighted lat/long circles + glowing surface marker (degrees). */
  marker?: { lat: number; lon: number };
  moons: MoonDef[];
  /** Camera distance from the body center when focused. */
  focusDistance: number;
  /** Camera elevation when focused; defaults to FOCUS_ELEVATION. */
  focusElevation?: number;
};

export const BODIES: BodyDef[] = [
  {
    id: "mercury",
    name: "Mercury",
    orbitRadius: 4.4,
    orbitSpeed: TAU / 55,
    phase: 1.7,
    radius: 0.179,
    meridians: 8,
    parallels: 5,
    spinSpeed: 0.08,
    color: "#d9cfc0",
    gridOpacity: 0.42,
    moons: [],
    focusDistance: 3,
  },
  {
    id: "venus",
    name: "Venus",
    orbitRadius: 5.6,
    orbitSpeed: TAU / 70,
    phase: 4.9,
    radius: 0.32,
    meridians: 10,
    parallels: 6,
    spinSpeed: 0.06,
    color: "#f7dfae",
    gridOpacity: 0.44,
    moons: [],
    focusDistance: 3.6,
  },
  {
    id: "uranus",
    name: "Uranus",
    orbitRadius: 23,
    orbitSpeed: TAU / 280,
    phase: 0.6,
    radius: 0.544,
    meridians: 11,
    parallels: 7,
    spinSpeed: 0.1,
    color: "#b2ecf2",
    gridOpacity: 0.44,
    rings: [1.5, 1.62],
    ringTilt: 1.25,
    moons: [],
    focusDistance: 5.5,
  },
  {
    id: "neptune",
    name: "Neptune",
    orbitRadius: 26.4,
    orbitSpeed: TAU / 335,
    phase: 3.1,
    radius: 0.525,
    meridians: 11,
    parallels: 7,
    spinSpeed: 0.1,
    color: "#a9c4ff",
    gridOpacity: 0.44,
    moons: [],
    focusDistance: 5.4,
  },
  {
    id: "sun",
    name: "Sun",
    sectionLabel: "Contact",
    orbitRadius: 0,
    orbitSpeed: 0,
    phase: 0,
    radius: 2.3,
    meridians: 16,
    parallels: 10,
    spinSpeed: 0.03,
    color: "#fff0c4",
    gridOpacity: 0.55,
    moons: [],
    focusDistance: 9,
    focusElevation: 0.1,
  },
  {
    id: "earth",
    name: "Earth",
    sectionLabel: "Home",
    orbitRadius: 7,
    orbitSpeed: TAU / 85,
    phase: 0.9,
    radius: 0.371,
    meridians: 11,
    parallels: 7,
    spinSpeed: 0.3,
    color: "#a8d8ff",
    gridOpacity: 0.5,
    marker: { lat: 49.2827, lon: -123.1207 },
    // Moon radii are true to the moon:planet ratio (Luna/Earth ≈ 0.273).
    // Orbit radii and periods stay stylized for composition.
    moons: [
      {
        name: "Luna",
        orbitRadius: 1.5,
        speed: TAU / 14,
        phase: 2.1,
        inclination: 0.28,
        radius: 0.371 * 0.273,
      },
    ],
    focusDistance: 4.6,
  },
  {
    id: "mars",
    name: "Mars",
    sectionLabel: "GitHub",
    orbitRadius: 9.6,
    orbitSpeed: TAU / 115,
    phase: 3.8,
    radius: 0.294,
    meridians: 10,
    parallels: 6,
    spinSpeed: 0.12,
    color: "#ffc0a0",
    gridOpacity: 0.5,
    // True ratios: Phobos/Mars ≈ 0.0033, Deimos/Mars ≈ 0.0018 — both render
    // as pure points of light (their glow core), which is physically honest.
    moons: [
      {
        name: "Phobos",
        orbitRadius: 0.95,
        speed: TAU / 9,
        phase: 0.4,
        inclination: 0.18,
        radius: 0.294 * 0.0033,
      },
      {
        name: "Deimos",
        orbitRadius: 1.35,
        speed: TAU / 16,
        phase: 3.6,
        inclination: -0.14,
        radius: 0.294 * 0.0018,
      },
    ],
    focusDistance: 4.1,
  },
  {
    id: "jupiter",
    name: "Jupiter",
    sectionLabel: "How I Think",
    orbitRadius: 14,
    orbitSpeed: TAU / 165,
    phase: 5.4,
    radius: 0.864,
    meridians: 14,
    parallels: 9,
    spinSpeed: 0.18,
    color: "#f4d2a8",
    gridOpacity: 0.5,
    // All four Galilean moons, radii true to the moon:Jupiter ratio
    // (Io 0.026, Europa 0.022, Ganymede 0.038, Callisto 0.034).
    moons: [
      {
        name: "Io",
        orbitRadius: 2.0,
        speed: TAU / 8,
        phase: 1.2,
        inclination: 0.1,
        radius: 0.864 * 0.026,
      },
      {
        name: "Europa",
        orbitRadius: 2.5,
        speed: TAU / 12,
        phase: 4.4,
        inclination: -0.2,
        radius: 0.864 * 0.022,
      },
      {
        name: "Ganymede",
        orbitRadius: 3.0,
        speed: TAU / 18,
        phase: 2.8,
        inclination: 0.16,
        radius: 0.864 * 0.038,
      },
      {
        name: "Callisto",
        orbitRadius: 3.6,
        speed: TAU / 28,
        phase: 5.6,
        inclination: -0.08,
        radius: 0.864 * 0.034,
      },
    ],
    focusDistance: 9.5,
  },
  {
    id: "saturn",
    name: "Saturn",
    sectionLabel: "Experience",
    orbitRadius: 18.6,
    orbitSpeed: TAU / 215,
    phase: 2.4,
    radius: 0.736,
    meridians: 13,
    parallels: 8,
    spinSpeed: 0.16,
    color: "#f3ddab",
    gridOpacity: 0.5,
    // Dense band over the same span reads as a thick ring system in the
    // 1px-line wireframe aesthetic.
    rings: [1.42, 1.5, 1.58, 1.66, 1.74, 1.82, 1.9, 1.98],
    ringTilt: 0.42,
    // Major moons, radii true to the moon:Saturn ratio
    // (Titan 0.044, Rhea 0.013, Iapetus 0.013).
    moons: [
      {
        name: "Rhea",
        orbitRadius: 2.6,
        speed: TAU / 10,
        phase: 3.9,
        inclination: 0.12,
        radius: 0.736 * 0.013,
      },
      {
        name: "Titan",
        orbitRadius: 3.1,
        speed: TAU / 15,
        phase: 0.8,
        inclination: 0.22,
        radius: 0.736 * 0.044,
      },
      {
        name: "Iapetus",
        orbitRadius: 3.7,
        speed: TAU / 24,
        phase: 1.9,
        inclination: -0.26,
        radius: 0.736 * 0.013,
      },
    ],
    focusDistance: 9.5,
  },
];

export const BODY_MAP: Record<SceneBodyId, BodyDef> = Object.fromEntries(
  BODIES.map((body) => [body.id, body]),
) as Record<SceneBodyId, BodyDef>;

/** Cycling order used by keyboard navigation (section order). */
export const BODY_ORDER: BodyId[] = ["earth", "saturn", "jupiter", "mars", "sun"];

export const OVERVIEW_CAMERA = {
  radius: 70,
  // Just shy of π/2: reads as fully top-down while keeping lookAt's
  // default up-vector away from its straight-down singularity.
  elevation: 1.54,
  initialAzimuth: 0.6,
};

export const FOCUS_ELEVATION = 0.24;
