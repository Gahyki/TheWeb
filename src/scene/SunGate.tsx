import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { PerspectiveCamera, Vector3 } from "three";
import { sunArmed, useSiteStore } from "../state/store";
import { projectedRadiusPx, sunHitRadiusPx } from "./cameraMath";
import { BODY_MAP } from "./config";
import { computeBodyPosition, singularity } from "./registry";

/** Farther than this between press and release is a drag, not a click. */
const CLICK_SLOP_PX = 10;

type Point = { x: number; y: number };

const projected = new Vector3();
const earth = new Vector3();

/**
 * Hit-tests clicks and taps on the sun by projecting its center (it sits
 * still at the origin) — no raycasting, no hit mesh. A hit on the armed
 * overview opens the black hole; only the cursor hints at it.
 */
export function SunGate() {
  const gl = useThree((state) => state.gl);
  const get = useThree((state) => state.get);
  /** The sun's hit circle in canvas CSS pixels, as of the last frame. */
  const circle = useRef({ x: 0, y: 0, hitR: 0, onScreen: false });
  /** Last mouse position over the canvas, for the hover cursor. */
  const pointer = useRef<Point | null>(null);
  const cursor = useRef("");

  useEffect(() => {
    const canvas = gl.domElement;
    let press: (Point & { id: number }) | null = null;
    const local = (event: PointerEvent): Point => {
      const { left, top } = get().size;
      return { x: event.clientX - left, y: event.clientY - top };
    };
    const onDown = (event: PointerEvent) => {
      press = event.isPrimary && event.button === 0 ? { id: event.pointerId, ...local(event) } : null;
    };
    const onUp = (event: PointerEvent) => {
      const start = press;
      press = null;
      if (!start || start.id !== event.pointerId) {
        return;
      }
      const at = local(event);
      const sun = circle.current;
      if (
        sun.onScreen &&
        Math.hypot(at.x - start.x, at.y - start.y) <= CLICK_SLOP_PX &&
        Math.hypot(at.x - sun.x, at.y - sun.y) <= sun.hitR
      ) {
        useSiteStore.getState().openBlackHole("sun");
      }
    };
    const onCancel = () => {
      press = null;
    };
    const onMove = (event: PointerEvent) => {
      pointer.current = event.pointerType === "mouse" ? local(event) : null;
    };
    const onLeave = () => {
      pointer.current = null;
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.style.cursor = "";
      cursor.current = "";
    };
  }, [gl, get]);

  useFrame(({ camera, size }) => {
    // CameraDirector aims the camera this frame; its matrices catch up at render.
    camera.updateMatrixWorld();
    projected.set(0, 0, 0).project(camera);
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 50;
    const r = projectedRadiusPx(BODY_MAP.sun.radius, camera.position.length(), fov, size.height);
    const sun = circle.current;
    sun.x = ((projected.x + 1) / 2) * size.width;
    sun.y = ((1 - projected.y) / 2) * size.height;
    sun.hitR = sunHitRadiusPx(r);
    sun.onScreen = Math.abs(projected.z) < 1;

    const state = useSiteStore.getState();
    const armed = sunArmed(state);
    const hovered = pointer.current;
    const next =
      armed && sun.onScreen && hovered && Math.hypot(hovered.x - sun.x, hovered.y - sun.y) <= sun.hitR
        ? "pointer"
        : "";
    if (next !== cursor.current) {
      cursor.current = next;
      gl.domElement.style.cursor = next;
    }

    // Test hook: UI tests find, click, and follow the sun through this.
    const resting =
      singularity.collapse.value === 0 &&
      singularity.horizon.value === 0 &&
      singularity.disk.value === 0 &&
      singularity.infall.value === 0;
    computeBodyPosition("earth", earth).project(camera);
    (window as unknown as { __sun?: unknown }).__sun = {
      x: sun.x + size.left,
      y: sun.y + size.top,
      r,
      hitR: sun.hitR,
      armed,
      phase:
        state.blackHole === "collapsing"
          ? "collapsing"
          : state.blackHole === "open"
            ? "collapsed"
            : resting
              ? "idle"
              : "restoring",
      progress: singularity.collapse.value,
      infall: singularity.infall.value,
      earth: {
        x: ((earth.x + 1) / 2) * size.width + size.left,
        y: ((1 - earth.y) / 2) * size.height + size.top,
      },
    };
  });

  return null;
}
