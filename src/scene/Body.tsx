import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { Group, ShaderMaterial } from "three";
import { MathUtils } from "three";
import { useSiteStore } from "../state/store";
import type { BodyDef, MoonDef } from "./config";
import { circleGeometry, gridSphereGeometry } from "./geometry";
import type { BodyReveals } from "./registry";
import { revealOf, sim } from "./registry";
import {
  makeFresnelMaterial,
  makeLineMaterial,
  makeMoonCoreMaterial,
  makeTrailMaterial,
} from "./shaders";

/** Non-interactive line work must never participate in pointer raycasts. */
const noRaycast = () => null;

/** The sun's brightness from any focused view — its own knob, tuned by eye. */
const SUN_RECEDE = 0.45;

/** How far bystanders (other bodies, orbit rings) recede on focus. */
export const BYSTANDER_DIM = 0.45;

/** Rate (1/s) at which focus dimming eases in and out. */
export const DIM_EASE_RATE = 3.5;

function Moon({ moon, reveals, density }: { moon: MoonDef; reveals: BodyReveals; density: number }) {
  const orbitRef = useRef<Group>(null);
  const moonRef = useRef<Group>(null);

  const assets = useMemo(() => {
    const orbitGeometry = circleGeometry(moon.orbitRadius, Math.round(160 * density), true);
    const trailMaterial = makeTrailMaterial("#d8f4ff", reveals.orbits);
    // Tiny moons (true-scale Phobos/Deimos/Rhea) read as pure points of
    // light — no grid worth drawing below ~0.02 world units.
    const hasGrid = moon.radius >= 0.02;
    const gridGeometry = hasGrid
      ? gridSphereGeometry(moon.radius, Math.max(5, Math.round(6 * density)), 4, 24)
      : null;
    const gridMaterial = hasGrid
      ? makeLineMaterial({
          color: "#eafaff",
          opacity: 0.6,
          breath: 0.08,
          reveal: reveals.moons,
        })
      : null;
    // Glow core scales with the moon so size ratios stay legible.
    const coreSize = Math.min(24, Math.max(9, 10 + moon.radius * 90));
    const coreMaterial = makeMoonCoreMaterial(reveals.moons, coreSize);
    const coreGeometry = circleGeometry(0, 1);
    return { orbitGeometry, trailMaterial, gridGeometry, gridMaterial, coreMaterial, coreGeometry };
  }, [moon, reveals, density]);

  useEffect(() => {
    return () => {
      assets.orbitGeometry.dispose();
      assets.trailMaterial.dispose();
      assets.gridGeometry?.dispose();
      assets.gridMaterial?.dispose();
      assets.coreMaterial.dispose();
      assets.coreGeometry.dispose();
    };
  }, [assets]);

  useFrame(() => {
    const angle = (moon.phase + sim.t * moon.speed) % (Math.PI * 2);
    moonRef.current?.position.set(
      Math.cos(angle) * moon.orbitRadius,
      0,
      Math.sin(angle) * moon.orbitRadius,
    );
    assets.trailMaterial.uniforms.uMoonAngle.value = angle;
    // Skip draw calls entirely while hidden in the overview.
    const visible = reveals.orbits.value > 0.002 || reveals.moons.value > 0.002;
    if (orbitRef.current) {
      orbitRef.current.visible = visible;
    }
  });

  return (
    <group ref={orbitRef} rotation={[moon.inclination, moon.phase, moon.inclination * 0.6]} visible={false}>
      <lineLoop geometry={assets.orbitGeometry} material={assets.trailMaterial} raycast={noRaycast} />
      <group ref={moonRef}>
        {assets.gridGeometry && assets.gridMaterial && (
          <lineSegments geometry={assets.gridGeometry} material={assets.gridMaterial} raycast={noRaycast} />
        )}
        <points geometry={assets.coreGeometry} material={assets.coreMaterial} raycast={noRaycast} />
      </group>
    </group>
  );
}

/**
 * Location indicator: the latitude parallel and longitude meridian through
 * a point on the surface, plus a glowing marker at their intersection.
 * Lives inside the planet's spin group, so it rotates with the body.
 */
function LocationMarker({
  radius,
  marker,
  boost,
  density,
}: {
  radius: number;
  marker: { lat: number; lon: number };
  boost: { value: number };
  density: number;
}) {
  const lat = MathUtils.degToRad(marker.lat);
  const lon = MathUtils.degToRad(marker.lon);

  const assets = useMemo(() => {
    const segments = Math.round(140 * density);
    const latGeometry = circleGeometry(Math.cos(lat) * radius, segments);
    const lonGeometry = circleGeometry(radius, segments);
    const lineMaterial = makeLineMaterial({
      color: "#9fe8ff",
      opacity: 0.55,
      breath: 0.3,
      boost,
    });
    const pointGeometry = circleGeometry(0, 1);
    const pointMaterial = makeMoonCoreMaterial(boost, 12);
    return { latGeometry, lonGeometry, lineMaterial, pointGeometry, pointMaterial };
  }, [radius, lat, density, boost]);

  useEffect(() => {
    return () => {
      assets.latGeometry.dispose();
      assets.lonGeometry.dispose();
      assets.lineMaterial.dispose();
      assets.pointGeometry.dispose();
      assets.pointMaterial.dispose();
    };
  }, [assets]);

  const surface = radius * 1.003;
  return (
    <group>
      <lineLoop
        geometry={assets.latGeometry}
        material={assets.lineMaterial}
        position-y={Math.sin(lat) * radius}
        raycast={noRaycast}
      />
      <group rotation-y={-lon}>
        <lineLoop
          geometry={assets.lonGeometry}
          material={assets.lineMaterial}
          rotation-x={Math.PI / 2}
          raycast={noRaycast}
        />
      </group>
      <points
        geometry={assets.pointGeometry}
        material={assets.pointMaterial}
        position={[
          Math.cos(lat) * Math.cos(lon) * surface,
          Math.sin(lat) * surface,
          Math.cos(lat) * Math.sin(lon) * surface,
        ]}
        raycast={noRaycast}
      />
    </group>
  );
}

