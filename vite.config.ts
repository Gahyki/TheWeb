import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import vercel from "./vercel.json" with { type: "json" };

/** vercel.json's site-wide response headers, so `vite preview` serves the deployed CSP. */
const deployedHeaders = Object.fromEntries(
  vercel.headers
    .filter((rule) => rule.source === "/(.*)")
    .flatMap((rule) => rule.headers)
    .map(({ key, value }) => [key, value]),
);

/**
 * VITE_* values ship to every browser: throws if one is a Supabase secret
 * key, or if the publishable key slot holds anything but a publishable key.
 */
export function checkClientEnv(env: Record<string, string>): void {
  for (const [name, value] of Object.entries(env)) {
    if (value.startsWith("sb_secret_")) {
      throw new Error(`${name} holds a Supabase secret key; VITE_* values ship to every browser.`);
    }
  }
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (key && !key.startsWith("sb_publishable_")) {
    throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY must be a publishable key (sb_publishable_...).");
  }
}

/** Fails dev and build before a bad VITE_* value reaches the bundle. */
const clientEnvGuard: Plugin = {
  name: "client-env-guard",
  config(config, { mode }) {
    checkClientEnv(loadEnv(mode, config.root ?? process.cwd(), "VITE_"));
  },
};

export default defineConfig({
  plugins: [clientEnvGuard, react(), tailwindcss()],
  build: {
    // Library code ships in its own chunks, so a deploy that only changes
    // app code keeps their file names and browsers reuse them.
    // three-vendor is ~1 MB minified, hence the raised warning limit.
    chunkSizeWarningLimit: 1100,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: "react-vendor", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
            // Only the lazy sign-in imports it; the catch-all would load it on every page.
            { name: "supabase-vendor", test: /node_modules[\\/]@supabase[\\/]/, priority: 25 },
            {
              name: "three-vendor",
              test: /node_modules[\\/](three|postprocessing|n8ao|maath|@react-three[\\/][^\\/]+)[\\/]/,
              priority: 20,
            },
            { name: "vendor", test: /node_modules[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
  server: {
    strictPort: true,
    // Optional dev preview through an HTTPS tunnel: set TUNNEL_HOST to the
    // tunnel's host suffix (e.g. ".example.dev"). Bind stays loopback; HMR
    // websockets ride the tunnel's HTTPS edge.
    ...(process.env.TUNNEL_HOST
      ? {
          allowedHosts: [process.env.TUNNEL_HOST],
          hmr: { protocol: "wss", clientPort: 443 },
        }
      : {}),
    proxy: {
      "/api": "http://127.0.0.1:3001",
    },
  },
  // Inherits server.proxy, so /api still reaches the local API.
  preview: { headers: deployedHeaders },
});
