/**
 * Backing-store budget in device pixels. Sized to a Retina MacBook at dpr
 * 2 (~5.9MP), which renders this scene smoothly, so typical laptops and
 * 1080p/1440p desktops are untouched; only outsized stores (4K @150%,
 * 8.3MP) are trimmed. The cost of the scene's post-processing scales with
 * this count, not with dpr.
 */
export const PIXEL_BUDGET = 6_000_000;

/** Lowest scale the adaptive steps may reach; below this lines blur badly. */
export const MIN_DPR = 0.75;

/** Each adaptive step renders ~36% fewer pixels (0.8² per axis). */
const STEP = 0.8;

/**
 * Starting dpr: the device's own ratio, capped by the per-device ceiling
 * and by the pixel budget for the current CSS viewport. Never below 1 —
 * the budget trims only high-dpi stores, never blurs a 1x display.
 */
export function maxDprFor(
  devicePixelRatio: number,
  cssWidth: number,
  cssHeight: number,
  ceiling: number,
): number {
  const native = Math.min(devicePixelRatio || 1, ceiling);
  const budget = Math.sqrt(PIXEL_BUDGET / Math.max(1, cssWidth * cssHeight));
  return Math.max(Math.min(native, 1), Math.min(native, budget));
}

/**
 * Quality ladder from the starting dpr down to MIN_DPR, used only while a
 * machine keeps missing its frame target. Every setup gets steps — a 1x
 * display included — so struggling hardware always has somewhere to go.
 */
export function dprLevels(max: number): number[] {
  const levels = [max];
  while (levels[levels.length - 1] * STEP >= MIN_DPR) {
    levels.push(Math.round(levels[levels.length - 1] * STEP * 100) / 100);
  }
  // Land on the floor only if it is a meaningful step from the last level.
  if (levels[levels.length - 1] - MIN_DPR > 0.08) {
    levels.push(MIN_DPR);
  }
  return levels;
}
