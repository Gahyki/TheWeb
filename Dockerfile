FROM node:26-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY server ./server
COPY tsconfig.server.json ./
RUN npm run build:server

FROM node:26-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3001
# The in-container bind must accept the container network so a published
# port can reach it; the host-side publish (e.g. 127.0.0.1:3001:3001) is the
# exposure boundary. server/index.ts keeps its loopback default for
# non-container runs.
ENV HOST=0.0.0.0

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/build/server ./build/server

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "build/server/index.js"]
