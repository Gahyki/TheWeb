import assert from "node:assert/strict";
import { test } from "node:test";
import { checkClientEnv } from "../vite.config.js";

const SECRET = "sb_secret_abc123";

test("publishable settings, empty ones, or none pass", () => {
  checkClientEnv({});
  checkClientEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: "" });
  checkClientEnv({
    VITE_SUPABASE_URL: "https://test-project.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    VITE_API_BASE_URL: "https://api.example.com",
  });
});

test("the publishable key slot takes only a publishable key", () => {
  for (const value of ["eyJhbGciOiJIUzI1NiJ9.e30.x", "publishable", " sb_publishable_test"]) {
    assert.throws(
      () => checkClientEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: value }),
      /VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable key/,
      value,
    );
  }
});

test("a secret key in any VITE_* value fails, named but never printed", () => {
  for (const name of ["VITE_SUPABASE_PUBLISHABLE_KEY", "VITE_API_BASE_URL"]) {
    assert.throws(
      () => checkClientEnv({ VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test", [name]: SECRET }),
      (error: Error) => error.message.includes(`${name} holds a Supabase secret key`) && !error.message.includes(SECRET),
    );
  }
});
