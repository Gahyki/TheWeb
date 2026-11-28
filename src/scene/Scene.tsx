import { Canvas, useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { useEffect, useRef } from "react";
import { MOBILE_MEDIA_QUERY } from "../mediaQueries";
import { useSiteStore } from "../state/store";
import { medianPeriod, shouldRender, vsyncsPerRender } from "./framePacing";
import { perfState } from "./perfBridge";
import { dprLevels, maxDprFor } from "./renderScale";
import { DETERMINISTIC } from "./registry";
import { scrollPose } from "./scrollBridge";
import { SolarSystem } from "./SolarSystem";

/**
 * Caps the render loop on whole vsyncs of the measured display period, so
 * high-refresh displays (144Hz+) don't render every vsync for no visual
 * gain — and never at a fractional rate, which judders (see framePacing).
 * Settled views are near-static (sim at 3% speed, only slow shader
 * breathing), so idle paces at or below idleFps; flights, scrubs, and the
 * sun's collapse get the divisor nearest activeFps.
 */
function FrameCap({ activeFps, idleFps }: { activeFps: number; idleFps: number }) {
  const advance = useThree((state) => state.advance);
  const setFrameloop = useThree((state) => state.setFrameloop);

  useEffect(() => {
    setFrameloop("never");
    let lastRender = 0;
    let previous = 0;
    let period = 1000 / 60;
    const samples: number[] = [];
    let handle = 0;
    const loop = (time: number) => {
      handle = requestAnimationFrame(loop);
      // Median vsync period: robust to jitter and dropped frames; gaps
      // outside (2ms, 50ms) are hidden tabs or stalls, not the display.
      const sample = time - previous;
      previous = time;
      if (sample > 2 && sample < 50) {
        samples.push(sample);
        if (samples.length > 60) {
          samples.shift();
        }
        period = medianPeriod(samples, period);
      }
      const { moving, blackHole } = useSiteStore.getState();
      const active =
        moving || blackHole === "collapsing" || (scrollPose.p > 0.001 && scrollPose.p < 0.999);
      const vsyncs = vsyncsPerRender(period, active ? activeFps : idleFps, active);
      perfState.interval = vsyncs * period;
      perfState.period = period;
      if (shouldRender(time - lastRender, vsyncs, period)) {
        lastRender = time;
        // Sample animation state at the render's own timestamp. Manual
        // tick keeps GSAP's lag smoothing (stall protection) intact.
        gsap.ticker.tick();
        advance(time / 1000);
      }
    };
    handle = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(handle);
      setFrameloop("always");
    };
  }, [advance, setFrameloop, activeFps, idleFps]);

  return null;
}

/** Device ratio capped per device class and by the backing-store budget. */
function startingDpr(): number {
  const ceiling = window.matchMedia(MOBILE_MEDIA_QUERY).matches ? 1.5 : 2;
  return maxDprFor(window.devicePixelRatio, window.innerWidth, window.innerHeight, ceiling);
}

/**
 * Adaptive quality: steps dpr down only while this machine keeps missing
 * FrameCap's target (and back up once there is sustained headroom) —
 * trading a little line sharpness for smoothness exactly where frames are
 * already dropping. Capable hardware never leaves the top level. Every
 * setup has steps (down to MIN_DPR), including 1x displays. Stepping is
 * disabled in deterministic mode so visual baselines can't race a change.
 */
function AdaptiveQuality() {
  const setDpr = useThree((state) => state.setDpr);
  const levels = useRef<number[]>([]);
  const level = useRef(0);
  const slowFrames = useRef(0);
  const fastFrames = useRef(0);
  const cooldownUntil = useRef(0);

  useEffect(() => {
    // Rebuilt on resize: the pixel budget depends on the CSS viewport, and
    // moving the window to another monitor can change devicePixelRatio.
    const rebuild = () => {
      levels.current = dprLevels(startingDpr());
      level.current = Math.min(level.current, levels.current.length - 1);
      setDpr(levels.current[level.current]);
    };
    rebuild();
    window.addEventListener("resize", rebuild);
    return () => window.removeEventListener("resize", rebuild);
  }, [setDpr]);

  useFrame((_, delta) => {
    if (DETERMINISTIC || levels.current.length < 2) {
      return;
    }
    // Target is FrameCap's real interval (whole vsyncs of the measured
    // period), so a 60Hz display under a 90fps cap is judged against
    // 16.7ms — frames there can count as fast and dpr can recover.
    const target = perfState.interval / 1000;
    if (delta > target * 1.6) {
      slowFrames.current += 1;
      fastFrames.current = 0;
    } else {
      fastFrames.current += 1;
      if (delta < target * 1.25) {
        slowFrames.current = Math.max(0, slowFrames.current - 2);
      }
    }
    const now = performance.now();
    if (now < cooldownUntil.current) {
      return;
    }
    if (slowFrames.current > 60 && level.current < levels.current.length - 1) {
      level.current += 1;
      setDpr(levels.current[level.current]);
      cooldownUntil.current = now + 4_000;
      slowFrames.current = 0;
      fastFrames.current = 0;
    } else if (fastFrames.current > 900 && level.current > 0) {
      level.current -= 1;
      setDpr(levels.current[level.current]);
      cooldownUntil.current = now + 4_000;
      fastFrames.current = 0;
    }
  });

  return null;
}

/**
 * Perf probe: publishes the renderer's own statistics (previous frame's
 * totals — info auto-resets at render start) plus FrameCap's chosen
 * interval. Perf tests assert budgets and pacing against these, which are
 * deterministic regardless of machine speed.
 */
function PerfProbe() {
  const gl = useThree((state) => state.gl);
  useFrame(() => {
    (
      window as unknown as {
        __perf?: {
          calls: number;
          geometries: number;
          textures: number;
          interval: number;
          period: number;
        };
      }
    ).__perf = {
      calls: gl.info.render.calls,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
      interval: perfState.interval,
      period: perfState.period,
    };
  });
  return null;
}

/** The 3D canvas and its render loop around the solar system. */
export function Scene() {
  return (
    <Canvas
      dpr={startingDpr()}
      camera={{ fov: 50, near: 0.1, far: 500, position: [0, 28, 20] }}
      gl={{ antialias: true }}
      frameloop="never"
      // A quick double tap on the sun must not zoom the page on iOS.
      style={{ touchAction: "manipulation" }}
      onCreated={({ gl }) => {
        gl.setClearColor("#000000");
      }}
    >
      <FrameCap activeFps={90} idleFps={45} />
      <AdaptiveQuality />
      <PerfProbe />
      <SolarSystem />
    </Canvas>
  );
}
