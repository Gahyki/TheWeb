import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import express, { type RequestHandler } from "express";
import {
  CompactSign,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWK,
  type JWTPayload,
  SignJWT,
  UnsecuredJWT,
} from "jose";
import { createApp } from "../server/app.js";
import { createRequireUser, parseAllowedUserIds, parseSupabaseUrl } from "../server/auth.js";
import { startApiServer } from "./apiServer.js";

const PROJECT_URL = "https://test-project.supabase.co";
const ISSUER = `${PROJECT_URL}/auth/v1`;
const OWNER_ID = "8d0f6e3c-2b1a-4c5d-9e8f-7a6b5c4d3e2f";
const STRANGER_ID = "11111111-2222-4333-8444-555555555555";

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;
type ApiServer = Awaited<ReturnType<typeof startApiServer>>;
type SignOptions = {
  alg?: "ES256" | "RS256" | "ES384";
  kid?: string | null;
  key?: KeyPair["privateKey"];
  issuer?: string;
  audience?: string | string[];
  subject?: string;
  expiresAt?: string | number | null;
  issuedAt?: boolean;
  crit?: string[];
};

const signingKeys = new Map<string, KeyPair>();
let strayKeys: KeyPair;
let publicJwks: JWK[];
let gate: ApiServer;
let handlerCalls = 0;

function claims(overrides: JWTPayload = {}): JWTPayload {
  return {
    role: "authenticated",
    aal: "aal2",
    session_id: "5b4a3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d",
    is_anonymous: false,
    ...overrides,
  };
}

function signToken(payload: JWTPayload = claims(), options: SignOptions = {}) {
  const alg = options.alg ?? "ES256";
  const crit = options.crit ?? [];
  const header = {
    alg,
    ...(options.kid === null ? {} : { kid: options.kid ?? alg }),
    ...(crit.length ? { crit, ...Object.fromEntries(crit.map((name) => [name, true])) } : {}),
  };
  const jwt = new SignJWT(payload)
    .setProtectedHeader(header)
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience(options.audience ?? "authenticated")
    .setSubject(options.subject ?? OWNER_ID);
  if (options.issuedAt !== false) {
    jwt.setIssuedAt();
  }
  if (options.expiresAt !== null) {
    jwt.setExpirationTime(options.expiresAt ?? "1h");
  }
  const key = options.key ?? signingKeys.get(alg)?.privateKey;
  assert.ok(key);
  return jwt.sign(key, { crit: Object.fromEntries(crit.map((name) => [name, true])) });
}

/** Signs an arbitrary payload string with the trusted ES256 key, bypassing SignJWT's claim typing. */
function signRaw(payload: string) {
  const key = signingKeys.get("ES256")?.privateKey;
  assert.ok(key);
  return new CompactSign(new TextEncoder().encode(payload))
    .setProtectedHeader({ alg: "ES256", kid: "ES256" })
    .sign(key);
}

function rawClaims(overrides: Record<string, unknown>) {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    ...claims(),
    sub: OWNER_ID,
    iss: ISSUER,
    aud: "authenticated",
    iat: now,
    exp: now + 3600,
    ...overrides,
  });
}

function gatedApp(options: Parameters<typeof createRequireUser>[0]) {
  const app = express();
  app.get("/gated", createRequireUser(options), (_request, response) => {
    handlerCalls += 1;
    response.json(response.locals.user);
  });
  return app;
}

async function callGate(server: ApiServer, authorization?: string) {
  const callsBefore = handlerCalls;
  const response = await fetch(`${server.baseUrl}/gated`, {
    headers: authorization === undefined ? {} : { Authorization: authorization },
  });
  const body: unknown = await response.json();
  // Express reports errors thrown after a response on a later tick.
  await new Promise((resolve) => setImmediate(resolve));
  return { response, body, handlerRan: handlerCalls > callsBefore };
}

function startKeyServer(handler: RequestHandler) {
  const app = express();
  app.get("/auth/v1/.well-known/jwks.json", handler);
  return startApiServer(app);
}

before(async () => {
  for (const alg of ["ES256", "RS256", "ES384"] as const) {
    signingKeys.set(alg, await generateKeyPair(alg));
  }
  strayKeys = await generateKeyPair("ES256");
  publicJwks = await Promise.all(
    [...signingKeys].map(async ([alg, pair]) => ({
      ...(await exportJWK(pair.publicKey)),
      kid: alg,
      alg,
    })),
  );
  gate = await startApiServer(
    gatedApp({
      supabaseUrl: PROJECT_URL,
      allowedUserIds: OWNER_ID,
      keys: createLocalJWKSet({ keys: publicJwks }),
    }),
  );
});

after(async () => {
  await gate.close();
});

