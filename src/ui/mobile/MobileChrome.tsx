import { BODY_MAP, BODY_ORDER } from "../../scene/config";
import { useSiteStore } from "../../state/store";
import { PlanetGlyph, SystemGlyph } from "./PlanetGlyph";

/** Height of the bottom tab bar, excluding the home-indicator inset. */
export const TAB_BAR_PX = 56;

/**
 * Phone chrome: wordmark + back-to-system button up top, and the section
 * tabs as a bottom tab bar in the thumb zone (44px+ targets, safe-area
 * aware) — app conventions instead of a wrapped row of tiny links.
 */
export function MobileChrome() {
  const view = useSiteStore((state) => state.view);
  const navigate = useSiteStore((state) => state.navigate);
  const inSection = view !== "overview";

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between px-4 pt-[env(safe-area-inset-top)]">
        <button
          type="button"
          onClick={() => navigate("overview")}
          className="pointer-events-auto flex h-11 items-center font-mono text-xs uppercase tracking-[0.45em] text-white/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
        >
          gahyki
        </button>
        <button
          type="button"
          onClick={() => navigate("overview")}
          aria-label="Back to the solar system"
          tabIndex={inSection ? 0 : -1}
          className={`mt-3 flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/50 text-white/70 backdrop-blur-sm transition-opacity duration-500 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60 ${
            inSection ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <SystemGlyph />
        </button>
      </header>
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-black/75 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      >
        <ul className="grid grid-cols-5">
          {BODY_ORDER.map((id) => {
            const active = view === id;
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => navigate(id)}
                  aria-current={active ? "page" : undefined}
                  className="flex w-full flex-col items-center justify-center gap-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-white/60 active:bg-white/5"
                  style={{ height: TAB_BAR_PX }}
                >
                  <PlanetGlyph id={id} active={active} />
                  <span
                    className={`text-[11px] leading-none tracking-wide transition-colors duration-300 ${
                      active ? "text-white" : "text-white/45"
                    }`}
                  >
                    {BODY_MAP[id].sectionLabel}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
