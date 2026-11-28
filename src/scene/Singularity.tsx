import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { Group } from "three";
import { MeshBasicMaterial, SphereGeometry } from "three";
import { useSiteStore } from "../state/store";
import { PHOTON_RING_RADIUS } from "./config";
import { circleGeometry, spiralArmGeometry } from "./geometry";
import { DETERMINISTIC, singularity } from "./registry";
import { makeLineMaterial, makeTrailMaterial } from "./shaders";

const noRaycast = () => null;

/** Accretion-disk rings: radius and faint base/glow, dimmer outward. */
const DISK_RINGS = [
  { radius: 1.35, base: 0.12, glow: 0.55 },
  { radius: 1.9, base: 0.09, glow: 0.42 },
  { radius: 2.65, base: 0.06, glow: 0.3 },
];

/** Disk angular speed at the innermost ring (rad/s); outer rings lag. */
const DISK_SPEED = 0.9;

/**
 * The black hole the sun collapses into: a photon ring and a faint spiral
 * accretion disk in line work, around a pure-black event horizon that
 * hides whatever lies behind it. Invisible (no draw calls) at rest. Mount
 * it after every other scene material so det-mode shader phases keep
 * their order.
 */
export function Singularity() {
  const isMobile = useSiteStore((state) => state.isMobile);
  const ringRef = useRef<Group>(null);
  const diskRef = useRef<Group>(null);
  const armsRef = useRef<Group>(null);

  const assets = useMemo(() => {
    const density = isMobile ? 0.6 : 1;
    const ringGeometry = circleGeometry(1, Math.round(160 * density));
    // Opaque and depth-writing: the additive lines and stars behind it fail
    // the depth test. Black adds no light, so it reads as empty space.
    const horizonGeometry = new SphereGeometry(1, 48, 24);
    const horizonMaterial = new MeshBasicMaterial({ color: 0x000000 });
    const ringMaterial = makeLineMaterial({
      color: "#fff6dc",
      opacity: 0.8,
      breath: 0.05,
      reveal: singularity.horizon,
    });
    const haloMaterial = makeLineMaterial({
      color: "#fff6dc",
      opacity: 0.25,
      breath: 0.05,
      reveal: singularity.horizon,
    });
    const diskGeometry = circleGeometry(1, Math.round(160 * density), true);
    const diskMaterials = DISK_RINGS.map(({ base, glow }, index) => {
      const material = makeTrailMaterial("#fff0c4", singularity.disk);
      material.uniforms.uBase.value = base;
      material.uniforms.uGlow.value = glow;
      material.uniforms.uMoonAngle.value = index * 2.1;
      return material;
    });
    // Two arms falling in: lit at the inner end, fading outward.
    const armGeometry = spiralArmGeometry(1.0, 3.2, Math.PI * 1.3, Math.round(96 * density));
    const armMaterial = makeTrailMaterial("#fff0c4", singularity.disk);
    armMaterial.uniforms.uBase.value = 0.05;
    armMaterial.uniforms.uGlow.value = 0.4;
    // Just ahead of the arm's start, so only the trail (not the head) lights it.
    armMaterial.uniforms.uMoonAngle.value = 0.05;
    return {
      horizonGeometry,
      horizonMaterial,
      ringGeometry,
      ringMaterial,
      haloMaterial,
      diskGeometry,
      diskMaterials,
      armGeometry,
      armMaterial,
    };
  }, [isMobile]);

  useEffect(() => {
    return () => {
      assets.horizonGeometry.dispose();
      assets.horizonMaterial.dispose();
      assets.ringGeometry.dispose();
      assets.ringMaterial.dispose();
      assets.haloMaterial.dispose();
      assets.diskGeometry.dispose();
      for (const material of assets.diskMaterials) {
        material.dispose();
      }
      assets.armGeometry.dispose();
      assets.armMaterial.dispose();
    };
  }, [assets]);

  useFrame((_, delta) => {
    const horizon = singularity.horizon.value;
    const disk = singularity.disk.value;
    const ring = ringRef.current;
    if (ring) {
      ring.visible = horizon > 0.002;
      // Grows out of the vanishing sun.
      ring.scale.setScalar(0.15 + 0.85 * Math.min(horizon, 1));
    }
    if (diskRef.current) {
      diskRef.current.visible = disk > 0.002;
    }
    if (disk <= 0.002 || DETERMINISTIC) {
      return;
    }
    const step =
      Math.min(delta, 0.05) * DISK_SPEED * (useSiteStore.getState().reducedMotion ? 0.15 : 1);
    // Orbit-like: inner rings turn faster.
    DISK_RINGS.forEach(({ radius }, index) => {
      const angle = assets.diskMaterials[index].uniforms.uMoonAngle;
      angle.value = (angle.value + step * (DISK_RINGS[0].radius / radius) ** 1.5) % (Math.PI * 2);
    });
    if (armsRef.current) {
      // Negative: three's +y rotation turns the XZ angle the other way.
      armsRef.current.rotation.y -= step * 0.5;
    }
  });

  return (
    <>
      <group ref={ringRef} visible={false}>
        <mesh
          geometry={assets.horizonGeometry}
          material={assets.horizonMaterial}
          scale={PHOTON_RING_RADIUS * 0.97}
          raycast={noRaycast}
        />
        <lineLoop
          geometry={assets.ringGeometry}
          material={assets.ringMaterial}
          scale={PHOTON_RING_RADIUS}
          raycast={noRaycast}
        />
        <lineLoop
          geometry={assets.ringGeometry}
          material={assets.haloMaterial}
          scale={PHOTON_RING_RADIUS * 1.08}
          raycast={noRaycast}
        />
      </group>
      <group ref={diskRef} visible={false}>
        {DISK_RINGS.map(({ radius }, index) => (
          <lineLoop
            key={radius}
            geometry={assets.diskGeometry}
            material={assets.diskMaterials[index]}
            scale={radius}
            raycast={noRaycast}
          />
        ))}
        <group ref={armsRef}>
          <lineSegments geometry={assets.armGeometry} material={assets.armMaterial} raycast={noRaycast} />
          <lineSegments
            geometry={assets.armGeometry}
            material={assets.armMaterial}
            rotation-y={Math.PI}
            raycast={noRaycast}
          />
        </group>
      </group>
    </>
  );
}
