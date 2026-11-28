import { create } from "zustand";
import { isSupabaseConfigured } from "../auth/config.js";

export type BodyId = "sun" | "saturn" | "jupiter" | "mars" | "earth";
export type View = "overview" | BodyId;

export type ViewSource = "user" | "scroll";

/** The sun collapsing into the black hole, formed, or not shown. */
export type BlackHole = "off" | "collapsing" | "open";

type SiteState = {
  /** Desired view. The camera director animates toward it. */
  view: View;
  /** Who changed `view` last: a click/key ("user") or the scroller. */
  viewSource: ViewSource;
  /** Increments on every overview-involved navigation to retrigger flights. */
  seq: number;
  /** Body whose section is currently presented (set on camera arrival). */
  focused: BodyId | null;
  moving: boolean;
  uiVisible: boolean;
  /** Keyboard-highlighted body in the overview. */
  highlight: BodyId | null;
  visited: Partial<Record<BodyId, boolean>>;
  isMobile: boolean;
  /** Landscape and at most 500px tall (SHORT_LANDSCAPE_MEDIA_QUERY). */
  shortLandscape: boolean;
  reducedMotion: boolean;
  /** True when WebGL failed: no scene, overlay-only navigation. */
  degraded: boolean;
  /** Shown over the overview only; `view` stays "overview" throughout. */
  blackHole: BlackHole;
  navigate: (view: View) => void;
  /** View change originated by the scroller crossing a section boundary. */
  setViewFromScroll: (view: BodyId) => void;
  enterDegradedMode: () => void;
  setHighlight: (id: BodyId | null) => void;
  /**
   * "sun": a click on the sun, honored only while sunArmed. "history": the
   * black hole's URL, from any view.
   */
  openBlackHole: (source: "sun" | "history") => void;
  /** The scene finished collapsing the sun. */
  blackHoleFormed: () => void;
  closeBlackHole: () => void;
  arrived: (id: BodyId | null) => void;
  setMoving: (moving: boolean) => void;
  setUiVisible: (visible: boolean) => void;
  setFlags: (flags: { isMobile?: boolean; shortLandscape?: boolean; reducedMotion?: boolean }) => void;
};

/** The sign-in sits beside the black hole, as on desktop, rather than under it. */
export function signInBeside(state: Pick<SiteState, "isMobile" | "shortLandscape">) {
  return !state.isMobile || state.shortLandscape;
}

/** True while a click on the sun opens the black hole. */
export function sunArmed(state: Pick<SiteState, "view" | "moving" | "degraded" | "blackHole">) {
  return (
    state.view === "overview" &&
    !state.moving &&
    !state.degraded &&
    state.blackHole === "off" &&
    isSupabaseConfigured()
  );
}

export const useSiteStore = create<SiteState>((set, get) => ({
  view: "overview",
  viewSource: "user",
  seq: 0,
  focused: null,
  moving: false,
  uiVisible: false,
  highlight: null,
  visited: {},
  isMobile: false,
  shortLandscape: false,
  reducedMotion: false,
  degraded: false,
  blackHole: "off",
  navigate: (view) => {
    const state = get();
    // Re-selecting the current destination is a no-op — prevents re-click
    // from restarting an in-flight transition with extra rotation. On the
    // overview it still closes the black hole.
    if (view === state.view) {
      state.closeBlackHole();
      return;
    }
    if (state.degraded) {
      // No camera to fly: sections swap instantly.
      set({
        view,
        viewSource: "user",
        seq: state.seq + 1,
        highlight: null,
        moving: false,
        focused: view === "overview" ? null : view,
        uiVisible: view !== "overview",
        blackHole: "off",
      });
      return;
    }
    // Every user navigation is a camera flight — including section to
    // section, which flies directly planet to planet while the page jumps
    // underneath (scroll-driven crossings stay with setViewFromScroll).
    // moving/uiVisible flip in the SAME commit as view, so the section
    // panel can start its dissolve immediately instead of hard-cutting.
    set({
      view,
      viewSource: "user",
      seq: state.seq + 1,
      highlight: null,
      moving: true,
      uiVisible: false,
      blackHole: "off",
    });
  },
  setViewFromScroll: (view) => {
    const state = get();
    // A section panel still fading out can scroll; the black hole keeps the overview.
    if (view === state.view || state.blackHole !== "off") {
      return;
    }
    const visited = { ...state.visited, [view]: true };
    set({ view, viewSource: "scroll", focused: view, moving: false, uiVisible: true, visited });
  },
  enterDegradedMode: () => {
    const view = get().view;
    set({
      degraded: true,
      moving: false,
      focused: view === "overview" ? null : view,
      uiVisible: view !== "overview",
      blackHole: "off",
    });
  },
  setHighlight: (id) => set({ highlight: id }),
  openBlackHole: (source) => {
    const state = get();
    if (source === "sun" ? !sunArmed(state) : state.blackHole !== "off") {
      return;
    }
    // Without a scene or Supabase there is nothing to show: history lands
    // on the plain overview instead.
    if (state.degraded || !isSupabaseConfigured()) {
      state.navigate("overview");
      return;
    }
    set({
      view: "overview",
      viewSource: "user",
      seq: state.seq + 1,
      highlight: null,
      moving: true,
      uiVisible: false,
      blackHole: "collapsing",
    });
  },
  blackHoleFormed: () => {
    if (get().blackHole === "collapsing") {
      set({ blackHole: "open" });
    }
  },
  closeBlackHole: () => {
    const state = get();
    if (state.blackHole === "off") {
      return;
    }
    set({ viewSource: "user", seq: state.seq + 1, moving: true, uiVisible: false, blackHole: "off" });
  },
  arrived: (id) => {
    const visited = { ...get().visited };
    if (id) {
      visited[id] = true;
    }
    set({ focused: id, moving: false, visited });
  },
  setMoving: (moving) => set({ moving }),
  setUiVisible: (visible) => set({ uiVisible: visible }),
  setFlags: (flags) => set(flags),
}));
