import { useFrame, useThree } from "@react-three/fiber";
import gsap from "gsap";
import { useEffect, useRef } from "react";
import { MathUtils, Vector3 } from "three";
import type { BodyId } from "../state/store";
import { useSiteStore } from "../state/store";
import { BODY_MAP, FOCUS_ELEVATION, OVERVIEW_CAMERA } from "./config";
import { computeBodyPosition, revealOf, sim, SIM_RAMP_RATE } from "./registry";
import { scrollPose } from "./scrollBridge";

const ORIGIN = new Vector3(0, 0, 0);
const TAU = Math.PI * 2;

/**
 * Azimuth that places the camera on the planet's outward side, looking back
 * toward the system center — so the Sun sits small and distant behind the
 * body instead of photobombing the frame at close range.
 */
function outwardAzimuth(id: BodyId, aheadSimSeconds = 0): number {
  const def = BODY_MAP[id];
  // The sun's projected screen offset scales with orbit/(orbit + camera
  // distance), so a flat bearing constant reads wider on Mars (far orbit,
  // close camera) than on Earth. Normalize per planet to Earth's ratio so
  // the sun lands in the same screen spot from every section. The sun
  // itself has no orbit — any bearing works; keep the base constant.
  let offset = 0.35;
  if (def.orbitRadius > 0) {
    const earth = BODY_MAP.earth;
    const reference = earth.orbitRadius / (earth.orbitRadius + fitDistance("earth"));
    const ratio = def.orbitRadius / (def.orbitRadius + fitDistance(id));
    offset = 0.35 * (reference / ratio);
  }
  // Predict ahead: a flight that aims at the azimuth of launch time lands
  // behind the still-orbiting planet and visibly corrects on arrival.
  return def.phase + (sim.t + aheadSimSeconds) * def.orbitSpeed - offset;
}




/**
 * Focus distance, widened on narrow screens so the whole body — Saturn's
 * rings included — fits the portrait frame.
 */
function focusElevationOf(id: BodyId): number {
  return BODY_MAP[id].focusElevation ?? FOCUS_ELEVATION;
}

function fitDistance(id: BodyId): number {
  return BODY_MAP[id].focusDistance * (useSiteStore.getState().isMobile ? 2.1 : 1);
}

/**
 * Sim-time the orbits will advance during a flight of this real duration.
 * sim.speed ramps toward 1 (rate SIM_RAMP_RATE) once a flight starts, so
 * predicting with the launch-time speed misses the landing: the sun ends
 * off its centered-behind-the-planet arrangement and the settle glide
 * visibly pivots it into place.
 */
function simAdvanceDuring(durationSeconds: number): number {
  return (
    durationSeconds -
    ((1 - sim.speed) * (1 - Math.exp(-SIM_RAMP_RATE * durationSeconds))) / SIM_RAMP_RATE
  );
}

/** Shortest signed angular difference, in (-PI, PI]. */
function shortestDelta(from: number, to: number): number {
  let delta = (to - from) % TAU;
  if (delta > Math.PI) {
    delta -= TAU;
  }
  if (delta <= -Math.PI) {
    delta += TAU;
  }
  return delta;
}

type CameraProxy = {
  azimuth: number;
  elevation: number;
  radius: number;
  /** 0 = anchored at the transition's start center, 1 = at the target. */
  travel: number;
  /** Strength of the off-center composition that makes room for the UI. */
  off: number;
};

