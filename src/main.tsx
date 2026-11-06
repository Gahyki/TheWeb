import gsap from "gsap";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MOBILE_MEDIA_QUERY, REDUCED_MOTION_MEDIA_QUERY } from "./mediaQueries";
import { VIEW_PATHS, viewFromPath } from "./router";
import { useSiteStore } from "./state/store";
import "./style.css";

// Resolve the deep-linked view and device flags before the first render so
// the camera starts in the right place and geometry builds at the right
// density.
const initialView = viewFromPath(window.location.pathname);

// Rebase GSAP time across main-thread stalls >100ms (shader compiles,
// mount commits): with smoothing off, a stall teleports every tween ahead
// by the full gap in one frame — the long-standing "settle, twist" jump.
// Steady-slow frames (CI software rendering) still progress normally.
gsap.ticker.lagSmoothing(100, 16);

// Canonicalize non-canonical deep links (e.g. trailing slash) so history
// entries always carry the canonical path.
if (window.location.pathname !== VIEW_PATHS[initialView]) {
  window.history.replaceState({}, "", VIEW_PATHS[initialView]);
}

useSiteStore.setState({
  view: initialView,
  isMobile: window.matchMedia(MOBILE_MEDIA_QUERY).matches,
  reducedMotion: window.matchMedia(REDUCED_MOTION_MEDIA_QUERY).matches,
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("The React root element is missing.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
