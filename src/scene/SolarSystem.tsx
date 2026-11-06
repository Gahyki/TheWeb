import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { useSiteStore } from "../state/store";
import { Body } from "./Body";
import { BODIES } from "./config";
import { circleGeometry } from "./geometry";
import { DETERMINISTIC, sim, SIM_RAMP_RATE, uTime } from "./registry";
import { makeLineMaterial } from "./shaders";
import { CameraDirector } from "./CameraDirector";
import { PlanetCaption } from "./PlanetCaption";
import { Stars } from "./Stars";

const noRaycast = () => null;

function OrbitPaths({ density }: { density: number }) {
  const orbits = useMemo(() => {
    return BODIES.filter((def) => def.orbitRadius > 0).map((def) => ({
      id: def.id,
      geometry: circleGeometry(def.orbitRadius, Math.round(220 * density)),
      material: makeLineMaterial({ color: "#cfeaff", opacity: 0.18, breath: 0.14 }),
    }));
  }, [density]);

  useEffect(() => {
    return () => {
      for (const orbit of orbits) {
        orbit.geometry.dispose();
        orbit.material.dispose();
      }
    };
  }, [orbits]);

  return (
    <>
      {orbits.map((orbit) => (
        <lineLoop
          key={orbit.id}
          geometry={orbit.geometry}
          material={orbit.material}
          raycast={noRaycast}
        />
      ))}
    </>
  );
}

export function SolarSystem() {
  const isMobile = useSiteStore((state) => state.isMobile);
  const reducedMotion = useSiteStore((state) => state.reducedMotion);
  const density = isMobile ? 0.6 : 1;

  // Advance the shared clocks first (this component mounts first,
  // so its frame callback runs before every body's).
  useFrame((_, delta) => {
    // Settled on a section, orbital motion winds down: the camera rides
    // the focused planet, so every bit of orbit rotates the whole sky
    // behind it — depth turns that into conspicuous background drift the
    // moment the label gives the eye a fixed anchor. The overview and
    // transitions keep full speed.
    // Near-standstill, and settled fast (τ≈140ms): the wind-down must be
    // DONE before the label's 0.45s fade-in, or its rate change is itself
    // the visible background motion at label time.
    const { view, moving } = useSiteStore.getState();
    const targetSpeed = reducedMotion ? 0.05 : view !== "overview" && !moving ? 0.03 : 1;
    sim.speed += (targetSpeed - sim.speed) * Math.min(1, Math.min(delta, 0.05) * SIM_RAMP_RATE);

    const clamped = Math.min(delta, 0.05);
    // Both clocks freeze in deterministic mode: orbital positions and
    // breathing/twinkle phases must not depend on how many frames a run
    // happened to render before the screenshot.
    if (!DETERMINISTIC) {
      sim.t += clamped * sim.speed;
      uTime.value += clamped;
    }
  });

  return (
    <>
      <Stars count={isMobile ? 1400 : 3200} />
      <OrbitPaths density={density} />
      {BODIES.map((def) => (
        <Body key={def.id} def={def} density={density} />
      ))}
      <CameraDirector />
      <PlanetCaption />
      {!isMobile && !reducedMotion && (
        // 4×MSAA (default 8) halves the multisample buffer bandwidth.
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur intensity={0.55} luminanceThreshold={0.18} luminanceSmoothing={0.35} />
        </EffectComposer>
      )}
    </>
  );
}
