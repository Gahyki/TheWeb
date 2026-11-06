import type { View } from "./state/store.js";

export const VIEW_PATHS: Record<View, string> = {
  overview: "/system",
  earth: "/",
  saturn: "/experience",
  jupiter: "/thinking",
  mars: "/github",
  sun: "/contact",
};

export const VIEW_TITLES: Record<View, string> = {
  overview: "Solar System — Jason Kim",
  earth: "Jason Kim — Software Engineer",
  saturn: "Experience — Jason Kim",
  jupiter: "How I Think — Jason Kim",
  mars: "GitHub — Jason Kim",
  sun: "Contact — Jason Kim",
};

export function viewFromPath(pathname: string): View {
  const path = pathname.replace(/\/+$/, "") || "/";
  for (const [view, viewPath] of Object.entries(VIEW_PATHS)) {
    if (viewPath === path) {
      return view as View;
    }
  }
  // Unknown paths (including the retired /home) land on Home; main.tsx
  // then canonicalizes the URL to "/".
  return "earth";
}
