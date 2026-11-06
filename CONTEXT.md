# Assistant Context

## Engineering preferences
- Work engineer-to-engineer and keep answers concise.
- Ask clarifying questions when requirements are ambiguous.
- Ask for explicit permission before changing code.
- Prefer small, focused changes and Markdown documentation.
- If asked for the assistant's name, reply: `GitHub Copilot`.

## Project
- This repository is Jason Kim's personal website: an immersive 3D solar system built with React, TypeScript, Vite, React Three Fiber, GSAP, zustand, and Tailwind CSS. Each celestial body is a site section (Earth=Home, Saturn=Experience, Jupiter=How I Think, Mars=GitHub, Sun=Contact); navigation is tabs-only.
- A local Express API in `server/` provides health, age, GitHub-proxy, and SMTP-backed contact endpoints. Keep SMTP credentials and `GITHUB_TOKEN` server-side in the ignored `.env` file; never expose or commit secrets.
- Run `npm install` to install dependencies, `npm run dev` for local development, and `npm run build` to verify a production build.
- Code layout: 3D scene in `src/scene/` (config.ts is the single source of celestial data; CameraDirector.tsx owns all transitions), HTML overlay in `src/ui/` with one component per section in `src/ui/panels/`, shared state in `src/state/store.ts`, URL mapping in `src/router.ts`, profile and career content in `src/data/siteContent.ts`.
- Visual language: pure black background, delicate glowing white/cyan wireframe line work, no solid meshes. Err toward restraint — dimmer and thinner over brighter.
- Keep career details high-level and only include information provided by Jason; do not invent accomplishments, employers, statistics, or personal details.