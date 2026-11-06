import { useEffect, useLayoutEffect, useRef, type ComponentType } from "react";
import { BODY_MAP, BODY_ORDER } from "../scene/config";
import { scrollPose } from "../scene/scrollBridge";
import type { BodyId } from "../state/store";
import { useSiteStore } from "../state/store";
import { ContactPanel } from "./panels/ContactPanel";
import { ExperiencePanel } from "./panels/ExperiencePanel";
import { GithubPanel } from "./panels/GithubPanel";
import { HomePanel } from "./panels/HomePanel";
import { ThinkingPanel } from "./panels/ThinkingPanel";

const PANELS: Record<BodyId, ComponentType> = {
  earth: HomePanel,
  saturn: ExperiencePanel,
  jupiter: ThinkingPanel,
  mars: GithubPanel,
  sun: ContactPanel,
};

/**
 * Slot anatomy, keeping the 160vh page-to-page pitch: 150vh slot with the
 * content held for the extra 50vh while you start scrolling, plus a 10vh
 * gap. The last slot is a plain viewport — it has no departure, and extra
 * height there just lets the final section scroll away for no reason.
 */
const SLOT_CLASS = "h-[150vh]";
const LAST_SLOT_CLASS = "h-screen";
const SPACER_CLASS = "mt-[10vh]";

/**
 * One continuous page: all sections stacked in a single native scroller,
 * separated by empty transition zones. Scroll position drives the camera
 * (via scrollPose) — content scrolls like a normal page, and the camera
 * scrubs directly from planet to planet through the gaps. Tabs smooth-
 * scroll to their section. Hidden on the /system overview.
 */
