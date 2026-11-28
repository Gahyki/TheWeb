import type { BlackHole, View } from "./state/store.js";

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

/** A URL-addressable state: a view, or the overview with the sun collapsed. */
export type Route = View | "blackHole";

/** The black hole's path is unlinked; only the sun click leads there. */
export const ROUTE_PATHS: Record<Route, string> = { ...VIEW_PATHS, blackHole: "/void" };

export const ROUTE_TITLES: Record<Route, string> = {
  ...VIEW_TITLES,
  blackHole: "Sign in — Jason Kim",
};

export function routeFromPath(pathname: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  for (const [route, routePath] of Object.entries(ROUTE_PATHS)) {
    if (routePath === path) {
      return route as Route;
    }
  }
  // Unknown paths (including the retired /home) land on Home; main.tsx
  // then canonicalizes the URL to "/".
  return "earth";
}

/** The route a store state shows. */
export function routeOf(state: { view: View; blackHole: BlackHole }): Route {
  return state.view === "overview" && state.blackHole !== "off" ? "blackHole" : state.view;
}
