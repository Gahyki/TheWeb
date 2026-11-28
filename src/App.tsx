import { Component, useEffect, type ReactNode } from "react";
import {
  MOBILE_MEDIA_QUERY,
  REDUCED_MOTION_MEDIA_QUERY,
  SHORT_LANDSCAPE_MEDIA_QUERY,
} from "./mediaQueries";
import { ROUTE_PATHS, ROUTE_TITLES, routeFromPath, routeOf } from "./router";
import { BODY_ORDER } from "./scene/config";
import { Scene } from "./scene/Scene";
import { useSiteStore } from "./state/store";
import { Chrome } from "./ui/Chrome";
import { LoginLayer } from "./ui/login/LoginLayer";
import { SectionPanel } from "./ui/SectionPanel";

function useRouterSync() {
  useEffect(() => {
    /** True while applying a history traversal: its URL is already set. */
    let traversing = false;
    const unsubscribe = useSiteStore.subscribe((state, previous) => {
      const route = routeOf(state);
      if (route !== routeOf(previous)) {
        // Compare routes, not raw paths: a non-canonical URL (e.g. /contact/)
        // must not trigger a push after Back, which would kill forward
        // history mid-traversal.
        if (routeFromPath(window.location.pathname) !== route) {
          // Scrolling through sections rewrites the URL without flooding
          // history; clicks and keys still create real entries. Corrections
          // replace too: a traversal the store refused, or the scene failing.
          if (
            state.viewSource === "scroll" ||
            traversing ||
            (state.degraded && !previous.degraded)
          ) {
            window.history.replaceState({}, "", ROUTE_PATHS[route]);
          } else {
            window.history.pushState({}, "", ROUTE_PATHS[route]);
          }
        }
        document.title = ROUTE_TITLES[route];
      }
    });
    const onPopState = () => {
      const route = routeFromPath(window.location.pathname);
      const state = useSiteStore.getState();
      traversing = true;
      if (route === "blackHole") {
        state.openBlackHole("history");
      } else {
        state.navigate(route);
      }
      traversing = false;
    };
    window.addEventListener("popstate", onPopState);
    document.title = ROUTE_TITLES[routeOf(useSiteStore.getState())];
    return () => {
      unsubscribe();
      window.removeEventListener("popstate", onPopState);
    };
  }, []);
}

function useMediaFlags() {
  useEffect(() => {
    const mobileQuery = window.matchMedia(MOBILE_MEDIA_QUERY);
    const landscapeQuery = window.matchMedia(SHORT_LANDSCAPE_MEDIA_QUERY);
    const motionQuery = window.matchMedia(REDUCED_MOTION_MEDIA_QUERY);
    const apply = () => {
      useSiteStore.getState().setFlags({
        isMobile: mobileQuery.matches,
        shortLandscape: landscapeQuery.matches,
        reducedMotion: motionQuery.matches,
      });
    };
    apply();
    mobileQuery.addEventListener("change", apply);
    landscapeQuery.addEventListener("change", apply);
    motionQuery.addEventListener("change", apply);
    return () => {
      mobileQuery.removeEventListener("change", apply);
      landscapeQuery.removeEventListener("change", apply);
      motionQuery.removeEventListener("change", apply);
    };
  }, []);
}

function useKeyboardNavigation() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = useSiteStore.getState();
      // Over the black hole only Escape is ours, even inside its form;
      // every other key stays native.
      if (state.blackHole !== "off") {
        if (event.key === "Escape" && !event.isComposing) {
          event.preventDefault();
          state.closeBlackHole();
        }
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      // Never steal keys from inside a form (Escape must not nuke a
      // half-written contact message, even from the Send button).
      if (target?.closest("form") || target?.closest("[data-sheet]")) {
        return;
      }

      if (event.key === "Escape") {
        if (state.view !== "overview") {
          event.preventDefault();
          state.navigate("overview");
        }
        return;
      }
      if (event.key === "Enter") {
        // A highlight beats the focused control's native click, unless no
        // scene shows it (degraded mode). Otherwise Enter stays native.
        const overridesFocus = !state.degraded || !target?.closest("button, a");
        if (state.view === "overview" && state.highlight && overridesFocus) {
          event.preventDefault();
          state.navigate(state.highlight);
        }
        return;
      }
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }

      const direction = event.key === "ArrowLeft" ? -1 : 1;
      if (state.view === "overview") {
        // Unhighlighted, Right starts at the first body and Left at the last.
        const index = state.highlight
          ? BODY_ORDER.indexOf(state.highlight)
          : direction > 0
            ? -1
            : BODY_ORDER.length;
        const next = BODY_ORDER[(index + direction + BODY_ORDER.length) % BODY_ORDER.length];
        state.setHighlight(next);
        event.preventDefault();
      } else {
        const index = BODY_ORDER.indexOf(state.view);
        state.navigate(BODY_ORDER[(index + direction + BODY_ORDER.length) % BODY_ORDER.length]);
        event.preventDefault();
      }
    };
    // Moving focus drops the highlight, so Enter then activates that control.
    const onFocusIn = () => useSiteStore.getState().setHighlight(null);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("focusin", onFocusIn);
    };
  }, []);
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
          <Scene />
        </SceneErrorBoundary>
      </div>
      <SectionPanel />
      <Chrome />
      <LoginLayer />
    </div>
  );
}
