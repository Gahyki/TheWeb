import { BODY_MAP, BODY_ORDER } from "../scene/config";
import { useSiteStore } from "../state/store";
import { MobileChrome } from "./mobile/MobileChrome";

/** Persistent minimal chrome: wordmark, section nav, back affordance. */
export function Chrome() {
  const isMobile = useSiteStore((state) => state.isMobile);
  return isMobile ? <MobileChrome /> : <DesktopChrome />;
}

function DesktopChrome() {
  const view = useSiteStore((state) => state.view);
  const navigate = useSiteStore((state) => state.navigate);
  const showBack = view !== "overview";

  return (
    <>
      <header className="pointer-events-none fixed inset-x-0 top-0 z-30 flex items-start justify-between p-5 sm:p-7">
        <button
          type="button"
          onClick={() => navigate("overview")}
          className="pointer-events-auto font-mono text-xs uppercase tracking-[0.45em] text-white/80 transition-colors hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
        >
          gahyki
        </button>
        <nav
          aria-label="Sections"
          className="pointer-events-auto flex max-w-[72%] flex-wrap justify-end gap-x-4 gap-y-2 sm:max-w-none sm:gap-6"
        >
          {BODY_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => navigate(id)}
              aria-current={view === id ? "page" : undefined}
              className={`text-[10px] uppercase tracking-[0.3em] transition-colors duration-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60 ${
                view === id ? "text-white" : "text-white/40 hover:text-white/80"
              }`}
            >
              {BODY_MAP[id].sectionLabel}
            </button>
          ))}
        </nav>
      </header>
      <div
        className={`fixed inset-x-0 bottom-0 z-30 flex justify-center pb-5 transition-opacity duration-700 ${
          showBack ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          type="button"
          onClick={() => navigate("overview")}
          tabIndex={showBack ? 0 : -1}
          className={`rounded-full border border-white/15 bg-black/70 px-5 py-2 text-[10px] uppercase tracking-[0.3em] text-white/60 backdrop-blur-sm transition hover:border-white/40 hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60 ${
            showBack ? "pointer-events-auto" : "pointer-events-none"
          }`}
        >
          ← to system
          <span className="ml-3 hidden text-white/30 sm:inline">esc</span>
        </button>
      </div>
    </>
  );
}
