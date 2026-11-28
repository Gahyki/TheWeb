/**
 * The owner sign-in flow: password, the server's verdict (GET /api/me),
 * then a TOTP code. Pure over an injected auth client and fetch, so it runs
 * under node tests. Refusals share one message, so a stranger never learns
 * whether an account exists or is allowed.
 */

/** A supabase-js AuthError, read structurally. */
type AuthFailure = { name?: string; status?: number; code?: string };

/** The slice of a supabase-js session the flow reads. */
type Session = { access_token: string; user: { id: string } };

/** The slice of supabase-js's `auth` client the flow uses. */
export type OwnerAuth = {
  signInWithPassword(credentials: { email: string; password: string }): Promise<{
    error: AuthFailure | null;
  }>;
  getSession(): Promise<{
    data: { session: Session | null };
    error: AuthFailure | null;
  }>;
  signOut(options: { scope: "local" }): Promise<{ error: AuthFailure | null }>;
  onAuthStateChange(callback: (event: string) => void): {
    data: { subscription: { unsubscribe(): void } };
  };
  mfa: {
    listFactors(): Promise<{ data: { totp: { id: string }[] } | null; error: AuthFailure | null }>;
    challengeAndVerify(params: { factorId: string; code: string }): Promise<{
      error: AuthFailure | null;
    }>;
  };
};

export type OwnerFetch = (
  url: string,
  init: { headers: Record<string, string> },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export type Step = "credentials" | "code" | "signedIn";

/** Where the flow stands, what to tell the owner, and which field to fix. */
export type Outcome = { step: Step; error?: string; invalid?: "password" | "code" };

export const MESSAGES = {
  refused: "Sign-in failed.",
  tooMany: "Too many attempts. Try again later.",
  unavailable: "Sign-in is unavailable.",
  wrongCode: "That code didn't work.",
  noFactor: "The authenticator is not set up.",
} as const;

const REFUSED: Outcome = { step: "credentials", error: MESSAGES.refused, invalid: "password" };

function classify(error: AuthFailure): "tooMany" | "unavailable" | "refused" {
  if (error.status === 429) {
    return "tooMany";
  }
  // Network failures and 5xx arrive as AuthRetryableFetchError (status 0
  // or 5xx); a reply that is not JSON has no status at all.
  if (error.name === "AuthRetryableFetchError" || !error.status || error.status >= 500) {
    return "unavailable";
  }
  return "refused";
}

export function createOwnerSignIn({
  auth,
  fetch,
  apiBase = "",
}: {
  auth: OwnerAuth;
  fetch: OwnerFetch;
  apiBase?: string;
}) {
  /**
   * Ends this browser's session and revokes its refresh token; the access
   * token stays valid until it expires.
   */
  const refuse = async (outcome = REFUSED): Promise<Outcome> => {
    await auth.signOut({ scope: "local" });
    return outcome;
  };

  /** Transient failures stay on `step` and keep the session; refusals end it. */
  const fail = (error: AuthFailure, step: Step): Promise<Outcome> | Outcome => {
    const kind = classify(error);
    return kind === "refused" ? refuse() : { step, error: MESSAGES[kind] };
  };

  /** The code step, if the owner has a verified authenticator. */
  const codeStep = async (): Promise<Outcome> => {
    const { data, error } = await auth.mfa.listFactors();
    if (error) {
      return fail(error, "credentials");
    }
    if (!data) {
      return { step: "credentials", error: MESSAGES.unavailable };
    }
    return data.totp.length > 0
      ? { step: "code" }
      : refuse({ step: "credentials", error: MESSAGES.noFactor });
  };

  /** Asks the API whether this session is the owner's, and at which level. */
  const verdict = async (session: Session, step: Step): Promise<Outcome> => {
    let response: Awaited<ReturnType<OwnerFetch>>;
    try {
      response = await fetch(`${apiBase}/api/me`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
    } catch {
      return { step, error: MESSAGES.unavailable };
    }
    if (response.status === 200) {
      // Only the API's record of this user counts as a verdict.
      const body = await response.json().catch(() => null);
      const id = typeof body === "object" && body !== null && "id" in body ? body.id : null;
      return typeof id === "string" && id === session.user.id
        ? { step: "signedIn" }
        : { step, error: MESSAGES.unavailable };
    }
    if (response.status === 401) {
      return refuse();
    }
    if (response.status === 403) {
      const body = await response.json().catch(() => null);
      const code = typeof body === "object" && body !== null && "code" in body ? body.code : null;
      return code === "mfa_required" ? codeStep() : refuse();
    }
    return { step, error: response.status === 429 ? MESSAGES.tooMany : MESSAGES.unavailable };
  };

  const checkOwner = async (step: Step): Promise<Outcome> => {
    const { data, error } = await auth.getSession();
    if (error) {
      return fail(error, step);
    }
    return data.session ? verdict(data.session, step) : refuse();
  };

  return {
    async signIn(email: string, password: string): Promise<Outcome> {
      const { error } = await auth.signInWithPassword({ email, password });
      if (error) {
        const kind = classify(error);
        return kind === "refused" ? REFUSED : { step: "credentials", error: MESSAGES[kind] };
      }
      return checkOwner("credentials");
    },

    checkOwner: () => checkOwner("credentials"),

    async verifyTotp(code: string): Promise<Outcome> {
      const { data, error } = await auth.mfa.listFactors();
      if (error) {
        return fail(error, "code");
      }
      if (!data) {
        return { step: "code", error: MESSAGES.unavailable };
      }
      const factor = data.totp[0];
      if (!factor) {
        return refuse({ step: "credentials", error: MESSAGES.noFactor });
      }
      const { error: verifyError } = await auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (verifyError) {
        const kind = classify(verifyError);
        if (kind !== "refused") {
          return { step: "code", error: MESSAGES[kind] };
        }
        const sessionGone =
          verifyError.name === "AuthSessionMissingError" ||
          verifyError.status === 401 ||
          verifyError.status === 403;
        return sessionGone ? refuse() : { step: "code", error: MESSAGES.wrongCode, invalid: "code" };
      }
      return checkOwner("code");
    },

    /** Picks up a session that survived a reload, or starts at the form. */
    async resume(): Promise<Outcome> {
      const { data, error } = await auth.getSession();
      let outcome: Outcome;
      if (error) {
        outcome = await fail(error, "credentials");
      } else if (data.session) {
        outcome = await verdict(data.session, "credentials");
      } else {
        return { step: "credentials" };
      }
      // A stale session is not a failed attempt: it goes quietly.
      return outcome === REFUSED ? { step: "credentials" } : outcome;
    },

    async signOut(): Promise<Outcome> {
      await auth.signOut({ scope: "local" });
      return { step: "credentials" };
    },

    /** Calls `listener` when the session ends elsewhere (another tab, a rejected refresh). */
    onSignedOut(listener: () => void): () => void {
      const { data } = auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") {
          listener();
        }
      });
      return () => data.subscription.unsubscribe();
    },
  };
}

export type OwnerSignIn = ReturnType<typeof createOwnerSignIn>;
