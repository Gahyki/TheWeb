import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./ui-tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    browserName: "chromium",
    // CI runners render WebGL in software; full-motion sweeps can outlive
    // every timeout there. The app honors reduced motion end to end.
    reducedMotion: "reduce",
    // Debuggable CI failures: traces are uploaded as artifacts.
    trace: "retain-on-failure",
  },
  projects: [
    // Unnamed, so snapshot file names stay project-free.
    { testIgnore: "**/prod.spec.ts" },
    // The built bundle under vercel.json's headers (see vite.config.ts).
    { name: "prod", testMatch: "**/prod.spec.ts", use: { baseURL: "http://127.0.0.1:4175" } },
  ],
  // The API runs for real so wiring.spec.ts and prod.spec.ts can exercise
  // the Vite→API proxy path; all other specs stub /api/* with page.route().
  webServer: [
    {
      command: "npm run dev:api",
      url: "http://127.0.0.1:3001/api/health",
      // Pin against ambient PORT/.env overrides desyncing the server from
      // the health-check URL and the Vite proxy.
      env: { PORT: "3001" },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npm run dev:web -- --host 127.0.0.1 --port 4174",
      url: "http://127.0.0.1:4174",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: "npx vite build && npx vite preview --host 127.0.0.1 --port 4175 --strictPort",
      url: "http://127.0.0.1:4175",
      // Never reuse: a leftover preview would serve a stale build.
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
