import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build, resolveConfig, type Rolldown } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));

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