const SIGN_IN_REQUIRED = { error: "Sign-in required." };
const NOT_CONFIGURED = { error: "Sign-in is not configured." };
const UNAVAILABLE = { error: "Sign-in is temporarily unavailable." };

describe("sign-in gate", () => {
  const accepted: Array<[string, () => Promise<string>, string?]> = [
    ["an ES256 token", () => signToken()],
    ["an RS256 token", () => signToken(claims(), { alg: "RS256" })],
    ["an audience array that includes authenticated", () => signToken(claims(), { audience: ["authenticated", "other"] })],
    ["a token without an is_anonymous claim", () => signToken(claims({ is_anonymous: undefined }))],
    ["a lowercase bearer scheme", () => signToken(), "bearer"],
    ["several spaces after the scheme", () => signToken(), "Bearer  "],
  ];

  for (const [name, makeToken, scheme = "Bearer "] of accepted) {
    test(`admits the allowlisted owner with ${name}`, async () => {
      const prefix = scheme.endsWith(" ") ? scheme : `${scheme} `;
      const { response, body, handlerRan } = await callGate(gate, `${prefix}${await makeToken()}`);
      assert.equal(response.status, 200);
      assert.deepEqual(body, { id: OWNER_ID });
      assert.ok(handlerRan);
    });
  }

  test("rejects a request with no Authorization header", async (t) => {
    const errorLog = t.mock.method(console, "error", () => {});
    const { response, body, handlerRan } = await callGate(gate);
    assert.equal(response.status, 401);
    assert.deepEqual(body, SIGN_IN_REQUIRED);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
    assert.ok(!handlerRan);
    assert.equal(errorLog.mock.callCount(), 0);
  });

  const malformedHeaders: Array<[string, () => Promise<string>]> = [
    ["Basic credentials", async () => "Basic dXNlcjpwYXNz"],
    ["a bare scheme", async () => "Bearer"],
    ["a scheme with no token", async () => "Bearer "],
    ["two tokens", async () => "Bearer a b"],
    ["no scheme", async () => "token"],
    ["no space after the scheme", async () => `Bearer${await signToken()}`],
    ["text before the scheme", async () => `X Bearer ${await signToken()}`],
    ["text after the token", async () => `Bearer ${await signToken()} trailing`],
  ];

  for (const [name, makeHeader] of malformedHeaders) {
    test(`rejects an Authorization header with ${name}`, async (t) => {
      const errorLog = t.mock.method(console, "error", () => {});
      const { response, body, handlerRan } = await callGate(gate, await makeHeader());
      assert.equal(response.status, 401);
      assert.deepEqual(body, SIGN_IN_REQUIRED);
      assert.equal(response.headers.get("www-authenticate"), 'Bearer error="invalid_token"');
      assert.ok(!handlerRan);
      assert.equal(errorLog.mock.callCount(), 0);
    });
  }

  for (const aal of ["aal2", "aal1"]) {
    test(`refuses a verified ${aal} user who is not allowlisted`, async () => {
      const token = await signToken(claims({ aal }), { subject: STRANGER_ID });
      const { response, body, handlerRan } = await callGate(gate, `Bearer ${token}`);
      assert.equal(response.status, 403);
      assert.deepEqual(body, { error: "This account is not allowed here.", code: "not_allowed" });
      assert.ok(!handlerRan);
    });
  }

  for (const [name, aal] of [["aal1", "aal1"], ["no aal claim", undefined]] as const) {
    test(`requires a second factor from the owner (${name})`, async () => {
      const { response, body, handlerRan } = await callGate(gate, `Bearer ${await signToken(claims({ aal }))}`);
      assert.equal(response.status, 403);
      assert.deepEqual(body, { error: "Multi-factor authentication is required.", code: "mfa_required" });
      assert.equal(response.headers.get("www-authenticate"), 'Bearer error="insufficient_scope"');
      assert.ok(!handlerRan);
    });
  }

  const rejected: Array<[string, () => Promise<string>]> = [
    ["a token that expired seconds ago", () => signToken(claims(), { expiresAt: Math.floor(Date.now() / 1000) - 2 })],
    ["a token without exp", () => signToken(claims(), { expiresAt: null })],
    ["a token without iat", () => signToken(claims(), { issuedAt: false })],
    ["a token without session_id", () => signToken(claims({ session_id: undefined }))],
    ["a token from another issuer", () => signToken(claims(), { issuer: "https://other.supabase.co/auth/v1" })],
    ["a token for another audience", () => signToken(claims(), { audience: "anon" })],
    ["a token with an unknown kid", () => signToken(claims(), { kid: "rotated-away" })],
    ["a token signed by a stray key", () => signToken(claims(), { key: strayKeys.privateKey })],
    ["an ES384 token (algorithm outside the allowlist)", () => signToken(claims(), { alg: "ES384" })],
    ["a token with an unknown critical header", () => signToken(claims(), { crit: ["x-unknown"] })],
    ["a token without a role", () => signToken(claims({ role: undefined }))],
    ["a token whose role differs only in case", () => signToken(claims({ role: "Authenticated" }))],
    ["an anon-role token", () => signToken(claims({ role: "anon" }))],
    ["an anon-role single-factor token (role is checked first)", () => signToken(claims({ role: "anon", aal: "aal1" }))],
    ["a service_role token", () => signToken(claims({ role: "service_role" }))],
    ["an anonymous user's token", () => signToken(claims({ is_anonymous: true }))],
    ["a token with an empty sub", () => signToken(claims(), { subject: "" })],
    ["a token whose sub is not a string", () => signRaw(rawClaims({ sub: [OWNER_ID] }))],
    ["a token whose payload is not a JSON object", () => signRaw("[]")],
    ["a token that is not a JWT", async () => "not.a.jwt"],
    [
      "an HS256 token (shared-secret algorithm not allowed)",
      () =>
        new SignJWT(claims())
          .setProtectedHeader({ alg: "HS256", kid: "ES256" })
          .setIssuer(ISSUER)
          .setAudience("authenticated")
          .setSubject(OWNER_ID)
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(new TextEncoder().encode("a-shared-secret-an-attacker-guessed")),
    ],
    [
      "an unsigned alg=none token",
      async () =>
        new UnsecuredJWT(claims())
          .setIssuer(ISSUER)
          .setAudience("authenticated")
          .setSubject(OWNER_ID)
          .setIssuedAt()
          .setExpirationTime("1h")
          .encode(),
    ],
    [
      "a token whose payload was edited after signing",
      async () => {
        const [header, , signature] = (await signToken(claims({ aal: "aal1" }))).split(".");
        return `${header}.${Buffer.from(rawClaims({})).toString("base64url")}.${signature}`;
      },
    ],
  ];

  for (const [name, makeToken] of rejected) {
    test(`rejects ${name} with 401 without logging an outage`, async (t) => {
      const errorLog = t.mock.method(console, "error", () => {});
      const { response, body, handlerRan } = await callGate(gate, `Bearer ${await makeToken()}`);
      assert.equal(response.status, 401);
      assert.deepEqual(body, SIGN_IN_REQUIRED);
      assert.equal(response.headers.get("www-authenticate"), 'Bearer error="invalid_token"');
      assert.ok(!handlerRan);
      assert.equal(errorLog.mock.callCount(), 0);
    });
  }

  test("rejects a kid-less token when several keys could match", async () => {
    const strayJwk = { ...(await exportJWK(strayKeys.publicKey)), kid: "stray", alg: "ES256" };
    const ambiguous = await startApiServer(
      gatedApp({
        supabaseUrl: PROJECT_URL,
        allowedUserIds: OWNER_ID,
        keys: createLocalJWKSet({ keys: [...publicJwks, strayJwk] }),
      }),
    );
    try {
      const { response, handlerRan } = await callGate(ambiguous, `Bearer ${await signToken(claims(), { kid: null })}`);
      assert.equal(response.status, 401);
      assert.ok(!handlerRan);
    } finally {
      await ambiguous.close();
    }
  });
});

