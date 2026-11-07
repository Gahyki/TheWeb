import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useSiteStore } from "../../state/store";

/**
 * Bottom sheet for content too long for a reel's overlay — the "…more" of
 * a long caption. It owns scrolling while open (the reel scroller is
 * locked), so swipes inside it never page the reels. Escape, the close
 * button, and tapping the backdrop all dismiss it; focus moves in on open
 * and returns to the opener on close.
 */
export function Sheet({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const reducedMotion = useSiteStore((state) => state.reducedMotion);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<Element | null>(null);
  // Mounted one frame before "shown" so the slide-up transition runs.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      openerRef.current = document.activeElement;
      setMounted(true);
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), reducedMotion ? 0 : 300);
    if (openerRef.current instanceof HTMLElement) {
      openerRef.current.focus();
    }
    return () => clearTimeout(timer);
  }, [open, reducedMotion]);

  useEffect(() => {
    if (shown) {
      closeRef.current?.focus();
    }
  }, [shown]);

  if (!mounted) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50" data-sheet>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className={`absolute inset-0 bg-black/60 transition-opacity ${shown ? "opacity-100" : "opacity-0"}`}
        style={{ transitionDuration: reducedMotion ? "0ms" : "300ms" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
        className={`absolute inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-white/15 bg-black/90 backdrop-blur-md transition-transform ease-out ${
          shown ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ transitionDuration: reducedMotion ? "0ms" : "300ms" }}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20" aria-hidden="true" />
        <div className="flex items-center justify-between px-5 pt-2">
          <h2 id={titleId} className="font-mono text-xs uppercase tracking-[0.4em] text-cyan-100/60">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 flex h-11 w-11 items-center justify-center text-xl leading-none text-white/60 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-5 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-2">
          {children}
        </div>
      </div>
    </div>
  );
}
