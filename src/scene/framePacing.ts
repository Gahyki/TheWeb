/**
 * Frame pacing: render every Nth vsync, never at a fractional rate. A cap
 * that isn't a whole divisor of the refresh rate (90fps on 144Hz)
 * alternates 1- and 2-vsync frames, which reads as judder.
 * Active rounds to the nearest divisor of the target; idle never exceeds
 * its target rate (rounds the vsync count up).
 */
export function vsyncsPerRender(periodMs: number, targetFps: number, active: boolean): number {
  const ratio = 1000 / targetFps / periodMs;
  return Math.max(1, active ? Math.round(ratio) : Math.ceil(ratio - 0.05));
}

/** Render when at least N-½ periods have passed: tolerant of vsync jitter. */
export function shouldRender(
  sinceLastRenderMs: number,
  vsyncs: number,
  periodMs: number,
): boolean {
  return sinceLastRenderMs >= (vsyncs - 0.5) * periodMs;
}

/** Median of the recent vsync samples — robust to jitter and drops. */
export function medianPeriod(samples: readonly number[], fallback: number): number {
  if (samples.length === 0) {
    return fallback;
  }
  return [...samples].sort((a, b) => a - b)[samples.length >> 1];
}
