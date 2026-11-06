import { useRef, useState, type FormEvent } from "react";
import { publicContactEmail } from "../../data/contact";
import { Eyebrow, Reveal } from "../Reveal";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
const DEFAULT_ERROR = "The contact form is unavailable right now. Please try again later.";

const fieldClasses =
  "w-full border border-white/15 bg-transparent px-3 py-2 text-sm font-light text-white placeholder-white/30 transition-colors focus:border-white/50 focus:outline-none";

export function ContactPanel() {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState(DEFAULT_ERROR);
  const [emailInvalid, setEmailInvalid] = useState(false);
  const emailInputRef = useRef<HTMLInputElement>(null);

  async function submitContactForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setErrorMessage(DEFAULT_ERROR);
    setEmailInvalid(false);

    const form = event.currentTarget;
    const values = new FormData(form);

    try {
      const response = await fetch(`${API_BASE_URL}/api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.get("name"),
          email: values.get("email"),
          // The API rejects CR, so send textarea line breaks as LF only.
          message: String(values.get("message") ?? "").replace(/\r\n?/g, "\n"),
        }),
      });

      if (!response.ok) {
        let responseBody: unknown;
        try {
          responseBody = await response.json();
        } catch {
          setStatus("error");
          return;
        }
        if (typeof responseBody === "object" && responseBody !== null) {
          if ("error" in responseBody && typeof responseBody.error === "string") {
            setErrorMessage(responseBody.error);
          }
          if ("field" in responseBody && responseBody.field === "email") {
            setEmailInvalid(true);
            emailInputRef.current?.focus();
          }
        }
        setStatus("error");
        return;
      }

      form.reset();
      setStatus("success");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex h-full flex-col justify-center gap-5">
      <Reveal i={0}>
        <Eyebrow>Contact</Eyebrow>
      </Reveal>
      <Reveal i={1}>
        <h2 className="text-3xl font-extralight tracking-wide text-white">
          Curiosity makes good company.
        </h2>
      </Reveal>
      <Reveal i={2}>
        <p className="max-w-md text-sm font-light leading-relaxed text-white/60">
          I'm always interested in thoughtful work, interesting problems, and ideas worth
          exploring.
        </p>
      </Reveal>
      <Reveal i={3}>
        <form className="flex flex-col gap-3" autoComplete="off" onSubmit={submitContactForm}>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.3em] text-white/50">
            Name
            <input name="name" autoComplete="off" maxLength={100} required className={fieldClasses} />
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.3em] text-white/50">
            Email
            <input
              ref={emailInputRef}
              name="email"
              type="text"
              inputMode="email"
              autoComplete="off"
              maxLength={254}
              required
              aria-invalid={emailInvalid || undefined}
              className={fieldClasses}
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.3em] text-white/50">
            Message
            <textarea
              name="message"
              autoComplete="off"
              rows={4}
              minLength={10}
              maxLength={5000}
              required
              className={fieldClasses}
            />
          </label>
          <button
            type="submit"
            disabled={status === "sending"}
            className="self-start rounded-full border border-white/20 px-6 py-2 text-[10px] uppercase tracking-[0.3em] text-white/80 transition hover:border-white/50 hover:text-white disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
          >
            {status === "sending" ? "Sending…" : "Send message"}
          </button>
          {/* Persistent live region: toggling text (not the element) so screen readers announce it. */}
          <p className="text-xs font-light text-cyan-100/80" role="status" aria-live="polite">
            {status === "success" ? "Thanks, your message was sent." : null}
          </p>
          {status === "error" && (
            <p className="text-xs font-light text-red-200/80" role="alert">
              {errorMessage}
            </p>
          )}
        </form>
      </Reveal>
      <Reveal i={4}>
        <p className="text-xs font-light text-white/40">
          {publicContactEmail ? (
            <>
              Prefer email?{" "}
              <a
                href={`mailto:${publicContactEmail}`}
                className="text-cyan-100/70 transition-colors hover:text-white"
              >
                {publicContactEmail}
              </a>
            </>
          ) : (
            "Email address coming soon."
          )}
        </p>
      </Reveal>
    </div>
  );
}
