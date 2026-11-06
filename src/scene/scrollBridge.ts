import type { BodyId } from "../state/store";

/**
 * Scroll-to-camera bridge, written by the section scroller on every scroll
 * frame and read by the CameraDirector per frame. `p` is the progress of
 * the transition from planet `a` to planet `b` (0 = holding on `a`).
 * Mutable module state, not React state: it changes every frame.
 */
export const scrollPose: { a: BodyId; b: BodyId; p: number } = {
  a: "earth",
  b: "earth",
  p: 0,
};
