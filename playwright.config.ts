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
  // Both servers start so wiring.spec.ts can exercise the real Vite→API
  // proxy path; all other specs stub /api/* with page.route().
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
  ],
});
