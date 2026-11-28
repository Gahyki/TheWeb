import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createOwnerSignIn,
  MESSAGES,
  type Outcome,
  type OwnerAuth,
} from "../src/auth/ownerSignIn.js";

type Failure = { name?: string; status?: number; code?: string };
/** An /api/me reply; a missing body is one that is not JSON. */
type Reply = { status: number; body?: unknown };

const apiError = (status: number, code?: string): Failure => ({ name: "AuthApiError", status, code });
const retryable = (status = 0): Failure => ({ name: "AuthRetryableFetchError", status });

const API = "https://api.test";
const REFUSED: Outcome = { step: "credentials", error: MESSAGES.refused, invalid: "password" };

/** PR #12's /api/me for the owner: aal1 needs the second factor, aal2 passes. */
function ownerApi(token: string): Reply {
  return token === "aal2"
    ? { status: 200, body: { id: "owner" } }
    : { status: 403, body: { error: "Multi-factor authentication is required.", code: "mfa_required" } };
}

/** A scripted auth client and API that log every call in order. */
function harness(
  script: {
    /** Access token of the stored session, named by its aal. */
    session?: string | null;
    signIn?: Failure;
    sessionError?: Failure;
    factors?: { id: string }[];
    factorsError?: Failure;
    verify?: Failure;
    me?: (token: string) => Reply | "network";
    apiBase?: string;
  } = {},
) {
  const calls: string[] = [];
  let token = script.session ?? null;
  const listeners: ((event: string) => void)[] = [];
  const auth: OwnerAuth = {
    async signInWithPassword({ email, password }) {
      calls.push(`signIn ${email} ${password}`);
      if (script.signIn) {
        return { error: script.signIn };
      }
      token = "aal1";
      return { error: null };
    },
    async getSession() {
      calls.push("getSession");
      if (script.sessionError) {
        return { data: { session: null }, error: script.sessionError };
      }
      return {
        data: { session: token ? { access_token: token, user: { id: "owner" } } : null },
        error: null,
      };
    },
    async signOut({ scope }) {
      calls.push(`signOut ${scope}`);
      token = null;
      return { error: null };
    },
    onAuthStateChange(callback) {
      calls.push("subscribe");
      listeners.push(callback);
      return { data: { subscription: { unsubscribe: () => calls.push("unsubscribe") } } };
    },
    mfa: {
      async listFactors() {
        calls.push("listFactors");
        if (script.factorsError) {
          return { data: null, error: script.factorsError };
        }
        return { data: { totp: script.factors ?? [{ id: "factor-1" }] }, error: null };
      },
      async challengeAndVerify({ factorId, code }) {
        calls.push(`challengeAndVerify ${factorId} ${code}`);
        if (script.verify) {
          return { error: script.verify };
        }
        token = "aal2";
        return { error: null };
      },
    },
  };
  const flow = createOwnerSignIn({
    auth,
    apiBase: script.apiBase ?? API,
    fetch: async (url, init) => {
      calls.push(`GET ${url} ${init.headers.Authorization}`);
      const reply = (script.me ?? ownerApi)(init.headers.Authorization.replace(/^Bearer /, ""));
      if (reply === "network") {
        throw new TypeError("Failed to fetch");
      }
      return {
        status: reply.status,
        json: async () => {
          if (reply.body === undefined) {
            throw new SyntaxError("Unexpected token '<'");
          }
          return reply.body;
        },
      };
    },
  });
  return {
    flow,
    calls,
    session: () => token,
    emit: (event: string) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

test("password, then the code, signs the owner in", async () => {
  const { flow, calls, session } = harness();
  assert.deepEqual(await flow.signIn("owner@example.com", "hunter22"), { step: "code" });
  assert.deepEqual(calls.splice(0), [
    "signIn owner@example.com hunter22",
    "getSession",
    `GET ${API}/api/me Bearer aal1`,
    "listFactors",
  ]);

  assert.deepEqual(await flow.verifyTotp("123456"), { step: "signedIn" });
  assert.deepEqual(calls, [
    "listFactors",
    "challengeAndVerify factor-1 123456",
    "getSession",
    `GET ${API}/api/me Bearer aal2`,
  ]);
  assert.equal(session(), "aal2");
});

test("without a base URL the API is same-origin", async () => {
  const { flow, calls } = harness({ session: "aal2", apiBase: "" });
  assert.deepEqual(await flow.checkOwner(), { step: "signedIn" });
  assert.deepEqual(calls, ["getSession", "GET /api/me Bearer aal2"]);
});

for (const [label, error, expected] of [
  ["a wrong password", apiError(400, "invalid_credentials"), REFUSED],
  // Supabase's other refusals would tell a stranger the account exists.
  ["an unconfirmed email", apiError(400, "email_not_confirmed"), REFUSED],
  ["a banned user", apiError(400, "user_banned"), REFUSED],
  [
    "a rate limit",
    apiError(429, "over_request_rate_limit"),
    { step: "credentials", error: MESSAGES.tooMany },
  ],
  ["a network failure", retryable(0), { step: "credentials", error: MESSAGES.unavailable }],
  ["a 503", retryable(503), { step: "credentials", error: MESSAGES.unavailable }],
  ["a reply that is not JSON", { name: "AuthUnknownError" }, { step: "credentials", error: MESSAGES.unavailable }],
] as const) {
  test(`${label} at the password step never reaches the API`, async () => {
    const { flow, calls } = harness({ signIn: error });
    assert.deepEqual(await flow.signIn("someone@example.com", "guess"), expected);
    assert.deepEqual(calls, ["signIn someone@example.com guess"]);
  });
}

for (const [label, reply] of [
  ["401", { status: 401, body: { error: "Sign-in required." } }],
  ["not_allowed", { status: 403, body: { error: "This account is not allowed here.", code: "not_allowed" } }],
  ["a 403 that is not JSON", { status: 403 }],
  ["a 403 with an unknown code", { status: 403, body: { error: "No.", code: "other" } }],
] as const) {
  test(`/api/me ${label} refuses like a wrong password and signs out locally`, async () => {
    const { flow, calls, session } = harness({ me: () => reply });
    assert.deepEqual(await flow.signIn("stranger@example.com", "right-password"), REFUSED);
    assert.deepEqual(calls, [
      "signIn stranger@example.com right-password",
      "getSession",
      `GET ${API}/api/me Bearer aal1`,
      "signOut local",
    ]);
    assert.equal(session(), null);
  });
}

for (const [label, reply, error] of [
  ["503", { status: 503, body: { error: "Sign-in is not configured." } }, MESSAGES.unavailable],
  ["502 that is not JSON", { status: 502 }, MESSAGES.unavailable],
  ["network failure", "network", MESSAGES.unavailable],
  ["429", { status: 429, body: { error: "Slow down." } }, MESSAGES.tooMany],
] as const) {
  test(`/api/me ${label} is transient and keeps the session`, async () => {
    const { flow, calls, session } = harness({ me: () => reply });
    assert.deepEqual(await flow.signIn("owner@example.com", "hunter22"), { step: "credentials", error });
    assert.equal(calls.at(-1), `GET ${API}/api/me Bearer aal1`);
    assert.equal(session(), "aal1");
  });
}

for (const [label, reply] of [
  ["that is not JSON", { status: 200 }],
  ["with a null body", { status: 200, body: null }],
  ["without an id", { status: 200, body: {} }],
  ["with a non-string id", { status: 200, body: { id: 42 } }],
  ["for another user", { status: 200, body: { id: "someone-else" } }],
] as const) {
  test(`/api/me 200 ${label} never signs in and keeps the session`, async () => {
    const me = (token: string) => (token === "aal2" ? reply : ownerApi(token));
    const code = harness({ session: "aal1", me });
    assert.deepEqual(await code.flow.verifyTotp("123456"), { step: "code", error: MESSAGES.unavailable });
    assert.equal(code.session(), "aal2");

    const resumed = harness({ session: "aal2", me });
    assert.deepEqual(await resumed.flow.resume(), { step: "credentials", error: MESSAGES.unavailable });
    assert.deepEqual(await resumed.flow.checkOwner(), { step: "credentials", error: MESSAGES.unavailable });
    assert.equal(resumed.session(), "aal2");
  });
}

test("an owner without a verified authenticator is told so and signed out", async () => {
  const { flow, calls, session } = harness({ factors: [] });
  assert.deepEqual(await flow.signIn("owner@example.com", "hunter22"), {
    step: "credentials",
    error: MESSAGES.noFactor,
  });
  assert.deepEqual(calls.slice(-2), ["listFactors", "signOut local"]);
  assert.equal(session(), null);
});

test("listing factors at the password step: outages stay, refusals sign out", async () => {
  const down = harness({ factorsError: retryable(0) });
  assert.deepEqual(await down.flow.signIn("owner@example.com", "hunter22"), {
    step: "credentials",
    error: MESSAGES.unavailable,
  });
  assert.equal(down.session(), "aal1");

  const gone = harness({ factorsError: apiError(401, "bad_jwt") });
  assert.deepEqual(await gone.flow.signIn("owner@example.com", "hunter22"), REFUSED);
  assert.equal(gone.calls.at(-1), "signOut local");
});

for (const [label, error, expected] of [
  [
    "a wrong code",
    apiError(422, "mfa_verification_failed"),
    { step: "code", error: MESSAGES.wrongCode, invalid: "code" },
  ],
  [
    "an expired challenge",
    apiError(422, "mfa_challenge_expired"),
    { step: "code", error: MESSAGES.wrongCode, invalid: "code" },
  ],
  ["a rate limit", apiError(429, "over_request_rate_limit"), { step: "code", error: MESSAGES.tooMany }],
  ["a network failure", retryable(0), { step: "code", error: MESSAGES.unavailable }],
] as const) {
  test(`${label} at the code step keeps the session for another try`, async () => {
    const { flow, calls, session } = harness({ session: "aal1", verify: error });
    assert.deepEqual(await flow.verifyTotp("000000"), expected);
    assert.deepEqual(calls, ["listFactors", "challengeAndVerify factor-1 000000"]);
    assert.equal(session(), "aal1");
  });
}

for (const [label, error] of [
  ["a missing session", { name: "AuthSessionMissingError", status: 400 }],
  ["a rejected token", apiError(401, "bad_jwt")],
  ["a deleted user", apiError(403, "user_not_found")],
] as const) {
  test(`${label} at the code step returns to the password, signed out`, async () => {
    const { flow, calls } = harness({ session: "aal1", verify: error });
    assert.deepEqual(await flow.verifyTotp("123456"), REFUSED);
    assert.equal(calls.at(-1), "signOut local");
  });
}

test("the code step handles factor-list failures and a vanished authenticator", async () => {
  const down = harness({ session: "aal1", factorsError: retryable(503) });
  assert.deepEqual(await down.flow.verifyTotp("123456"), { step: "code", error: MESSAGES.unavailable });
  assert.deepEqual(down.calls, ["listFactors"]);

  const none = harness({ session: "aal1", factors: [] });
  assert.deepEqual(await none.flow.verifyTotp("123456"), {
    step: "credentials",
    error: MESSAGES.noFactor,
  });
  assert.deepEqual(none.calls, ["listFactors", "signOut local"]);
});

test("an API outage after the code stays on the code step", async () => {
  const { flow, session } = harness({
    session: "aal1",
    me: (token) => (token === "aal2" ? { status: 503 } : ownerApi(token)),
  });
  assert.deepEqual(await flow.verifyTotp("123456"), { step: "code", error: MESSAGES.unavailable });
  assert.equal(session(), "aal2");
});

test("resume starts at the form without a session, and asks nobody", async () => {
  const { flow, calls } = harness();
  assert.deepEqual(await flow.resume(), { step: "credentials" });
  assert.deepEqual(calls, ["getSession"]);
});

test("resume picks up a half-done or finished sign-in", async () => {
  const half = harness({ session: "aal1" });
  assert.deepEqual(await half.flow.resume(), { step: "code" });
  assert.deepEqual(half.calls, ["getSession", `GET ${API}/api/me Bearer aal1`, "listFactors"]);

  const done = harness({ session: "aal2" });
  assert.deepEqual(await done.flow.resume(), { step: "signedIn" });
});

test("resume drops a refused session quietly", async () => {
  for (const reply of [{ status: 401 }, { status: 403, body: { code: "not_allowed" } }]) {
    const { flow, calls, session } = harness({ session: "aal1", me: () => reply });
    assert.deepEqual(await flow.resume(), { step: "credentials" });
    assert.equal(calls.at(-1), "signOut local");
    assert.equal(session(), null);
  }
  const rejected = harness({ sessionError: apiError(400, "refresh_token_not_found") });
  assert.deepEqual(await rejected.flow.resume(), { step: "credentials" });
  assert.deepEqual(rejected.calls, ["getSession", "signOut local"]);
});

test("resume reports an outage and keeps the session", async () => {
  const api = harness({ session: "aal2", me: () => "network" });
  assert.deepEqual(await api.flow.resume(), { step: "credentials", error: MESSAGES.unavailable });
  assert.equal(api.session(), "aal2");

  const refresh = harness({ sessionError: retryable(0) });
  assert.deepEqual(await refresh.flow.resume(), { step: "credentials", error: MESSAGES.unavailable });
  assert.deepEqual(refresh.calls, ["getSession"]);
});

test("checkOwner without a session refuses", async () => {
  const { flow, calls } = harness();
  assert.deepEqual(await flow.checkOwner(), REFUSED);
  assert.deepEqual(calls, ["getSession", "signOut local"]);
});

test("sign-out is local and returns to the form", async () => {
  const { flow, calls, session } = harness({ session: "aal2" });
  assert.deepEqual(await flow.signOut(), { step: "credentials" });
  assert.deepEqual(calls, ["signOut local"]);
  assert.equal(session(), null);
});

test("onSignedOut hears only SIGNED_OUT, until unsubscribed", () => {
  const { flow, calls, emit } = harness();
  let heard = 0;
  const stop = flow.onSignedOut(() => {
    heard += 1;
  });
  emit("SIGNED_IN");
  emit("TOKEN_REFRESHED");
  emit("SIGNED_OUT");
  assert.equal(heard, 1);
  stop();
  assert.deepEqual(calls, ["subscribe", "unsubscribe"]);
});

test("the flow never logs", async () => {
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const original = methods.map((method) => console[method]);
  const logged: unknown[] = [];
  for (const method of methods) {
    console[method] = (...args: unknown[]) => logged.push(args);
  }
  try {
    const { flow } = harness();
    await flow.signIn("owner@example.com", "hunter22");
    await flow.verifyTotp("123456");
    await flow.signOut();
    await harness({ me: () => "network" }).flow.signIn("owner@example.com", "hunter22");
    await harness({ verify: apiError(422) }).flow.verifyTotp("000000");
  } finally {
    methods.forEach((method, index) => {
      console[method] = original[index];
    });
  }
  assert.deepEqual(logged, []);
});