describe("sign-in gate configuration", () => {
  const incomplete: Array<[string, Parameters<typeof createRequireUser>[0]]> = [
    ["nothing", {}],
    ["no allowlist", { supabaseUrl: PROJECT_URL }],
    ["an empty allowlist", { supabaseUrl: PROJECT_URL, allowedUserIds: " , " }],
    ["no project URL", { allowedUserIds: OWNER_ID }],
  ];

  for (const [name, options] of incomplete) {
    test(`fails closed with 503 when configured with ${name}`, async () => {
      const server = await startApiServer(
        gatedApp({ ...options, keys: createLocalJWKSet({ keys: publicJwks }) }),
      );
      try {
        const { response, body, handlerRan } = await callGate(server, `Bearer ${await signToken()}`);
        assert.equal(response.status, 503);
        assert.deepEqual(body, NOT_CONFIGURED);
        assert.ok(!handlerRan);
      } finally {
        await server.close();
      }
    });
  }
});

describe("remote JWKS", () => {
  test("fetches keys once from the project's /auth/v1/.well-known/jwks.json", async () => {
    let keyRequests = 0;
    const keyServer = await startKeyServer((_request, response) => {
      keyRequests += 1;
      response.json({ keys: publicJwks });
    });
    const server = await startApiServer(
      gatedApp({ supabaseUrl: keyServer.baseUrl, allowedUserIds: OWNER_ID }),
    );
    try {
      const token = await signToken(claims(), { issuer: `${keyServer.baseUrl}/auth/v1` });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        assert.equal((await callGate(server, `Bearer ${token}`)).response.status, 200);
      }
      assert.equal(keyRequests, 1);
    } finally {
      await server.close();
      await keyServer.close();
    }
  });

  const outages: Array<[string, RequestHandler | "unreachable"]> = [
    [
      "is failing",
      (_request, response) => {
        response.status(500).end();
      },
    ],
    [
      "returns a malformed key set",
      (_request, response) => {
        response.json({ keys: "nope" });
      },
    ],
    ["is unreachable", "unreachable"],
  ];

  for (const [name, handler] of outages) {
    test(`answers 503, not 401, when the key endpoint ${name}`, async (t) => {
      const errorLog = t.mock.method(console, "error", () => {});
      const keyServer = await startKeyServer(
        handler === "unreachable" ? (_request, response) => response.end() : handler,
      );
      const keyUrl = keyServer.baseUrl;
      if (handler === "unreachable") {
        await keyServer.close();
      }
      const server = await startApiServer(gatedApp({ supabaseUrl: keyUrl, allowedUserIds: OWNER_ID }));
      try {
        const token = await signToken(claims(), { issuer: `${keyUrl}/auth/v1` });
        const { response, body, handlerRan } = await callGate(server, `Bearer ${token}`);
        assert.equal(response.status, 503);
        assert.deepEqual(body, UNAVAILABLE);
        assert.ok(!handlerRan);
        assert.equal(errorLog.mock.callCount(), 1);
      } finally {
        await server.close();
        if (handler !== "unreachable") {
          await keyServer.close();
        }
      }
    });
  }
});