export function CameraDirector() {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const seq = useSiteStore((state) => state.seq);
  // Portrait screens need a wider pull-back to fit the whole system.
  const overviewRadius = OVERVIEW_CAMERA.radius * (size.width < size.height ? 1.55 : 1);

  const proxyRef = useRef<CameraProxy | null>(null);
  /**
   * The camera center is lerp(from, to, travel). `toId`/`fromId` are LIVE
   * (recomputed per frame, so the camera rides orbiting planets); `from` is
   * the static fallback when no live source applies.
   */
  const anchorRef = useRef<{
    from: Vector3;
    fromId: BodyId | null;
    toId: BodyId | null;
  } | null>(null);
  const vectors = useRef({
    center: new Vector3(),
    to: new Vector3(),
    from: new Vector3(),
    look: new Vector3(),
    right: new Vector3(),
    up: new Vector3(),
  }).current;
  const timeline = useRef<gsap.core.Timeline | null>(null);
  /** True from timeline build until its onComplete — survives interrupts. */
  const inFlight = useRef(false);
  /** Bodies whose moon reveals are currently (partially) lit. */
  const lit = useRef(new Set<BodyId>()).current;
  /**
   * Last off-center compose distance. The return-to-overview flight has no
   * target planet, so the offset unwinds from this frozen value as `off`
   * tweens out — recomputing it would snap the scene on the first frame.
   */
  const lastComposeDistance = useRef(0);
  /** Azimuth captured at arrival; held while settled so rotation stops. */
  const frozenAzimuth = useRef<{ body: BodyId; value: number } | null>(null);

  // Initialize before the first paint so deep links start already framed.
  if (!proxyRef.current || !anchorRef.current) {
    const initialView = useSiteStore.getState().view;
    const proxy: CameraProxy = {
      azimuth: OVERVIEW_CAMERA.initialAzimuth,
      elevation: OVERVIEW_CAMERA.elevation,
      radius: overviewRadius * 1.16,
      travel: 0,
      off: 0,
    };
    const anchor: { from: Vector3; fromId: BodyId | null; toId: BodyId | null } = {
      from: new Vector3(),
      fromId: null,
      toId: null,
    };
    if (initialView !== "overview") {
      anchor.toId = initialView;
      proxy.travel = 1;
      proxy.off = 1;
      proxy.radius = fitDistance(initialView) * 1.45;
      proxy.elevation = focusElevationOf(initialView) + 0.22;
      // The settle tween rotates this offset away; reduced motion skips the
      // tween, so it must start already on the outward azimuth.
      proxy.azimuth =
        outwardAzimuth(initialView) -
        (useSiteStore.getState().reducedMotion ? 0 : Math.PI * 0.3);
      // Deep links start composed; gliding up from zero would pan on load.
      lastComposeDistance.current = BODY_MAP[initialView].focusDistance;
    }
    proxyRef.current = proxy;
    anchorRef.current = anchor;
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: overviewRadius is intentionally omitted — transitions must not replay on resize; idle framing tracks it per-frame.
  useEffect(() => {
    const proxy = proxyRef.current;
    const anchor = anchorRef.current;
    if (!proxy || !anchor) {
      return;
    }
    const store = useSiteStore.getState();
    const view = store.view;
    const target: BodyId | null = view === "overview" ? null : view;
    const previousFocused = store.focused;
    const firstLoad = seq === 0;
    const reduced = store.reducedMotion;

    timeline.current?.kill();
    const tl = gsap.timeline({
      defaults: { ease: "power3.inOut" },
      onComplete: () => {
        inFlight.current = false;
        // The landing pose is authoritative: freeze the settled rotation
        // target at the azimuth the flight actually reached. Recomputing
        // the outward azimuth after arrival always differs slightly
        // (post-arrival sim drift, prediction residue), and gliding to it
        // reads as the sun pivoting behind the planet.
        if (target) {
          frozenAzimuth.current = { body: target, value: proxy.azimuth };
        }
        useSiteStore.getState().arrived(target);
      },
    });
    timeline.current = tl;
    inFlight.current = true;

    store.setMoving(true);
    store.setUiVisible(false);

    const uiOn = () => useSiteStore.getState().setUiVisible(true);
    const def = target ? BODY_MAP[target] : null;

    // Fade out any moon systems that no longer belong on screen.
    const fadeOutLit = (duration: number) => {
      for (const id of [...lit]) {
        if (id !== target) {
          const reveals = revealOf(id);
          tl.to([reveals.orbits, reveals.moons], {
            value: 0,
            duration,
            ease: "power2.out",
            // Delete only once truly dark — if this tween is killed by an
            // interrupt, the id stays tracked and the next transition
            // fades it again instead of stranding half-lit moons.
            onComplete: () => lit.delete(id),
          }, 0);
        }
      }
    };

    const fadeInMoons = (position: number, duration: number) => {
      if (!target || !def || def.moons.length === 0) {
        return;
      }
      const reveals = revealOf(target);
      tl.to(reveals.orbits, { value: 1, duration, ease: "power2.inOut" }, position);
      tl.to(reveals.moons, { value: 1, duration, ease: "power2.inOut" }, position + duration * 0.4);
      lit.add(target);
    };

    if (firstLoad) {
      if (!target) {
        // Gentle settle into the overview on first paint.
        tl.to(proxy, {
          radius: overviewRadius,
          duration: reduced ? 0.6 : 2.4,
          ease: "power2.out",
        }, 0);
      } else if (def) {
        // Deep link: already near the body, short settle, no sweep.
        const duration = reduced ? 0.6 : 1.6;
        tl.to(proxy, {
          radius: fitDistance(target),
          elevation: focusElevationOf(target),
          // Absolute, orbit-predicted landing: the planet keeps moving
          // during the settle, and a relative spin lands on its load-time
          // azimuth — the sun then visibly pivots into place afterward.
          azimuth: proxy.azimuth + shortestDelta(proxy.azimuth, outwardAzimuth(target, simAdvanceDuring(duration))),
          duration,
          ease: "power2.out",
        }, 0);
        fadeInMoons(duration * 0.15, duration * 0.5);
        tl.call(uiOn, [], duration * 0.4);
      }
      return () => {
        tl.kill();
      };
    }

    if (!target) {
      // Return to the overview — seamless release: keep riding the planet
      // (travel unwinds from its live position) while the static end of the
      // anchor glides to the system center. No reference-frame snap.
      const duration = reduced ? 0.5 : 2.4;
      if (proxy.travel >= 0.999 || !anchor.toId) {
        anchor.from.copy(vectors.center);
      } else {
        // Re-solve the static end so the current center is unchanged:
        // lerp(from', to, travel) === center.
        const to = anchor.toId ? computeBodyPosition(anchor.toId, vectors.to) : ORIGIN;
        anchor.from
          .copy(vectors.center)
          .addScaledVector(to, -proxy.travel)
          .divideScalar(1 - proxy.travel);
      }
      anchor.fromId = null;
      fadeOutLit(reduced ? 0.3 : duration * 0.4);
      // Keep the pull-back modest, and gentler still on large screens —
      // the wide spin read as the whole system lurching.
      const pullBackSpin = window.innerWidth < 1024 ? -Math.PI * 0.45 : -Math.PI * 0.25;
      tl.to(proxy, {
        travel: 0,
        radius: overviewRadius,
        elevation: OVERVIEW_CAMERA.elevation,
        azimuth: `+=${reduced ? 0 : pullBackSpin}`,
        duration,
        ease: "power2.inOut",
      }, 0);
      tl.to(anchor.from, { x: 0, y: 0, z: 0, duration: duration * 0.85, ease: "power2.inOut" }, 0);
      tl.to(proxy, { off: 0, duration: duration * 0.55, ease: "power2.inOut" }, 0);
    } else if (def && previousFocused && previousFocused !== target) {
      // Planet → planet: rise along an arc, rotate, descend. No full
      // round-trip through the overview, and no pass through the planets
      // in between. When the camera sits ON the source planet, ride it
      // live — a frozen snapshot loses its orbital velocity, which shows
      // as a start-of-flight shift on fast movers (Earth, Mars). Mid-gap
      // launches use the snapshot, since no single planet matches.
      const sourcePosition = computeBodyPosition(previousFocused, vectors.from);
      if (sourcePosition.distanceTo(vectors.center) < 0.05) {
        anchor.fromId = previousFocused;
      } else {
        anchor.fromId = null;
        anchor.from.copy(vectors.center);
      }
      anchor.toId = target;
      proxy.travel = 0;
      const visited = Boolean(store.visited[target]);
      const duration = reduced ? 0.6 : visited ? 2.1 : 2.9;
      const landing = shortestDelta(proxy.azimuth, outwardAzimuth(target, simAdvanceDuring(duration)));
      // Shortest arc — the target is off-screen here, so there is no
      // visible side to honor.
      const spin = reduced ? 0 : landing;
      fadeOutLit(reduced ? 0.3 : duration * 0.3);
      tl.to(proxy, {
        radius: overviewRadius * 0.52,
        elevation: 0.72,
        duration: duration * 0.45,
        ease: "power2.inOut",
      }, 0);
      tl.to(proxy, {
        radius: fitDistance(target),
        elevation: focusElevationOf(target),
        duration: duration * 0.55,
      }, duration * 0.45);
      tl.to(proxy, { travel: 1, azimuth: `+=${spin}`, duration, ease: "power2.inOut" }, 0);
      tl.to(proxy, { off: 0.3, duration: duration * 0.3, ease: "power2.out" }, 0);
      tl.to(proxy, { off: 1, duration: duration * 0.4 }, duration * 0.55);
      fadeInMoons(duration * 0.6, duration * 0.3);
      tl.call(uiOn, [], duration * 0.68);
    } else if (def) {
      // Overview → body: the full ~270° cinematic sweep on first visit.
      // Anchor from the current (static) center so nothing jumps.
      anchor.fromId = null;
      anchor.from.copy(vectors.center);
      anchor.toId = target;
      proxy.travel = 0;
      const visited = Boolean(store.visited[target]);
      const duration = reduced ? 0.5 : visited ? 1.7 : 2.9;
      const landing = shortestDelta(proxy.azimuth, outwardAzimuth(target, simAdvanceDuring(duration)));
      // Rotate toward the planet's CURRENT screen side: a planet shown on
      // the left is approached panning right-to-left, and vice versa.
      // screenX ∝ the planet's horizontal screen position for an orbiting
      // camera; screenXSlope is its change per unit azimuth (the sign
      // flips between near and far side). The azimuth direction that
      // drives screenX toward 0 pans the planet to center.
      computeBodyPosition(target, vectors.look);
      const relX = vectors.look.x - vectors.center.x;
      const relZ = vectors.look.z - vectors.center.z;
      const screenX = relX * Math.sin(proxy.azimuth) - relZ * Math.cos(proxy.azimuth);
      const screenXSlope = relX * Math.cos(proxy.azimuth) + relZ * Math.sin(proxy.azimuth);
      const towardPlanet = -Math.sign(screenX) * Math.sign(screenXSlope);
      const complement = landing - Math.sign(landing || 1) * TAU;
      const directed =
        towardPlanet !== 0 && Math.sign(landing || 1) !== towardPlanet ? complement : landing;
      const spin = reduced ? 0 : directed;
      fadeOutLit(reduced ? 0.3 : duration * 0.3);
      // One motion: zoom, rotation, and travel share a single tween and
      // ease, so nothing reads as staged.
      tl.to(proxy, {
        travel: 1,
        azimuth: `+=${spin}`,
        radius: fitDistance(target),
        elevation: focusElevationOf(target),
        duration,
        ease: "power2.inOut",
      }, 0);
      tl.to(proxy, { off: 1, duration: duration * 0.55, ease: "power2.inOut" }, duration * 0.3);
      fadeInMoons(duration * 0.55, duration * 0.3);
      tl.call(uiOn, [], duration * 0.62);
    }

    return () => {
      tl.kill();
    };
  }, [seq, lit, vectors]);

  useFrame((_, delta) => {
    const proxy = proxyRef.current;
    const anchor = anchorRef.current;
    if (!proxy || !anchor) {
      return;
    }

    const active = timeline.current?.isActive() ?? false;
    const store = useSiteStore.getState();

    // moving flips in the same store commit as a flight-starting click, so
    // this gate closes before the flight effect has even built its timeline
    // — otherwise a few scrub frames snap the center onto the target planet
    // and the flight launches from a corrupted pose.
    if (!active && store.view !== "overview" && !store.moving) {
      // Scroll-driven mode: the page's scroll position scrubs the camera
      // from planet to planet; smoothing absorbs hand-off discontinuities
      // from a just-finished flight.
      // Linear in scroll distance: the visitor's own scrolling is the
      // easing. An extra curve here reads as dead zones at the gap edges.
      const { a, b, p } = scrollPose;
      const eased = p;
      computeBodyPosition(a, vectors.from);
      computeBodyPosition(b, vectors.to);
      anchor.from.copy(vectors.from).lerp(vectors.to, eased);
      anchor.fromId = null;
      anchor.toId = null;
      proxy.travel = 0;

      // Settled on a planet, the rotation target FREEZES at the arrival
      // azimuth — endlessly following the orbit means the camera never
      // actually stops rotating, which the label's appearance makes
      // conspicuous. Transitions recompute live targets as before.
      const settledBody = p <= 0.01 ? a : p >= 0.99 ? b : null;
      let targetAzimuth: number;
      if (settledBody) {
        if (frozenAzimuth.current?.body !== settledBody) {
          frozenAzimuth.current = { body: settledBody, value: outwardAzimuth(settledBody) };
        }
        targetAzimuth = frozenAzimuth.current.value;
      } else {
        frozenAzimuth.current = null;
        const azimuthA = outwardAzimuth(a);
        targetAzimuth =
          azimuthA + (a === b ? 0 : shortestDelta(azimuthA, outwardAzimuth(b)) * eased);
      }
      const bump = eased * (1 - eased);
      const targetRadius =
        MathUtils.lerp(fitDistance(a), fitDistance(b), eased) * (1 + 1.3 * bump);
      // Lerp per-body elevations so scrolling into a body with its own
      // focus elevation (the sun) lands exactly where a flight would.
      const targetElevation =
        MathUtils.lerp(focusElevationOf(a), focusElevationOf(b), eased) + 0.55 * bump;
      // Glide between discrete wheel notches: the ~250ms time constant keeps
      // the camera in motion across slow tick cadences instead of easing to
      // a stop after each one. Exponential form stays frame-rate independent.
      // Clamp the step so a render stall reads as a pause, not a jump —
      // an unclamped post-stall delta applies most of the residual at once.
      const smoothing = 1 - Math.exp(-Math.min(delta, 0.05) * 4);
      proxy.azimuth += shortestDelta(proxy.azimuth, targetAzimuth) * smoothing;
      proxy.radius += (targetRadius - proxy.radius) * smoothing;
      proxy.elevation += (targetElevation - proxy.elevation) * smoothing;
      proxy.off += (1 - proxy.off) * smoothing;

      // Moon systems light with their planet and dim as it scrubs away.
      const revealsA = revealOf(a);
      const revealsB = revealOf(b);
      const targetA = 1 - eased;
      const targetB = a === b ? targetA : eased;
      revealsA.orbits.value += (targetA - revealsA.orbits.value) * smoothing;
      revealsA.moons.value += (targetA - revealsA.moons.value) * smoothing;
      revealsB.orbits.value += (targetB - revealsB.orbits.value) * smoothing;
      revealsB.moons.value += (targetB - revealsB.moons.value) * smoothing;
      if (targetA > 0.01) {
        lit.add(a);
      }
      if (targetB > 0.01) {
        lit.add(b);
      }
    } else if (!active) {
      // Idle drift keeps the overview alive between transitions.
      const focusedDrift = anchor.toId && proxy.travel > 0.5;
      proxy.azimuth += delta * (focusedDrift ? 0.012 : 0.03) * (store.reducedMotion ? 0.15 : 1);
      // Track resize/rotation while idle at the overview so the framing
      // never goes stale waiting for the next navigation.
      if (proxy.travel < 0.01 && proxy.off < 0.01) {
        proxy.radius = MathUtils.lerp(proxy.radius, overviewRadius, Math.min(1, delta * 1.5));
      }
    }

    // Both anchor ends can be LIVE positions: planets keep orbiting the
    // Sun and the camera rides along with them.
    const to = anchor.toId ? computeBodyPosition(anchor.toId, vectors.to) : ORIGIN;
    const from = anchor.fromId ? computeBodyPosition(anchor.fromId, vectors.from) : anchor.from;
    vectors.center.lerpVectors(from, to, proxy.travel);

    const flat = Math.cos(proxy.elevation) * proxy.radius;
    camera.position.set(
      vectors.center.x + flat * Math.cos(proxy.azimuth),
      vectors.center.y + Math.sin(proxy.elevation) * proxy.radius,
      vectors.center.z + flat * Math.sin(proxy.azimuth),
    );
    camera.lookAt(vectors.center);

    // Off-center composition distance. In scroll mode it blends between the
    // two planets' focus distances with the scrub — switching at the gap's
    // midpoint would visibly shift the whole scene when they differ
    // (earth→saturn, mars→sun).
    let composeTarget: number | null = null;
    if (anchor.toId) {
      composeTarget = BODY_MAP[anchor.toId].focusDistance;
    } else if (store.view !== "overview") {
      composeTarget = MathUtils.lerp(
        BODY_MAP[scrollPose.a].focusDistance,
        BODY_MAP[scrollPose.b].focusDistance,
        scrollPose.p,
      );
    }
    if (composeTarget !== null) {
      // Glide, never snap: a flight retargets this the instant it starts,
      // and planets' focus distances differ enough to shift the frame.
      lastComposeDistance.current +=
        (composeTarget - lastComposeDistance.current) *
        (1 - Math.exp(-Math.min(delta, 0.05) * 4));
    }
    const composeDistance = lastComposeDistance.current;
    if (proxy.off > 0.001) {
      // Shift the look target so the body composes off-center,
      // leaving room for the section panel.
      vectors.right.setFromMatrixColumn(camera.matrix, 0);
      vectors.up.setFromMatrixColumn(camera.matrix, 1);
      vectors.look.copy(vectors.center);
      if (store.isMobile) {
        // Phone reels overlay the caption on the lower half, so the body
        // sits at ~30% of the screen height: offset k gives a vertical
        // angle atan(k / 2.1) (fitDistance is 2.1x on mobile) against the
        // 25° half-FOV — k = 0.38 puts the center 20% above mid-screen.
        vectors.look.addScaledVector(vectors.up, -composeDistance * 0.38 * proxy.off);
      } else {
        vectors.look.addScaledVector(vectors.right, composeDistance * 0.21 * proxy.off);
      }
      camera.lookAt(vectors.look);
    }

    // Test hook: UI tests read this to assert the camera holds still after
    // every flight (no sun pivot on arrival).
    (window as unknown as { __pose?: { azimuth: number; view: string; moving: boolean } }).__pose =
      { azimuth: proxy.azimuth, view: store.view, moving: store.moving };
  });

  return null;
}
