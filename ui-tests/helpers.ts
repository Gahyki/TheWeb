/** Shared shapes and math for the camera-pose test hooks. */

/** Mirror of the `window.__pose` test hook written by CameraDirector. */
export type Pose = { azimuth: number; view: string; moving: boolean };

/** Mirror of the `window.__label` test hook written by PlanetCaption. */
export type Label = {
  opacity: number;
  settled: boolean;
  /** Focused planet's display name, or null when nothing is focused. */
  name: string | null;
  /** Planet-center minus label-midpoint, in CSS pixels; null unfocused. */
  screenDeltaX: number | null;
};

/** Mirror of the `window.__perf` probe written by PerfProbe. */
export type Perf = {
  /** Previous frame's draw calls (renderer info auto-resets per render). */
  calls: number;
  geometries: number;
  textures: number;
  /** Frame interval FrameCap chose for the current tick, in ms. */
  interval: number;
  /** Measured display vsync period (median), in ms. */
  period: number;
};

/** Shortest signed angular distance from one azimuth to another. */
export function wrappedDelta(from: number, to: number): number {
  const delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) {
    return delta - Math.PI * 2;
  }
  if (delta < -Math.PI) {
    return delta + Math.PI * 2;
  }
  return delta;
}
