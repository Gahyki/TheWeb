/**
 * Stand-ins for the placeholder Supabase project (playwright.config.ts)
 * and PR #12's GET /api/me. Error bodies carry `error_code` + `msg`:
 * auth-js reads `code` only with an API-version header it cannot see on
 * these cross-origin replies.
 */

import { test as base, expect, type Page, type Request, type Route } from "@playwright/test";

/** supabase-js's default key: `sb-<project ref>-auth-token`. */
export const STORAGE_KEY = "sb-test-project-auth-token";
export const PUBLISHABLE_KEY = "sb_publishable_test";

export const OWNER = {
  id: "5d0c1b9e-6f0a-4c39-9d36-2f8f4b7c1a01",
  email: "owner@example.com",
  password: "correct horse battery staple",
};
export const FACTOR_ID = "8a6f2c1e-3b4d-4e5f-9a0b-1c2d3e4f5a6b";
export const CHALLENGE_ID = "0f1e2d3c-4b5a-4968-8776-655443322110";
export const CODE = "123456";

export type Aal = "aal1" | "aal2";

/** Unsigned stand-in access token: only these stubs read its claims. */
export function jwt(aal: Aal): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: OWNER.id,
    aud: "authenticated",
    role: "authenticated",
    aal,
    amr: [{ method: "password", timestamp: now }, ...(aal === "aal2" ? [{ method: "totp", timestamp: now }] : [])],
    session_id: "c4a7e1f0-2b3c-4d5e-8f90-a1b2c3d4e5f6",
    iat: now,
    exp: now + 3600,
  };
  return `${encode({ alg: "ES256", typ: "JWT" })}.${encode(claims)}.c2ln`;
}

/** The `aal` claim of a `Bearer <jwt>` header, or null for anything else. */
export function aalOf(authorization: string | null | undefined): string | null {
  const payload = authorization?.match(/^Bearer [^.]+\.([^.]+)\.[^.]+$/)?.[1];
  if (!payload) {
    return null;
  }
  try {
    const { aal } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { aal?: unknown };
    return typeof aal === "string" ? aal : null;
  } catch {
    return null;
  }
}

export type Factor = { id: string; factor_type: string; status: "verified" | "unverified" };

const VERIFIED_TOTP: Factor = { id: FACTOR_ID, factor_type: "totp", status: "verified" };

/** A stub reply; "abort" fails the request like a network error. */
export type Reply =
  | { status: number; json?: unknown; body?: string; contentType?: string }
  | "abort";

/** One logged request, with the headers the tests pin. */
export type Logged = {
  method: string;
  path: string;
  search: string;
  authorization: string | null;
  apikey: string | null;
  body: unknown;
};

/** Error body in Supabase Auth's unversioned shape. */
export function authError(status: number, errorCode: string, msg: string): Reply {
  return { status, json: { code: status, error_code: errorCode, msg } };
}

export type AuthStub = {
  /** Supabase Auth requests, in order. */
  requests: Logged[];
  /** GET /api/me requests, in order. */
  me: Logged[];
  /** Requests no stub expected; each was aborted. */
  unexpected: string[];
  /** The user's MFA factors. */
  factors: Factor[];
  /** Overrides the password grant; undefined falls through to the real check. */
  token?: (body: { email?: string; password?: string }) => Promise<Reply | undefined> | Reply | undefined;
  /** Overrides /api/me by the bearer's aal; undefined falls through to PR #12's verdicts. */
  meReply?: (aal: string | null) => Reply | undefined;
};

async function reply(route: Route, response: Reply) {
  if (response === "abort") {
    await route.abort("failed");
    return;
  }
  await route.fulfill({
    status: response.status,
    contentType: response.contentType ?? "application/json",
    body: response.json === undefined ? (response.body ?? "") : JSON.stringify(response.json),
  });
}

async function log(request: Request): Promise<Logged> {
  const url = new URL(request.url());
  const headers = await request.allHeaders();
  let body: unknown = null;
  const raw = request.postData();
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = raw;
    }
  }
  return {
    method: request.method(),
    path: url.pathname,
    search: url.search,
    authorization: headers.authorization ?? null,
    apikey: headers.apikey ?? null,
    body,
  };
}

