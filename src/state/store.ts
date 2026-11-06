import { create } from "zustand";

export type BodyId = "sun" | "saturn" | "jupiter" | "mars" | "earth";
export type View = "overview" | BodyId;

export type ViewSource = "user" | "scroll";

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
  reducedMotion: boolean;
  /** True when WebGL failed: no scene, overlay-only navigation. */
  degraded: boolean;
  navigate: (view: View) => void;
  /** View change originated by the scroller crossing a section boundary. */
  setViewFromScroll: (view: BodyId) => void;
  enterDegradedMode: () => void;
  setHighlight: (id: BodyId | null) => void;
  arrived: (id: BodyId | null) => void;
  setMoving: (moving: boolean) => void;
  setUiVisible: (visible: boolean) => void;
  setFlags: (flags: { isMobile?: boolean; reducedMotion?: boolean }) => void;
};

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
  reducedMotion: false,
  degraded: false,
  navigate: (view) => {
    const state = get();
    // Re-selecting the current destination is a no-op — prevents re-click
    // from restarting an in-flight transition with extra rotation.
    if (view === state.view) {
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
    });
  },
  setViewFromScroll: (view) => {
    const state = get();
    if (view === state.view) {
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
    });
  },
  setHighlight: (id) => set({ highlight: id }),
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
