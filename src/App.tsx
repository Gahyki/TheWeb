import { Canvas, useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { Component, useEffect, useRef, type ReactNode } from "react";
import { MOBILE_MEDIA_QUERY, REDUCED_MOTION_MEDIA_QUERY } from "./mediaQueries";
import { VIEW_PATHS, VIEW_TITLES, viewFromPath } from "./router";
import { BODY_ORDER } from "./scene/config";
import { medianPeriod, shouldRender, vsyncsPerRender } from "./scene/framePacing";
import { perfState } from "./scene/perfBridge";
import { dprLevels, maxDprFor } from "./scene/renderScale";
import { DETERMINISTIC } from "./scene/registry";
import { scrollPose } from "./scene/scrollBridge";
import { SolarSystem } from "./scene/SolarSystem";
import { useSiteStore } from "./state/store";
import { Chrome } from "./ui/Chrome";
import { SectionPanel } from "./ui/SectionPanel";

function useRouterSync() {
  useEffect(() => {
    const unsubscribe = useSiteStore.subscribe((state, previous) => {
      if (state.view !== previous.view) {
        // Compare views, not raw paths: a non-canonical URL (e.g. /contact/)
        // must not trigger a push after Back, which would kill forward
        // history mid-traversal.
        if (viewFromPath(window.location.pathname) !== state.view) {
          // Scrolling through sections rewrites the URL without flooding
          // history; clicks and keys still create real entries.
          if (state.viewSource === "scroll") {
            window.history.replaceState({}, "", VIEW_PATHS[state.view]);
          } else {
            window.history.pushState({}, "", VIEW_PATHS[state.view]);
          }
        }
        document.title = VIEW_TITLES[state.view];
      }
    });
    const onPopState = () => {
      useSiteStore.getState().navigate(viewFromPath(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    document.title = VIEW_TITLES[useSiteStore.getState().view];
    return () => {
      unsubscribe();
      window.removeEventListener("popstate", onPopState);
    };
  }, []);
}

function useMediaFlags() {
  useEffect(() => {
    const mobileQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const motionQuery = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY);
    const apply = () => {
      useSiteStore.getState().setFlags({
        isMobile: mobileQuery.matches,
        reducedMotion: motionQuery.matches,
      });
    };
    apply();
    mobileQuery.addEventListener("change", apply);
    motionQuery.addEventListener("change", apply);
    return () => {
      mobileQuery.removeEventListener("change", apply);
      motionQuery.removeEventListener("change", apply);
    };
  }, []);
}

function useKeyboardNavigation() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useSiteStore.getState();
      const target = event.target instanceof Element ? event.target : null;
      // Never steal keys from inside a form (Escape must not nuke a
      // half-written contact message, even from the Send button).
      if (target?.closest("form") || target?.closest("[data-sheet]")) {
        return;
      }
      const tag = target?.tagName ?? "";

      if (event.key === "Escape") {
        if (state.view !== "overview") {
          event.preventDefault();
          state.navigate("overview");
        }
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Enter") {
        return;
      }
      if (event.key === "Enter" && (tag === "BUTTON" || tag === "A")) {
        return;
      }

      const direction = event.key === "ArrowLeft" ? -1 : 1;
      if (state.view === "overview") {
        if (event.key === "Enter") {
          if (state.highlight) {
            state.navigate(state.highlight);
          }
          return;
        }
        const index = state.highlight ? BODY_ORDER.indexOf(state.highlight) : -1;
        const next = BODY_ORDER[(index + direction + BODY_ORDER.length) % BODY_ORDER.length];
        state.setHighlight(next);
        event.preventDefault();
      } else if (event.key !== "Enter") {
        const index = BODY_ORDER.indexOf(state.view);
        state.navigate(BODY_ORDER[(index + direction + BODY_ORDER.length) % BODY_ORDER.length]);
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

/**
 * Caps the render loop on whole vsyncs of the measured display period, so
 * high-refresh displays (144Hz+) don't render every vsync for no visual
 * gain — and never at a fractional rate, which judders (see framePacing).
 * Settled views are near-static (sim at 3% speed, only slow shader
 * breathing), so idle paces at or below idleFps; flights and scrubs get
 * the divisor nearest activeFps.
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
      const active =
        useSiteStore.getState().moving || (scrollPose.p > 0.001 && scrollPose.p < 0.999);
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

/**
 * Adaptive quality: steps dpr down only while this machine keeps missing
 * FrameCap's target (and back up once there is sustained headroom) —
 * trading a little line sharpness for smoothness exactly where frames are
 * already dropping. Capable hardware never leaves the top level. Every
 * setup has steps (down to MIN_DPR), including 1x displays. Stepping is
 * disabled in deterministic mode so visual baselines can't race a change.
 */
/** Device ratio capped per device class and by the backing-store budget. */
function startingDpr(): number {
  const ceiling = window.matchMedia(MOBILE_MEDIA_QUERY).matches ? 1.5 : 2;
  return maxDprFor(window.devicePixelRatio, window.innerWidth, window.innerHeight, ceiling);
}

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

/**
 * Contains scene failures (most commonly: no WebGL support) so the HTML
 * overlay — tabs and full section content — keeps working without the 3D.
 */
class SceneErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("3D scene unavailable; continuing without it.", error);
    useSiteStore.getState().enterDegradedMode();
  }

  render() {
    if (this.state.failed) {
      return (
        <p className="absolute inset-x-0 bottom-10 text-center text-[11px] uppercase tracking-[0.3em] text-white/30">
          This browser can’t render the 3D system — the sections above still work.
        </p>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  useRouterSync();
  useMediaFlags();
  useKeyboardNavigation();

  return (
    <div className="fixed inset-0 bg-black text-white">
      <div className="absolute inset-0" aria-hidden="true">
        <SceneErrorBoundary>
          <Canvas
            dpr={startingDpr()}
            camera={{ fov: 50, near: 0.1, far: 500, position: [0, 28, 20] }}
            gl={{ antialias: true }}
            frameloop="never"
            onCreated={({ gl }) => {
              gl.setClearColor("#000000");
            }}
          >
            <FrameCap activeFps={90} idleFps={45} />
            <AdaptiveQuality />
            <PerfProbe />
            <SolarSystem />
          </Canvas>
        </SceneErrorBoundary>
      </div>
      <SectionPanel />
      <Chrome />
    </div>
  );
}
