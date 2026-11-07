# syntax=docker/dockerfile:1

# Debian slim base (glibc): better-sqlite3 ships a prebuilt binary, so
# `npm ci` does not need to compile anything.
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# Build tools as a fallback in case better-sqlite3 cannot find a prebuilt
# binary and has to compile from source. They live only in this intermediate
# stage, so they do not bloat the final image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Avoid a slow download leaving the build hanging indefinitely.
ENV npm_config_fetch_timeout=120000 \
    npm_config_fetch_retries=2 \
    npm_config_fetch_retry_maxtimeout=60000

# Install production dependencies reproducibly.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ---- Final image ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=data/fitness.db

# Dependencies installed in the previous stage
COPY --from=deps /app/node_modules ./node_modules

# Application code
COPY package.json package-lock.json ./
COPY server ./server
COPY public ./public

# Persistent data directory, owned by the non-root `node` user
# (that user already exists in the official Node image).
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3000

# Health check against the app's own endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]

# ---- E2E test stage (never shipped) ----
# Built only as an explicit target (`docker build --target e2e`), never part of
# the production `runner` image above. Starts from Playwright's official image,
# which already bundles the browsers and their system libraries, so no browser
# download happens at build time. The image tag is pinned to the same version
# as the @playwright/test devDependency. @playwright/test 1.56 supports Node
# >=18, so it respects engines (>=18, no >=22) wherever it runs.
#
# Note: on a host whose Docker bridge network has no Internet (this project's
# setup), build this target with `--network=host` so `npm ci` can resolve the
# registry — same reason the production build and compose use host networking.
FROM mcr.microsoft.com/playwright:v1.56.0-noble AS e2e
WORKDIR /app

ENV NODE_ENV=test

# Install all dependencies (including devDependencies: Playwright itself).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# Application code plus the E2E specs and config.
COPY server ./server
COPY public ./public
COPY e2e ./e2e
COPY playwright.config.js ./

# playwright.config.js boots the server (dev login, throwaway DB) via its
# webServer option, so running the tests is a single command.
CMD ["npx", "playwright", "test"]

