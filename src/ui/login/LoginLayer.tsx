import { Component, lazy, type ReactNode, Suspense } from "react";
import { isSupabaseConfigured } from "../../auth/config";
import { useSiteStore } from "../../state/store";

// Loads with supabase-js on the first collapse, never with the page.
const LoginDialog = lazy(() => import("./LoginDialog"));

/** A chunk that fails to load leaves the black hole empty, not the app blank. */
class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** The sign-in screen over the black hole; the form appears once it forms. */
export function LoginLayer() {
  const blackHole = useSiteStore((state) => state.blackHole);
  // Only once the collapse is under way: a /void load without WebGL never
  // starts one, so it never fetches supabase-js.
  const started = useSiteStore((state) => state.moving || state.blackHole === "open");
  if (blackHole === "off" || !started || !isSupabaseConfigured()) {
    return null;
  }
  return (
    <ChunkBoundary>
      <Suspense fallback={null}>
        <LoginDialog shown={blackHole === "open"} />
      </Suspense>
    </ChunkBoundary>
  );
}
