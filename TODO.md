# TODO

## Deploy frontend and API

- [ ] Replace in-memory rate limiting with a shared store (e.g. Upstash Redis) before relying on limits across Vercel Function instances — per-instance buckets let a determined sender exceed the contact cap by forcing instance churn.
- [ ] Create the alternate Render service from `render.yaml` only if a long-running backend is preferred.
- [ ] Configure the production domain, DNS, and HTTPS; keep preview and production origins appropriately restricted.
- [ ] Deploy a preview and verify navigation and camera transitions, health, age, and GitHub endpoints, contact validation, delivery failures, and successful email delivery.
- [ ] Set `GITHUB_TOKEN` in production to enable the real contribution calendar on the GitHub section.
- [ ] Code-split the ~1.35 MB JS bundle (three.js dominates) with dynamic imports or manualChunks before traffic matters.
- [ ] Promote to production, verify logs and rate limits, and document how to rotate SMTP credentials.
