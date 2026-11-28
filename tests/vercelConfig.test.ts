import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { ROUTE_PATHS } from "../src/router.js";

type VercelConfig = {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};

const vercel: VercelConfig = JSON.parse(
  await readFile(new URL("../vercel.json", import.meta.url), "utf8"),
);

/** These sources have no named params, so each reads as a whole-path regex. */
const matcher = (source: string) => new RegExp(`^${source}$`);

const APP_PATHS = [...Object.values(ROUTE_PATHS), "/contact/", "/nope", "/apiary"];

test("the SPA rewrite serves index.html for app paths and never for /api", () => {
  // Vercel applies the first matching rewrite.
  const rewriteOf = (path: string) =>
    vercel.rewrites.find((rewrite) => matcher(rewrite.source).test(path))?.destination;

  for (const path of APP_PATHS) {
    assert.equal(rewriteOf(path), "/index.html", path);
  }
  for (const path of ["/api", "/api/", "/api/health", "/api/contact"]) {
    assert.equal(rewriteOf(path), undefined, path);
  }
});

test("every app path gets a CSP that keeps code same-origin and pins fetch origins", () => {
  const rule = vercel.headers.find((candidate) =>
    candidate.headers.some((header) => header.key === "Content-Security-Policy"),
  );
  assert.ok(rule);
  for (const path of APP_PATHS) {
    assert.match(path, matcher(rule.source));
  }

  const csp = rule.headers.find((header) => header.key === "Content-Security-Policy")?.value ?? "";
  const directives = new Map(
    csp.split(";").map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name, sources.join(" ")];
    }),
  );
  assert.deepEqual(
    Object.fromEntries(
      ["script-src", "style-src", "connect-src", "object-src"].map((name) => [
        name,
        directives.get(name),
      ]),
    ),
    {
      "script-src": "'self'",
      "style-src": "'self'",
      // Supabase auth (src/auth/supabase.ts).
      "connect-src": "'self' https://*.supabase.co",
      "object-src": "'none'",
    },
  );
});
