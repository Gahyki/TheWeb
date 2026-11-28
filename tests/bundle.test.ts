import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build, resolveConfig, type Rolldown } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

// A build with Supabase settings keeps the lazy sign-in (and supabase-js) in
// the output; this placeholder project matches playwright.config.ts.
process.env.VITE_SUPABASE_URL = "https://test-project.supabase.co";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";

/** Production JS chunks, built in memory with the real vite.config.ts. */
async function buildChunks(): Promise<Rolldown.OutputChunk[]> {
  const result = await build({ root, logLevel: "silent", build: { write: false } });
  if (!Array.isArray(result) && !("output" in result)) {
    throw new Error("expected a one-off build, not a watcher");
  }
  return (Array.isArray(result) ? result : [result])
    .flatMap((output) => output.output)
    .filter((file): file is Rolldown.OutputChunk => file.type === "chunk");
}

test("library code ships in vendor chunks, apart from app code", async () => {
  const chunks = await buildChunks();
  const chunksWith = (pkg: string) =>
    chunks
      .filter((chunk) => chunk.moduleIds.some((id) => id.includes(`/node_modules/${pkg}/`)))
      .map((chunk) => chunk.name);

  const entry = chunks.find((chunk) => chunk.isEntry);
  assert.ok(entry);
  assert.deepEqual(entry.moduleIds.filter((id) => id.includes("/node_modules/")), []);
  assert.deepEqual(chunksWith("three"), ["three-vendor"]);
  assert.deepEqual(chunksWith("react-dom"), ["react-vendor"]);
});

test("supabase-js ships only in the lazy sign-in's chunks", async () => {
  const chunks = await buildChunks();
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  /** Chunks a page loads with `start`, following static imports only. */
  const staticClosure = (start: Rolldown.OutputChunk) => {
    const seen = new Set<Rolldown.OutputChunk>();
    const visit = (chunk: Rolldown.OutputChunk | undefined) => {
      if (chunk && !seen.has(chunk)) {
        seen.add(chunk);
        for (const file of chunk.imports) {
          visit(byFile.get(file));
        }
      }
    };
    visit(start);
    return [...seen];
  };
  const supabaseIn = (chunk: Rolldown.OutputChunk) =>
    chunk.moduleIds.filter((id) => id.includes("/node_modules/@supabase/"));

  const entry = chunks.find((chunk) => chunk.isEntry);
  assert.ok(entry);
  const eager = staticClosure(entry);
  assert.ok(eager.some((chunk) => chunk.name === "vendor"), "the catch-all vendor chunk loads eagerly");
  assert.deepEqual(eager.flatMap(supabaseIn), []);

  const lazy = entry.dynamicImports.flatMap((file) => {
    const chunk = byFile.get(file);
    return chunk ? staticClosure(chunk) : [];
  });
  assert.deepEqual(
    [...new Set(lazy.filter((chunk) => supabaseIn(chunk).length > 0).map((chunk) => chunk.name))],
    ["supabase-vendor"],
  );
});

test("the build refuses a Supabase secret key in a VITE_* value", async () => {
  const publishable = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "sb_secret_placeholder";
  try {
    await assert.rejects(buildChunks(), /VITE_SUPABASE_PUBLISHABLE_KEY holds a Supabase secret key/);
  } finally {
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY = publishable;
  }
});

test("the README's Safari floor is the build target", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const floor = readme.match(/Safari(?:\/iOS)? (\d+(?:\.\d+)?)\+/)?.[1];
  assert.ok(floor, "README states a Safari version");

  const config = await resolveConfig({ root, logLevel: "silent" }, "build");
  const targets = [config.build.target].flat();
  assert.deepEqual(
    targets.filter((target) => typeof target === "string" && /^(safari|ios)\d/.test(target)),
    [`safari${floor}`, `ios${floor}`],
  );
});
