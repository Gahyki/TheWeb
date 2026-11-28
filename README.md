# TheWeb

The personal website of Jason Kim, a software engineer in Vancouver, Canada — experienced as a living solar system rendered in a wireframe light-drawing aesthetic. Built with React, TypeScript, Vite, React Three Fiber, GSAP, zustand, and Tailwind CSS.

## The experience

- The site is one persistent 3D scene: a slowly orbiting solar system on a pure black background, drawn entirely with thin luminous lines.
- Each section is a celestial body: Earth = Home, Saturn = Experience, Jupiter = How I Think, Mars = GitHub, Sun = Contact. Mercury, Venus, Uranus, and Neptune are non-interactive scenery.
- Navigation is by tabs (top nav), plus keyboard (arrows/Enter to move between sections, Escape to return). Selecting a section flies the camera in a ~270° sweep into the body; its moons and orbit trails fade in on approach. Every section has a real URL and supports deep links and browser history.
- One hidden entrance: on `/system`, a click or tap on the sun collapses it into a black hole at the unlinked `/void`, beside the owner's sign-in. Escape, the tabs, or Back re-form the sun; the Contact tab and Enter still fly to it as usual. Without WebGL there is no sun to click, and `/void` shows the plain overview.
- Moon radii are true to the real moon:planet ratios (orbit distances are stylized). Earth carries a glowing marker at Vancouver's coordinates.
- `prefers-reduced-motion` replaces camera flights with fast fades; mobile gets reduced line density, no bloom, and a bottom-sheet panel layout.
- Browser support: evergreen Chrome, Edge, Firefox, and Safari/iOS 16.4+ (the 3D scene requires WebGL2). If WebGL is unavailable, the site degrades gracefully: the tab navigation and all section content still work as plain HTML.

## Code layout

- `src/scene/` — the 3D world. `Scene.tsx` is the canvas and its render loop (frame pacing, adaptive quality); `SolarSystem.tsx` mounts every body and advances the clock; `config.ts` holds all celestial data; `registry.ts` holds the orbit clock and computes body positions; `CameraDirector.tsx` owns every camera transition, using the pure framing math in `cameraMath.ts`; `shaders.ts`/`geometry.ts` build the line-work materials and grids.
- `src/ui/` — the HTML overlay: chrome, panel choreography, and one component per section under `panels/`.
- `src/state/store.ts` — zustand store connecting scene and UI; `src/router.ts` maps views to URLs.
- `server/` — Express API; `api/` exposes it as Vercel Functions.

## Develop

```sh
npm install
cp .env.example .env
npm run dev
```

The frontend runs through Vite at `http://localhost:5173`, and the API runs locally at `http://127.0.0.1:3001` (loopback by default; deployment platforms set `HOST`). Vite proxies `/api` requests to the API. Use `npm test` for the API suites in `tests/` and `npm run test:ui` for Playwright browser checks in `ui-tests/`, including a smoke test of the production build (install the browser once with `npx playwright install chromium`). Create a production build with `npm run build`; preview it with `npm run preview`, which serves `vercel.json`'s security headers; start the compiled API with `npm run start:api`. `npm run lint` runs Biome and `npm run typecheck` checks all TypeScript projects.

## API

The API exposes `GET /api/health`, `GET /api/age`, `GET /api/github`, and `POST /api/contact` publicly, plus the sign-in-gated `GET /api/me`.

- **Age:** configure `PROFILE_BIRTH_YEAR`, `PROFILE_BIRTH_MONTH`, and `PROFILE_TIME_ZONE` server-side. Only the computed age is returned; the browser caches it for one hour.
- **GitHub:** proxies the GitHub API with a one-hour server-side cache, CDN caching (`s-maxage`), a failure backoff, and stale data when a refresh fails. Without `GITHUB_TOKEN` it returns featured repositories only; with a token it also returns the real contribution calendar shown on the GitHub section. Use a fine-grained token with **no repository access** — a token that can read private repos would publish private-repo contribution counts in the public calendar. `GITHUB_USERNAME` defaults to `Gahyki`.
- **Contact:** delivery stays disabled until `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `CONTACT_FROM` are configured server-side with a provider authorized to send from that address. Messages deliver to the server-only `CONTACT_TO` (defaults to `contact@gahyki.com`). `VITE_PUBLIC_CONTACT_EMAIL` controls the public fallback address shown on the page and is intentionally exposed in the bundle. Never put private destinations or credentials in `VITE_` variables.
- **Sign-in:** gated routes accept only a Supabase access token (`Authorization: Bearer <token>`) that verifies against the project's public signing keys (`SUPABASE_URL` + `/auth/v1/.well-known/jwks.json`, so the project must use asymmetric ES256/RS256 signing keys) belongs to a user listed in `AUTH_ALLOWED_USER_IDS`, and carries `aal2`, meaning the session passed a second factor. Supabase sets `aal2` for any verified factor, so leave phone MFA off to keep it TOTP-only. A missing or invalid token gets `401`; any other user gets `403` with `code: "not_allowed"`; a single-factor session gets `403` with `code: "mfa_required"`. Until both `SUPABASE_URL` and `AUTH_ALLOWED_USER_IDS` are set, gated routes answer `503`. Also turn off new-user sign-ups in the Supabase Auth settings: the allowlist already keeps strangers out, but they shouldn't be able to create accounts at all. Verification is local, so a signed-out session's access token stays valid until it expires (one hour by default). Only routes that opt in are gated; everything else stays public.
- **Sign-in screen:** email and password, then a code from the owner's verified TOTP authenticator (the site does not enroll one), checked against `GET /api/me`. The hidden entrance is obscurity only; the gate above is the boundary. The browser build needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (the `sb_publishable_` key, never the secret key; Vite refuses to run with any other key there, or with an `sb_secret_` value in any `VITE_*` variable); without them the sun stays inert. supabase-js loads only when the black hole opens, the session persists in `localStorage`, and tokens in a URL are ignored.

The API validates and size-limits JSON, restricts browser origins (`APP_ORIGIN` is a comma-separated exact-origin allowlist), uses security headers, and rate-limits contact submissions per IP (`CONTACT_RATE_LIMIT`, `CONTACT_RATE_LIMIT_WINDOW_MS`). `server/index.ts` binds `127.0.0.1` unless the platform sets `HOST`. `TRUST_PROXY_HOPS` defaults to `1` on Vercel (detected via the `VERCEL` env var) and is set to `1` in the Render configuration, so rate limits use the client IP forwarded by exactly one managed-host proxy; everywhere else it defaults to `0`. Rate-limit state is in memory for a single-instance deployment; add a shared store before scaling out. Use Node.js 26 for deployment.

## Deploy

The frontend and API deploy together on Vercel (`api/*.ts` are Vercel Functions; `vercel.json` rewrites everything else to the SPA). `render.yaml` and the `Dockerfile` remain for a long-running container deployment of the API.