export function Body({ def, density }: { def: BodyDef; density: number }) {
  const groupRef = useRef<Group>(null);
  const spinRef = useRef<Group>(null);
  const highlightLift = useRef(1);
  const fadeSmooth = useRef(1);
  /** Shared brightness uniform: keyboard-highlight lift × proximity fade. */
  const boost = useRef({ value: 1 }).current;
  const reveals = revealOf(def.id);
  const fresnelBase = def.id === "sun" ? 0.5 : 0.32;

  const assets = useMemo(() => {
    const gridGeometry = gridSphereGeometry(
      def.radius,
      Math.max(6, Math.round(def.meridians * density)),
      Math.max(4, Math.round(def.parallels * density)),
      Math.round(56 * density),
    );
    const gridMaterial = makeLineMaterial({ color: def.color, opacity: def.gridOpacity, boost });
    const fresnelMaterial = makeFresnelMaterial(def.color, fresnelBase);
    const ringGeometries = (def.rings ?? []).map((multiplier) =>
      circleGeometry(def.radius * multiplier, Math.round(200 * density)),
    );
    const ringMaterials = (def.rings ?? []).map((_, index) =>
      // Gentle falloff with a floor so dense ring bands keep every circle
      // visible instead of fading the outer ones to nothing. Bright enough
      // that the body's tint still reads as color, not gray.
      makeLineMaterial({
        color: def.color,
        opacity: Math.max(0.22, 0.44 - index * 0.03),
        breath: 0.1,
        boost,
      }),
    );
    return { gridGeometry, gridMaterial, fresnelMaterial, ringGeometries, ringMaterials };
  }, [def, density, boost, fresnelBase]);

  useEffect(() => {
    return () => {
      assets.gridGeometry.dispose();
      assets.gridMaterial.dispose();
      assets.fresnelMaterial.dispose();
      for (const geometry of assets.ringGeometries) {
        geometry.dispose();
      }
      for (const material of assets.ringMaterials) {
        material.dispose();
      }
    };
  }, [assets]);

  useFrame(({ camera }, delta) => {
    const group = groupRef.current;
    if (group) {
      const angle = def.phase + sim.t * def.orbitSpeed;
      group.position.set(
        Math.cos(angle) * def.orbitRadius,
        0,
        Math.sin(angle) * def.orbitRadius,
      );
    }
    if (spinRef.current) {
      spinRef.current.rotation.y += def.spinSpeed * delta * sim.speed;
    }
    const state = useSiteStore.getState();
    const lift = state.highlight === def.id ? 1.75 : 1;
    highlightLift.current = MathUtils.lerp(highlightLift.current, lift, Math.min(1, delta * 7));

    // While a body is focused, every other body recedes: a global dim keeps
    // them quiet midground, and anything that would loom large in frame
    // (big apparent size = radius over distance) dissolves entirely.
    // The sun anchors every focused view: it recedes only gently and never
    // dissolves.
    let fade = 1;
    if (state.view !== "overview" && state.view !== def.id && group) {
      if (def.id === "sun") {
        // The sun recedes to a fixed soft glow from every focused view,
        // but never dissolves like other bystander bodies.
        fade = SUN_RECEDE;
      } else {
        const distance = Math.max(camera.position.distanceTo(group.position), 0.001);
        const ratio = def.radius / distance;
        const t = MathUtils.clamp((ratio - 0.05) / 0.08, 0, 1);
        fade = BYSTANDER_DIM * (1 - t * t * (3 - 2 * t));
      }
    }
    // Ease toward the target so focus changes never pop brightness.
    fadeSmooth.current = MathUtils.lerp(fadeSmooth.current, fade, Math.min(1, delta * DIM_EASE_RATE));
    // A dissolved bystander still rasterizes a near-fullscreen wireframe at
    // alpha ~0; skip its draw calls entirely below the perception floor.
    if (group) {
      group.visible = fadeSmooth.current > 0.02;
    }
    boost.value = highlightLift.current * fadeSmooth.current;
    (assets.fresnelMaterial as ShaderMaterial).uniforms.uIntensity.value =
      fresnelBase * fadeSmooth.current;
  });

  return (
    <group ref={groupRef}>
      <group ref={spinRef}>
        <lineSegments geometry={assets.gridGeometry} material={assets.gridMaterial} raycast={noRaycast} />
        {def.marker && (
          <LocationMarker radius={def.radius} marker={def.marker} boost={boost} density={density} />
        )}
      </group>
      <mesh material={assets.fresnelMaterial} raycast={noRaycast}>
        <sphereGeometry args={[def.radius * 0.985, 36, 24]} />
      </mesh>
      {def.rings && (
        <group rotation={[def.ringTilt ?? 0.4, 0, (def.ringTilt ?? 0.4) * 0.4]}>
          {assets.ringGeometries.map((geometry, index) => (
            <lineLoop
              key={(def.rings as number[])[index]}
              geometry={geometry}
              material={assets.ringMaterials[index]}
              raycast={noRaycast}
            />
          ))}
        </group>
      )}
      {def.moons.map((moon) => (
        <Moon key={moon.name} moon={moon} reveals={reveals} density={density} />
      ))}
    </group>
  );
}