export function SectionPanel() {
  const view = useSiteStore((state) => state.view);
  const moving = useSiteStore((state) => state.moving);
  const focused = useSiteStore((state) => state.focused);
  const uiVisible = useSiteStore((state) => state.uiVisible);
  const degraded = useSiteStore((state) => state.degraded);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const stickyRefs = useRef<(HTMLDivElement | null)[]>([]);
  /** Target of an in-flight programmatic smooth scroll, else null. */
  const programmaticTarget = useRef<number | null>(null);
  const programmaticIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mounted while a section is shown, and during the flight back to the
  // overview (focused still set) so the content dissolves instead of
  // hard-cutting. The overview's own settle (moving, nothing focused)
  // must not mount it.
  const mounted = view !== "overview" || (moving && focused !== null && !degraded);

  const readPose = () => {
    const container = containerRef.current;
    if (!container) {
      return null;
    }
    const viewportHeight = container.clientHeight;
    const top = container.scrollTop;
    let a = 0;
    for (let i = 0; i < BODY_ORDER.length; i += 1) {
      const section = sectionRefs.current[i];
      if (section && section.offsetTop <= top + 1) {
        a = i;
      }
    }
    const b = Math.min(a + 1, BODY_ORDER.length - 1);
    const sectionA = sectionRefs.current[a];
    const sectionB = sectionRefs.current[b];
    if (!sectionA || !sectionB || a === b) {
      return { a, b, p: 0 };
    }
    // Hold the camera while section A's own content still fills the
    // viewport; past its bottom edge the gap scrubs the transition.
    const zoneStart = sectionA.offsetTop + Math.max(0, sectionA.offsetHeight - viewportHeight);
    const zoneLength = Math.max(1, sectionB.offsetTop - zoneStart);
    const raw = Math.min(1, Math.max(0, (top - zoneStart) / zoneLength));
    // The sticky slot now provides the hold while content is pinned
    // (zoneStart lands exactly at its release); keep only a sliver of
    // camera dwell past that, and settle before the next section tops out.
    const DWELL_UNTIL = 0.08;
    const SETTLE_AT = 0.95;
    const p = Math.min(1, Math.max(0, (raw - DWELL_UNTIL) / (SETTLE_AT - DWELL_UNTIL)));
    return { a, b, p };
  };

  // Slow text departure: while the sticky viewport is pinned, drift the
  // content upward on a quadratic ramp — near-zero speed at the section's
  // rest point, reaching exactly full scroll speed at the release, so
  // there is no stop-start rigidity and no kink at the hand-off.
  const applyTextDrift = () => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const viewportHeight = container.clientHeight;
    for (let i = 0; i < BODY_ORDER.length; i += 1) {
      const section = sectionRefs.current[i];
      const sticky = stickyRefs.current[i];
      if (!section || !sticky) {
        continue;
      }
      const hold = Math.max(1, section.offsetHeight - viewportHeight);
      const travelled = Math.min(
        Math.max(container.scrollTop - section.offsetTop, 0),
        hold,
      );
      // Cubic ramp: even slower creep early than the quadratic, still
      // reaching exactly full scroll speed at the release.
      const drift = (travelled * travelled * travelled) / (3 * hold * hold);
      sticky.style.transform = `translate3d(0, ${-drift}px, 0)`;
    }
  };

  const syncPose = () => {
    applyTextDrift();
    const pose = readPose();
    if (!pose) {
      return;
    }
    scrollPose.a = BODY_ORDER[pose.a];
    scrollPose.b = BODY_ORDER[pose.b];
    scrollPose.p = pose.p;

    const container = containerRef.current;
    const target = programmaticTarget.current;
    if (container && target !== null) {
      // Arrived, or the user grabbed the wheel mid-flight (scroll events
      // stop short of the target): release the guard either way.
      if (programmaticIdleTimer.current) {
        clearTimeout(programmaticIdleTimer.current);
      }
      if (Math.abs(container.scrollTop - target) < 4) {
        programmaticTarget.current = null;
      } else {
        programmaticIdleTimer.current = setTimeout(() => {
          programmaticTarget.current = null;
          syncPose();
        }, 250);
      }
      return; // Mid smooth-scroll: don't let crossed sections steal the view.
    }
    const currentId = pose.p < 0.5 ? BODY_ORDER[pose.a] : BODY_ORDER[pose.b];
    if (currentId !== useSiteStore.getState().view) {
      useSiteStore.getState().setViewFromScroll(currentId);
    }
  };

  // Land on the right section before first paint, without animation.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs only on mount/unmount of the scroller.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !mounted) {
      return;
    }
    const initial = useSiteStore.getState().view;
    if (initial !== "overview") {
      container.scrollTop = sectionRefs.current[BODY_ORDER.indexOf(initial)]?.offsetTop ?? 0;
    }
    syncPose();
  }, [mounted]);

  // A section you scrolled within starts back at its top on your next
  // visit: reset every non-current slot's inner scroller on view change.
  useEffect(() => {
    return useSiteStore.subscribe((state, previous) => {
      if (state.view === previous.view) {
        return;
      }
      for (let i = 0; i < BODY_ORDER.length; i += 1) {
        if (BODY_ORDER[i] !== state.view) {
          const inner = sectionRefs.current[i]?.querySelector("[data-panel-scroll]");
          if (inner) {
            inner.scrollTop = 0;
          }
        }
      }
    });
  }, []);

  // Tab clicks and keyboard navigation smooth-scroll to their section.
  useEffect(() => {
    return useSiteStore.subscribe((state, previous) => {
      if (
        state.view === previous.view ||
        state.view === "overview" ||
        state.viewSource === "scroll"
      ) {
        return;
      }
      const container = containerRef.current;
      if (!container) {
        return;
      }
      // Jump, don't animate: the camera flies planet to planet directly
      // while the content is dissolved, so scrolling through the
      // in-between sections would only drag the scrub through them.
      const target = sectionRefs.current[BODY_ORDER.indexOf(state.view)]?.offsetTop ?? 0;
      programmaticTarget.current = target;
      container.scrollTo({ top: target, behavior: "auto" });
    });
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      data-scroll-root
      onScroll={syncPose}
      className={`fixed inset-0 z-20 snap-y snap-mandatory overflow-y-auto transition-opacity duration-500 sm:snap-none ${
        uiVisible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      {BODY_ORDER.map((id, index) => {
        const Panel = PANELS[id];
        return (
          <section
            key={id}
            ref={(element) => {
              sectionRefs.current[index] = element;
            }}
            data-section={id}
            aria-label={BODY_MAP[id].sectionLabel}
            // Reels-style on phones: each section is a snap stop, so a
            // swipe settles on a page, never mid-gap. Desktop scrolls free.
            className={`snap-start sm:snap-align-none ${
              index === BODY_ORDER.length - 1 ? LAST_SLOT_CLASS : SLOT_CLASS
            } ${index > 0 ? SPACER_CLASS : ""}`}
          >
            {/* The sticky viewport pins the content through the slot's
                extra height before releasing it into the transition.
                Longer content scrolls inside it and chains to the page at
                its edges. */}
            <div
              ref={(element) => {
                stickyRefs.current[index] = element;
              }}
              className="sticky top-0 h-screen"
            >
              <div
                data-panel-scroll
                className="h-full overflow-y-auto sm:ml-auto sm:w-[46%] sm:max-w-xl"
              >
                <div className="flex min-h-full flex-col justify-center px-6 pb-20 pt-[42vh] sm:px-10 sm:py-24 sm:pt-24">
                  <Panel />
                </div>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
