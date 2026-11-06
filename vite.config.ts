import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
});
