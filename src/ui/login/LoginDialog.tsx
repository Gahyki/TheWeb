import { type FormEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  createOwnerSignIn,
  MESSAGES,
  type Outcome,
  type OwnerSignIn,
  type Step,
} from "../../auth/ownerSignIn";
import { getSupabase } from "../../auth/supabase";
import { signInBeside, useSiteStore } from "../../state/store";
import { TAB_BAR_PX } from "../mobile/MobileChrome";
import { API_BASE_URL, FIELD_BASE } from "../panels/ContactPanel";
import { Reveal } from "../Reveal";

let flow: OwnerSignIn | undefined;

/** Created on first open, so the Supabase client starts only here. */
function ownerSignIn() {
  flow ??= createOwnerSignIn({
    auth: getSupabase().auth,
    fetch: (url, init) => fetch(url, init),
    apiBase: API_BASE_URL,
  });
  return flow;
}

/** DOM names, opaque so login heuristics don't match them. */
const FIELD = { email: "f1", password: "f2", code: "f3", signOut: "signOut" } as const;
type Field = keyof typeof FIELD;

/** Asks browsers and password managers not to offer, fill, or save. */
const NO_AUTOFILL = {
  autoComplete: "off",
  "data-1p-ignore": "true",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;

/** The control each step focuses first. */
const FIRST: Record<Step, Field> = { credentials: "email", code: "code", signedIn: "signOut" };

const PROGRESS: Record<Step, string> = {
  credentials: "Signing in…",
  code: "Checking the code…",
  signedIn: "Signing out…",
};

/**
 * The owner's sign-in, in the section-panel slot beside the black hole.
 * Non-modal: the tabs, the pill, and Escape all close it. Mounted while
 * the sun collapses so the chunk and session load meanwhile; `shown`
 * reveals it once the hole has formed.
 */
export default function LoginDialog({ shown }: { shown: boolean }) {
  const large = useSiteStore((state) => state.isMobile);
  const beside = useSiteStore(signInBeside);
  const reducedMotion = useSiteStore((state) => state.reducedMotion);
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  /** Null until resume() says where the flow stands. */
  const [step, setStep] = useState<Step | null>(null);
  const stepRef = useRef<Step | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Outcome["invalid"] | null>(null);
  /** A fresh object per request, so the same field can be focused again. */
  const [focus, setFocus] = useState<{ name: Field } | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const apply = (next: Outcome) => {
    const previous = stepRef.current;
    stepRef.current = next.step;
    setStep(next.step);
    setError(next.error ?? null);
    setInvalid(next.invalid ?? null);
    // Secrets live only as long as their step, or until refused.
    if (next.step !== "credentials" || next.invalid === "password") {
      setPassword("");
    }
    if (next.step !== "code" || next.invalid === "code") {
      setCode("");
    }
    const target = next.invalid ?? (next.step !== previous ? FIRST[next.step] : null);
    if (target) {
      setFocus({ name: target });
    }
  };

  const run = async (action: (flow: OwnerSignIn) => Promise<Outcome>) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    setInvalid(null);
    let next: Outcome;
    try {
      next = await action(ownerSignIn());
    } catch {
      next = { step: stepRef.current ?? "credentials", error: MESSAGES.unavailable };
    }
    busyRef.current = false;
    if (mounted.current) {
      setBusy(false);
      apply(next);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: resumes once per mount.
  useEffect(() => {
    mounted.current = true;
    // Under StrictMode's re-run the first resume is still in flight; run() skips the second.
    void run((owner) => owner.resume());
    const stop = ownerSignIn().onSignedOut(() => {
      if (!busyRef.current && stepRef.current !== "credentials") {
        apply({ step: "credentials" });
      }
    });
    return () => {
      mounted.current = false;
      stop();
    };
  }, []);

  useEffect(() => {
    if (shown && focus) {
      rootRef.current
        ?.querySelector<HTMLElement>(`[name="${FIELD[focus.name]}"]`)
        ?.focus({ preventScroll: true });
    }
  }, [shown, focus]);

  // Runs before the dialog's nodes go, while focus can still be seen inside.
  useLayoutEffect(() => {
    const opener = document.activeElement;
    const root = rootRef.current;
    return () => {
      const active = document.activeElement;
      const focusWasOurs = !active || active === document.body || Boolean(root?.contains(active));
      // A tab that closed it keeps its focus; a canvas click opened it from body.
      if (focusWasOurs && opener instanceof HTMLElement && opener !== document.body && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  const submitCredentials = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run((owner) => owner.signIn(email.trim(), password));
  };
  const submitCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run((owner) => owner.verifyTotp(code));
  };
  const signOut = () => {
    void run((owner) => owner.signOut());
  };

  const fieldClasses = `${FIELD_BASE} ${large ? "px-4 py-3 text-base" : "px-3 py-2 text-sm"}`;
  const labelClasses = `flex flex-col uppercase text-white/50 ${
    large ? "gap-2 text-xs tracking-[0.25em]" : "gap-1 text-[10px] tracking-[0.3em]"
  }`;
  const buttonClasses = `rounded-full border border-white/20 uppercase text-white/80 transition hover:border-white/50 hover:text-white disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60 ${
    large
      ? "h-12 w-full text-xs tracking-[0.3em]"
      : "self-start px-6 py-2 text-[10px] tracking-[0.3em]"
  }`;
  const textButtonClasses = `self-start uppercase text-white/40 transition-colors hover:text-white/80 disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60 ${
    large ? "h-11 text-xs tracking-[0.25em]" : "text-[10px] tracking-[0.3em]"
  }`;
  const textSize = large ? "text-sm" : "text-xs";
  // A phone on its side: the side slot, between the header and the tab bar,
  // left of the header's back button (16px inset, 44px wide).
  const phoneSlot = large && beside;

  return (
    // Scrolls instead of clipping when the form outgrows a short screen;
    // auto margins (not flex alignment) keep its top reachable.
    <div
      className={`pointer-events-none fixed inset-0 z-20 flex overflow-y-auto ${beside ? "" : "flex-col"}`}
      style={
        phoneSlot
          ? {
              paddingTop: "calc(12px + env(safe-area-inset-top))",
              paddingBottom: `calc(${TAB_BAR_PX}px + env(safe-area-inset-bottom) + 12px)`,
            }
          : undefined
      }
    >
      <div
        ref={rootRef}
        role="dialog"
        aria-labelledby={titleId}
        inert={!shown}
        className={beside ? "my-auto ml-auto w-[46%] max-w-xl px-10" : "relative mt-auto w-full px-5 pt-20"}
        style={
          phoneSlot
            ? { paddingRight: "calc(72px + env(safe-area-inset-right))" }
            : beside
              ? undefined
              : { paddingBottom: `calc(${TAB_BAR_PX}px + env(safe-area-inset-bottom) + 20px)` }
        }
      >
        {!beside && (
          // The reels' scrim: legible over the disk, the hole above untouched.
          <div
            aria-hidden="true"
            className={`absolute inset-0 ${reducedMotion ? "" : "transition-opacity duration-500"} ${
              shown ? "opacity-100" : "opacity-0"
            }`}
            style={{
              background:
                "linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.78) 55%, rgba(0,0,0,0) 100%)",
            }}
          />
        )}
        <div
          className={`relative flex flex-col ${beside ? "" : "mx-auto max-w-xl"} ${large ? "gap-4" : "gap-5"} ${
            shown ? "pointer-events-auto" : ""
          }`}
        >
          <Reveal show={shown} i={0}>
            <h2
              id={titleId}
              className="font-mono text-[10px] uppercase tracking-[0.4em] text-cyan-100/50"
            >
              Sign in
            </h2>
          </Reveal>
          <Reveal show={shown} i={1}>
            {step === "credentials" && (
              <form
                {...NO_AUTOFILL}
                className={`flex flex-col ${large ? "gap-4" : "gap-3"}`}
                onSubmit={submitCredentials}
              >
                <label className={labelClasses}>
                  Email
                  <input
                    {...NO_AUTOFILL}
                    name={FIELD.email}
                    type="text"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    maxLength={254}
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className={fieldClasses}
                  />
                </label>
                <label className={labelClasses}>
                  Password
                  <input
                    {...NO_AUTOFILL}
                    name={FIELD.password}
                    type="password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-invalid={invalid === "password" || undefined}
                    className={fieldClasses}
                  />
                </label>
                <button type="submit" disabled={busy} className={buttonClasses}>
                  Sign in
                </button>
              </form>
            )}
            {step === "code" && (
              <form
                {...NO_AUTOFILL}
                className={`flex flex-col ${large ? "gap-4" : "gap-3"}`}
                onSubmit={submitCode}
              >
                <label className={labelClasses}>
                  Authenticator code
                  <input
                    {...NO_AUTOFILL}
                    name={FIELD.code}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    aria-invalid={invalid === "code" || undefined}
                    className={fieldClasses}
                  />
                </label>
                <button type="submit" disabled={busy} className={buttonClasses}>
                  Verify
                </button>
                <button type="button" onClick={signOut} disabled={busy} className={textButtonClasses}>
                  Sign out
                </button>
              </form>
            )}
            {step === "signedIn" && (
              <button
                type="button"
                name={FIELD.signOut}
                onClick={signOut}
                disabled={busy}
                className={buttonClasses}
              >
                Sign out
              </button>
            )}
          </Reveal>
          <Reveal show={shown} i={2}>
            {/* Persistent live region: toggling text (not the element) so screen readers announce it. */}
            <p className={`${textSize} font-light text-cyan-100/80`} role="status" aria-live="polite">
              {busy && step ? PROGRESS[step] : step === "signedIn" ? "Signed in." : null}
            </p>
            {error && (
              <p className={`${textSize} font-light text-red-200/80`} role="alert">
                {error}
              </p>
            )}
          </Reveal>
        </div>
      </div>
    </div>
  );
}
