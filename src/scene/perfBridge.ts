/**
 * Render-loop facts shared with the perf test probe without prop plumbing:
 * FrameCap records the measured display period and the frame interval it
 * chose (a whole number of vsyncs); the probe publishes both alongside the
 * renderer's own statistics.
 */
export const perfState = { interval: 0, period: 0 };