describe("GET /api/me", () => {
  test("returns the signed-in owner's id, uncached", async () => {
    const api = await startApiServer(
      createApp({
        env: { SUPABASE_URL: PROJECT_URL, AUTH_ALLOWED_USER_IDS: OWNER_ID },
        authKeys: createLocalJWKSet({ keys: publicJwks }),
      }),
    );
    try {
      const response = await fetch(`${api.baseUrl}/api/me`, {
        headers: { Authorization: `Bearer ${await signToken()}` },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { id: OWNER_ID });
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await fetch(`${api.baseUrl}/api/me`)).status, 401);
    } finally {
      await api.close();
    }
  });

  test("fails closed without configuration while public endpoints stay open", async () => {
    const api = await startApiServer(createApp({ env: {} }));
    try {
      assert.equal((await fetch(`${api.baseUrl}/api/me`)).status, 503);
      const health = await fetch(`${api.baseUrl}/api/health`, {
        headers: { Authorization: "Bearer not-a-token" },
      });
      assert.equal(health.status, 200);
    } finally {
      await api.close();
    }
  });
});

describe("parseSupabaseUrl", () => {
  test("normalizes to the origin", () => {
    assert.equal(parseSupabaseUrl("https://abc.supabase.co/")?.href, "https://abc.supabase.co/");
    assert.equal(parseSupabaseUrl("https://abc.supabase.co/rest/v1")?.href, "https://abc.supabase.co/");
  });

  test("treats unset as unconfigured", () => {
    assert.equal(parseSupabaseUrl(undefined), undefined);
    assert.equal(parseSupabaseUrl(""), undefined);
  });

  test("allows plain http only for loopback hosts (Supabase CLI local dev)", () => {
    for (const url of ["http://127.0.0.1:54321", "http://localhost:54321", "http://[::1]:54321"]) {
      assert.ok(parseSupabaseUrl(url), url);
    }
    assert.throws(() => parseSupabaseUrl("http://abc.supabase.co"), /https/);
    assert.throws(() => parseSupabaseUrl("ftp://abc.supabase.co"), /https/);
    assert.throws(() => parseSupabaseUrl("http://127.0.0.1.nip.io"), /https/);
    assert.throws(() => parseSupabaseUrl("http://0.0.0.0:54321"), /https/);
  });

  test("rejects values that are not URLs", () => {
    assert.throws(() => parseSupabaseUrl("abc.supabase.co"), /valid URL/);
  });
});

describe("parseAllowedUserIds", () => {
  test("treats unset or blank as unconfigured", () => {
    for (const value of [undefined, "", " , "]) {
      assert.equal(parseAllowedUserIds(value), undefined);
    }
  });

  test("parses a comma-separated list, ignoring case and spaces", () => {
    assert.deepEqual(
      parseAllowedUserIds(` ${OWNER_ID.toUpperCase()} , ${STRANGER_ID}`),
      new Set([OWNER_ID, STRANGER_ID]),
    );
  });

  test("rejects entries that are not user ids", () => {
    for (const value of [`${OWNER_ID},owner@example.com`, `x${OWNER_ID}`, `${OWNER_ID}0`]) {
      assert.throws(() => parseAllowedUserIds(value), /AUTH_ALLOWED_USER_IDS/, value);
    }
  });
});
