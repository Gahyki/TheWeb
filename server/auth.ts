import type { RequestHandler, Response } from "express";
import { createRemoteJWKSet, errors, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from "jose";

export type AuthenticatedUser = { id: string };

type RequireUserOptions = {
  supabaseUrl?: string;
  /** Comma-separated Supabase user ids allowed through the gate. */
  allowedUserIds?: string;
  /** Replaces the project's remote JWKS; tests sign tokens with a local key pair. */
  keys?: JWTVerifyGetKey;
};

// Failures caused by the presented token. Anything else (JWKS fetch timeout,
// network error, bad JWKS response) is an upstream outage, not a bad credential.
const TOKEN_ERRORS = [
  errors.JWTExpired,
  errors.JWTClaimValidationFailed,
  errors.JWTInvalid,
  errors.JWSInvalid,
  errors.JWSSignatureVerificationFailed,
  errors.JOSEAlgNotAllowed,
  errors.JOSENotSupported,
  errors.JWKSNoMatchingKey,
  errors.JWKSMultipleMatchingKeys,
];

const BEARER = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSupabaseUrl(value: string | undefined): URL | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("SUPABASE_URL must be a valid URL.");
  }
  const loopbackHttp = url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !loopbackHttp) {
    throw new Error("SUPABASE_URL must use https (http is allowed only for loopback hosts).");
  }

  return new URL(url.origin);
}

export function parseAllowedUserIds(value: string | undefined): Set<string> | undefined {
  const ids = (value ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  if (ids.length === 0) {
    return undefined;
  }
  if (!ids.every((id) => USER_ID.test(id))) {
    throw new Error("AUTH_ALLOWED_USER_IDS must be a comma-separated list of Supabase user ids.");
  }

  return new Set(ids);
}

function rejectToken(response: Response, hadToken: boolean) {
  response.setHeader("WWW-Authenticate", hadToken ? 'Bearer error="invalid_token"' : "Bearer");
  response.status(401).json({ error: "Sign-in required." });
}

/**
 * Gate for owner-only routes. Verifies a Supabase access token locally against
 * the project's public signing keys, requires the user to be allowlisted, and
 * requires a second factor (aal2). Rejects every request until both
 * SUPABASE_URL and AUTH_ALLOWED_USER_IDS are set.
 */
export function createRequireUser(options: RequireUserOptions): RequestHandler {
  const projectUrl = parseSupabaseUrl(options.supabaseUrl);
  const allowedUserIds = parseAllowedUserIds(options.allowedUserIds);
  if (!projectUrl || !allowedUserIds) {
    return (_request, response) => {
      response.status(503).json({ error: "Sign-in is not configured." });
    };
  }

  const issuer = new URL("auth/v1", projectUrl).href;
  const keys =
    options.keys ?? createRemoteJWKSet(new URL("auth/v1/.well-known/jwks.json", projectUrl));

  return async (request, response, next) => {
    const header = request.get("authorization");
    const token = header?.match(BEARER)?.[1];
    if (!token) {
      rejectToken(response, header !== undefined);
      return;
    }

    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(token, keys, {
        issuer,
        audience: "authenticated",
        algorithms: ["ES256", "RS256"],
        requiredClaims: ["sub", "exp", "iat", "session_id"],
      });
      payload = verified.payload;
    } catch (error) {
      if (TOKEN_ERRORS.some((tokenError) => error instanceof tokenError)) {
        rejectToken(response, true);
        return;
      }
      console.error(
        "Sign-in key verification failed.",
        error instanceof Error ? error.message : error,
      );
      response.status(503).json({ error: "Sign-in is temporarily unavailable." });
      return;
    }

    if (
      payload.role !== "authenticated" ||
      payload.is_anonymous === true ||
      typeof payload.sub !== "string" ||
      payload.sub === ""
    ) {
      rejectToken(response, true);
      return;
    }
    if (!allowedUserIds.has(payload.sub.toLowerCase())) {
      response.status(403).json({ error: "This account is not allowed here.", code: "not_allowed" });
      return;
    }
    if (payload.aal !== "aal2") {
      response.setHeader("WWW-Authenticate", 'Bearer error="insufficient_scope"');
      response
        .status(403)
        .json({ error: "Multi-factor authentication is required.", code: "mfa_required" });
      return;
    }

    const user: AuthenticatedUser = { id: payload.sub };
    response.locals.user = user;
    next();
  };
}
