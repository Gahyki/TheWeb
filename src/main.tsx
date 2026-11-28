import gsap from "gsap";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { isSupabaseConfigured } from "./auth/config";
import {
  MOBILE_MEDIA_QUERY,
  REDUCED_MOTION_MEDIA_QUERY,
  SHORT_LANDSCAPE_MEDIA_QUERY,
} from "./mediaQueries";
import { ROUTE_PATHS, routeFromPath } from "./router";
import { useSiteStore } from "./state/store";
import "./style.css";

// Resolve the deep-linked view and device flags before the first render so
// the camera starts in the right place and geometry builds at the right
// density. Without Supabase the black hole's URL is the plain overview.
const linked = routeFromPath(window.location.pathname);
const initialRoute = linked === "blackHole" && !isSupabaseConfigured() ? "overview" : linked;

// Rebase GSAP time across main-thread stalls >100ms (shader compiles,
// mount commits): with smoothing off, a stall teleports every tween ahead
// by the full gap in one frame — the long-standing "settle, twist" jump.
// Steady-slow frames (CI software rendering) still progress normally.
gsap.ticker.lagSmoothing(100, 16);

// Canonicalize non-canonical deep links (e.g. trailing slash) so history
// entries always carry the canonical path.
if (window.location.pathname !== ROUTE_PATHS[initialRoute]) {
  window.history.replaceState({}, "", ROUTE_PATHS[initialRoute]);
}

useSiteStore.setState({
  view: initialRoute === "blackHole" ? "overview" : initialRoute,
  blackHole: initialRoute === "blackHole" ? "collapsing" : "off",
  isMobile: window.matchMedia(MOBILE_MEDIA_QUERY).matches,
  shortLandscape: window.matchMedia(SHORT_LANDSCAPE_MEDIA_QUERY).matches,
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
