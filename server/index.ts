import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT or API_PORT must be a valid TCP port.");
}

const server = createServer(createApp());
// Private by default: local dev stays on loopback. Deployment platforms
// that need a wider bind (e.g. Render) set HOST explicitly.
const host = process.env.HOST ?? "127.0.0.1";
server.listen(port, host, () => {
  console.log(`API listening on ${host}:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close((error) => {
      if (error) {
        console.error("API shutdown failed.", error);
        process.exitCode = 1;
      }
    });
  });
}
