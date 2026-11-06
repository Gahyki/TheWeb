import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  CanvasTexture,
  MathUtils,
  PerspectiveCamera,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import type { BodyId } from "../state/store";
import { useSiteStore } from "../state/store";
import { BODY_MAP, BODY_ORDER } from "./config";
import { computeBodyPosition } from "./registry";
import { scrollPose } from "./scrollBridge";

const position = new Vector3();
const projected = new Vector3();

/** Test hook: UI tests assert the label's lifecycle and centering. */
function writeLabelHook(
  opacity: number,
  settled: boolean,
  name: string | null,
  screenDeltaX: number | null,
) {
  (
    window as unknown as {
      __label?: { opacity: number; settled: boolean; name: string | null; screenDeltaX: number | null };
    }
  ).__label = { opacity, settled, name, screenDeltaX };
}

type Label = { texture: CanvasTexture; aspect: number };

function makeLabel(text: string): Label {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const font = "600 48px ui-monospace, SFMono-Regular, Menlo, monospace";
  if (!context) {
    return { texture: new CanvasTexture(canvas), aspect: 1 };
  }
  const spacing = 20;
  context.font = font;
  // letterSpacing needs setting before measureText where supported.
  context.letterSpacing = `${spacing}px`;
  const upper = text.toUpperCase();
  // measureText includes trailing letter-spacing after the last glyph;
  // without compensating, the glyph run sits off the texture's midline
  // and the sprite hangs visibly off the sphere's center.
  const glyphWidth = Math.ceil(context.measureText(upper).width) - spacing;
  // Symmetric padding: the glyph run's center IS the texture's center, so
  // the sprite can be placed directly on the planet's center.
  const pad = 12;
  canvas.width = glyphWidth + pad * 2;
  canvas.height = 72;
  context.font = font;
  context.letterSpacing = `${spacing}px`;
  context.textBaseline = "middle";
  context.fillStyle = "rgba(255, 255, 255, 0.9)";
  context.fillText(upper, pad, canvas.height / 2);
  const texture = new CanvasTexture(canvas);
  return { texture, aspect: canvas.width / canvas.height };
}

/**
 * The planet's name as a billboard sprite just below the sphere, rendered
 * by the same camera as the planet — so it is always exactly centered
 * under it, riding orbits, scrubs, and flights for free.
 */
export function PlanetCaption() {
  const labels = useMemo(() => {
    const map = new Map<BodyId, Label>();
    for (const id of BODY_ORDER) {
      map.set(id, makeLabel(BODY_MAP[id].name));
    }
    return map;
  }, []);

  useEffect(() => {
    return () => {
      for (const label of labels.values()) {
        label.texture.dispose();
      }
    };
  }, [labels]);

  const spriteRef = useRef<Sprite>(null);
  const materialRef = useRef<SpriteMaterial>(null);
  const shownFor = useRef<BodyId | null>(null);
  /** Seconds the visible-conditions have continuously held. */
  const settledFor = useRef(0);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  /** Apparent label height in CSS pixels — constant for every planet. */
  const LABEL_PX = 16;

  useFrame((_, delta) => {
    const sprite = spriteRef.current;
    const material = materialRef.current;
    if (!sprite || !material) {
      return;
    }
    const { focused, uiVisible, view, moving } = useSiteStore.getState();
    // During a camera flight (moving) or a mid-gap scrub the label cuts
    // out instantly. Fading back in waits out the camera's settle glide —
    // a label appearing mid-glide spotlights that residual motion.
    const inScrub = scrollPose.p > 0.02 && scrollPose.p < 0.98;
    const settled = focused !== null && uiVisible && view !== "overview" && !moving && !inScrub;
    // Clamped: a stall must not fast-forward the delay, or the label
    // lands right on top of the post-stall frame.
    settledFor.current = settled ? settledFor.current + Math.min(delta, 0.05) : 0;
    if (!settled) {
      material.opacity = 0;
    } else if (settledFor.current > 0.45) {
      material.opacity += (0.85 - material.opacity) * Math.min(1, delta * 6);
    }
    if (!focused) {
      writeLabelHook(material.opacity, settled, null, null);
      return;
    }
    if (shownFor.current !== focused) {
      shownFor.current = focused;
      const label = labels.get(focused);
      if (label) {
        material.map = label.texture;
        material.needsUpdate = true;
      }
    }
    const def = BODY_MAP[focused];
    computeBodyPosition(focused, position);
    sprite.position.set(position.x, position.y - def.radius * 1.55, position.z);

    // Constant on-screen size regardless of planet or zoom, like the
    // original fixed-pixel label: world height from camera distance.
    const aspect = labels.get(focused)?.aspect ?? 1;
    const fov = camera instanceof PerspectiveCamera ? camera.fov : 50;
    const distance = camera.position.distanceTo(sprite.position);
    const worldPerPixel =
      (2 * distance * Math.tan(MathUtils.degToRad(fov) / 2)) / size.height;
    const height = LABEL_PX * worldPerPixel;
    sprite.scale.set(height * aspect, height, 1);

    // Horizontal screen distance between the planet's center and the
    // label's midpoint — the centering contract the UI tests assert.
    projected.copy(sprite.position).project(camera);
    const labelNdcX = projected.x;
    const planetNdcX = position.project(camera).x;
    writeLabelHook(
      material.opacity,
      settled,
      BODY_MAP[focused].name,
      ((planetNdcX - labelNdcX) * size.width) / 2,
    );
  });

  return (
    <sprite ref={spriteRef} renderOrder={10}>
      <spriteMaterial
        ref={materialRef}
        transparent
        opacity={0}
        depthWrite={false}
        depthTest={false}
      />
    </sprite>
  );
}