/** Routes Supabase Auth and /api/me for `page`; anything else Supabase is refused and logged. */
export async function stubAuth(page: Page): Promise<AuthStub> {
  const stub: AuthStub = { requests: [], me: [], unexpected: [], factors: [VERIFIED_TOTP] };

  const user = () => ({
    id: OWNER.id,
    aud: "authenticated",
    role: "authenticated",
    email: OWNER.email,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    factors: stub.factors.map((factor) => ({
      ...factor,
      friendly_name: "phone",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    })),
  });
  const session = (aal: Aal) => ({
    access_token: jwt(aal),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `refresh-${aal}`,
    user: user(),
  });

  // Registered first, so it runs only for requests the stubs below don't match.
  await page.route(/^https:\/\/[^/]+\.supabase\.co\//, async (route) => {
    stub.unexpected.push(`${route.request().method()} ${route.request().url()}`);
    await route.abort("failed");
  });
  await page.routeWebSocket(/supabase\.co/, async (socket) => {
    stub.unexpected.push(`WebSocket ${socket.url()}`);
    await socket.close();
  });

  await page.route(/^https:\/\/test-project\.supabase\.co\/auth\/v1\//, async (route) => {
    const entry = await log(route.request());
    stub.requests.push(entry);
    const { method, path, search } = entry;
    const params = new URLSearchParams(search);
    const body = (entry.body ?? {}) as Record<string, unknown>;

    if (method === "POST" && path === "/auth/v1/token" && params.get("grant_type") === "password") {
      const override = await stub.token?.(body as { email?: string; password?: string });
      if (override) {
        await reply(route, override);
      } else if (body.email === OWNER.email && body.password === OWNER.password) {
        await reply(route, { status: 200, json: session("aal1") });
      } else {
        await reply(route, authError(400, "invalid_credentials", "Invalid login credentials"));
      }
      return;
    }
    if (method === "GET" && path === "/auth/v1/user" && aalOf(entry.authorization)) {
      await reply(route, { status: 200, json: user() });
      return;
    }
    if (method === "POST" && path === `/auth/v1/factors/${FACTOR_ID}/challenge`) {
      const expiresAt = Math.floor(Date.now() / 1000) + 300;
      await reply(route, { status: 200, json: { id: CHALLENGE_ID, type: "totp", expires_at: expiresAt } });
      return;
    }
    if (method === "POST" && path === `/auth/v1/factors/${FACTOR_ID}/verify`) {
      if (body.challenge_id === CHALLENGE_ID && body.code === CODE) {
        const { access_token, token_type, expires_in, refresh_token } = session("aal2");
        await reply(route, {
          status: 200,
          json: { access_token, token_type, expires_in, refresh_token, user: user() },
        });
      } else {
        await reply(route, authError(422, "mfa_verification_failed", "Invalid TOTP code entered"));
      }
      return;
    }
    if (method === "POST" && path === "/auth/v1/logout" && params.get("scope") === "local") {
      await route.fulfill({ status: 204 });
      return;
    }
    stub.unexpected.push(`${method} ${path}${search}`);
    await route.abort("failed");
  });

  await page.route("**/api/me", async (route) => {
    const entry = await log(route.request());
    stub.me.push(entry);
    const aal = aalOf(entry.authorization);
    const override = stub.meReply?.(aal);
    if (override) {
      await reply(route, override);
    } else if (aal === "aal2") {
      await reply(route, { status: 200, json: { id: OWNER.id } });
    } else if (aal === "aal1") {
      await reply(route, {
        status: 403,
        json: { error: "Multi-factor authentication is required.", code: "mfa_required" },
      });
    } else {
      await reply(route, { status: 401, json: { error: "Sign-in required." } });
    }
  });

  return stub;
}

/** `test` with the stubs on for every test; any unmatched Supabase call fails it. */
export const test = base.extend<{ auth: AuthStub }>({
  auth: [
    async ({ page }, use) => {
      const auth = await stubAuth(page);
      await use(auth);
      expect(auth.unexpected, "unstubbed Supabase requests").toEqual([]);
    },
    { auto: true },
  ],
});
