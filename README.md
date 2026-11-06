# TheWeb

The personal website of Jason Kim, a software engineer in Vancouver, Canada — experienced as a living solar system rendered in a wireframe light-drawing aesthetic. Built with React, TypeScript, Vite, React Three Fiber, GSAP, zustand, and Tailwind CSS.

## The experience

- The site is one persistent 3D scene: a slowly orbiting solar system on a pure black background, drawn entirely with thin luminous lines.
- Each section is a celestial body: Earth = Home, Saturn = Experience, Jupiter = How I Think, Mars = GitHub, Sun = Contact. Mercury, Venus, Uranus, and Neptune are non-interactive scenery.
- Navigation is tabs-only (top nav), plus keyboard (arrows/Enter to move between sections, Escape to return). Selecting a section flies the camera in a ~270° sweep into the body; its moons and orbit trails fade in on approach. Every section has a real URL and supports deep links and browser history.
- Moon radii are true to the real moon:planet ratios (orbit distances are stylized). Earth carries a glowing marker at Vancouver's coordinates.
- `prefers-reduced-motion` replaces camera flights with fast fades; mobile gets reduced line density, no bloom, and a bottom-sheet panel layout.
- Browser support: evergreen Chrome, Edge, Firefox, and Safari 15+ (the 3D scene requires WebGL2). If WebGL is unavailable, the site degrades gracefully: the tab navigation and all section content still work as plain HTML.

## Code layout

- `src/scene/` — the 3D world. `config.ts` holds all celestial data; `CameraDirector.tsx` owns every camera transition; `shaders.ts`/`geometry.ts` build the line-work materials and grids.
- `src/ui/` — the HTML overlay: chrome, panel choreography, and one component per section under `panels/`.
- `src/state/store.ts` — zustand store connecting scene and UI; `src/router.ts` maps views to URLs.
- `server/` — Express API; `api/` exposes it as Vercel Functions.

## Develop

```sh
npm install
cp .env.example .env
npm run dev
```

The frontend runs through Vite at `http://localhost:5173`, and the API runs locally at `http://127.0.0.1:3001` (loopback by default; deployment platforms set `HOST`). Vite proxies `/api` requests to the API. Use `npm test` for the API suites in `tests/` and `npm run test:ui` for Playwright browser checks in `ui-tests/` (install the browser once with `npx playwright install chromium`). Create a production build with `npm run build`; preview with `npm run preview`; start the compiled API with `npm run start:api`. `npm run lint` runs Biome and `npm run typecheck` checks all TypeScript projects.

## API

The API exposes `GET /api/health`, `GET /api/age`, `GET /api/github`, and `POST /api/contact`.

- **Age:** configure `PROFILE_BIRTH_YEAR`, `PROFILE_BIRTH_MONTH`, and `PROFILE_TIME_ZONE` server-side. Only the computed age is returned; the browser caches it for one hour.
- **GitHub:** proxies the GitHub API with a one-hour server-side cache, CDN caching (`s-maxage`), a failure backoff, and stale data when a refresh fails. Without `GITHUB_TOKEN` it returns featured repositories only; with a token it also returns the real contribution calendar shown on the GitHub section. Use a fine-grained token with **no repository access** — a token that can read private repos would publish private-repo contribution counts in the public calendar. `GITHUB_USERNAME` defaults to `Gahyki`.
- **Contact:** delivery stays disabled until `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `CONTACT_FROM` are configured server-side with a provider authorized to send from that address. Messages deliver to the server-only `CONTACT_TO` (defaults to `contact@gahyki.com`). `VITE_PUBLIC_CONTACT_EMAIL` controls the public fallback address shown on the page and is intentionally exposed in the bundle. Never put private destinations or credentials in `VITE_` variables.

The API validates and size-limits JSON, restricts browser origins (`APP_ORIGIN` is a comma-separated exact-origin allowlist), uses security headers, and rate-limits contact submissions per IP (`CONTACT_RATE_LIMIT`, `CONTACT_RATE_LIMIT_WINDOW_MS`). `server/index.ts` binds `127.0.0.1` unless the platform sets `HOST`. `TRUST_PROXY_HOPS` defaults to `1` on Vercel (detected via the `VERCEL` env var) and is set to `1` in the Render configuration, so rate limits use the client IP forwarded by exactly one managed-host proxy; everywhere else it defaults to `0`. Rate-limit state is in memory for a single-instance deployment; add a shared store before scaling out. Use Node.js 26 for deployment.

## Deploy

The frontend and API deploy together on Vercel (`api/*.ts` are Vercel Functions; `vercel.json` rewrites everything else to the SPA). `render.yaml` and the `Dockerfile` remain for a long-running container deployment of the API.
