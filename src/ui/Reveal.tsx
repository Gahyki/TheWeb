import type { ReactNode } from "react";
import { useSiteStore } from "../state/store";

const EXIT_STAGGER_MS = 20;
const EXIT_DURATION_MS = 400;
/** Largest `i` any panel passes to Reveal (GithubPanel's footer). */
const MAX_STAGGER_INDEX = 7;
/** Time for the slowest Reveal to finish dissolving out. */
export const PANEL_EXIT_MS = MAX_STAGGER_INDEX * EXIT_STAGGER_MS + EXIT_DURATION_MS;

/**
 * Section content materializes out of the light structure: blurred and
 * displaced until the camera arrives, then resolves sharp with a stagger.
 */
export function Reveal({
  i = 0,
  className = "",
  children,
}: {
  i?: number;
  className?: string;
  children: ReactNode;
}) {
  const on = useSiteStore((state) => state.uiVisible);
  const reducedMotion = useSiteStore((state) => state.reducedMotion);
  return (
    <div
      className={`transition-[opacity,transform,filter] ease-out ${
        on ? "translate-y-0 opacity-100 blur-none" : "translate-y-3 opacity-0 blur-[6px]"
      } ${className}`}
      style={{
        // Exit keeps a touch of the stagger (reversed feel) so the panel
        // dissolves rather than snapping out. Reduced motion collapses the
        // choreography entirely: content appears and disappears instantly.
        transitionDelay: reducedMotion ? "0ms" : on ? `${i * 45}ms` : `${i * EXIT_STAGGER_MS}ms`,
        transitionDuration: reducedMotion ? "0ms" : on ? "450ms" : `${EXIT_DURATION_MS}ms`,
      }}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-cyan-100/50">{children}</p>
  );
}
