import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { BufferAttribute, BufferGeometry, MathUtils } from "three";
import { useSiteStore } from "../state/store";
import { DETERMINISTIC, seededRandom } from "./registry";
import { makeStarMaterial } from "./shaders";

const noRaycast = () => null;

export function Stars({ count }: { count: number }) {
  const dpr = useThree((state) => state.viewport.dpr);

  const assets = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    // Own stream, not the shared one: the field must be identical in
    // deterministic mode even if this component remounts (count changes).
    const random = seededRandom(DETERMINISTIC ? 90001 : Math.random() * 2147483646 + 1);
    for (let i = 0; i < count; i += 1) {
      // Uniformly distributed shell far beyond the planets.
      const radius = MathUtils.lerp(70, 150, random());
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(MathUtils.lerp(-1, 1, random()));
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi);
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
      seeds[i] = random();
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("aSeed", new BufferAttribute(seeds, 1));
    const material = makeStarMaterial(dpr);
    return { geometry, material };
  }, [count, dpr]);

  useEffect(() => {
    return () => {
      assets.geometry.dispose();
      assets.material.dispose();
    };
  }, [assets]);

  useFrame(() => {
    const target = useSiteStore.getState().reducedMotion ? 0 : 0.45;
    assets.material.uniforms.uAmp.value = target;
  });

  return (
    <points
      geometry={assets.geometry}
      material={assets.material}
      raycast={noRaycast}
      frustumCulled={false}
    />
  );
}
