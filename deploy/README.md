# Deployment

The backend is packaged as a standalone Node.js 26 container. The frontend remains a Vite application deployed to Vercel.

## Local container

1. Copy `.env.example` to `.env`.
2. Set the profile values and SMTP values needed for local testing.
3. Start the API:

   ```sh
   docker compose up --build
   ```

4. Verify the health endpoint:

   ```sh
   curl http://127.0.0.1:3001/api/health
   ```

The container does not include the frontend. During local Vite development, the existing proxy sends `/api` requests to port `3001`. Set `VITE_API_BASE_URL` to the deployed API origin when running the frontend against a remote container.

## Production container

Build and run the image with a secret environment file supplied by the host:

```sh
docker build -t theweb-api .
docker run --env-file .env.production \
  -e PORT=3001 \
  -p 127.0.0.1:3001:3001 \
  theweb-api
```

Do not copy `.env.production` into the image or commit it. The image listens on the host-provided `PORT`, sets `HOST=0.0.0.0` so the server accepts connections from the container network, runs as the non-root `node` user, and exposes `/api/health` as its Docker health check. Do not set `HOST` in `.env.production`: an env-file value overrides the image's `HOST` and a loopback value makes the published port unreachable while the health check still passes.

The published port, not the in-container bind, decides who can reach the API. The container serves plain HTTP and the Vercel frontend is served over HTTPS, so browsers must reach the API through a TLS-terminating reverse proxy. The command above publishes on `127.0.0.1` only, for a proxy running on the same host. If the proxy runs on a different machine, publish on the host's private interface (`-p <private-ip>:3001:3001`) rather than a bare `-p 3001:3001`, which listens on every host interface, including public ones.

Required production settings are documented in `.env.example`. Set:

- `APP_ORIGIN` to the exact Vercel origin.
- `TRUST_PROXY_HOPS=1` when the container is directly behind one managed hosting proxy.
- `PROFILE_BIRTH_YEAR`, `PROFILE_BIRTH_MONTH`, and `PROFILE_TIME_ZONE`.
- The server-only SMTP settings and `CONTACT_TO`.

The initial rate limiter is process-local. Run one API instance until a shared rate-limit store is added; multiple containers do not share counters.

## Render

`render.yaml` provisions the API as a Docker web service using this `Dockerfile`. Create a Render Blueprint from the repository, configure the `sync: false` values in the Render dashboard, and verify `/api/health` after deployment. Render supplies `PORT`; do not replace it with a hard-coded public port in the service settings.
