# Build context is the MONOREPO ROOT, not this directory:
#
#   docker build -f century-nit-api/Dockerfile -t century-nit-api .
#
# It has to be. century-nit-api depends on the `century-nit-shared` and
# `century-nit-core` workspace packages, and the only lockfile lives at the root.
# Building from this directory fails on `npm ci` (no lockfile here) and then
# again on resolving those packages from the public registry, where they do not
# exist.
#
# Every workspace the API depends on must be copied AND built here explicitly.
# Locally this is invisible: the root `npm install` symlinks workspaces into
# node_modules, so an import resolves whether or not the package was ever built.
# Docker only has what these COPY lines list, so a missing workspace surfaces as
# "Cannot find module 'century-nit-core/content'" during `tsc` — which is exactly
# how this file drifted once already.

# ── Stage 1: install every workspace dependency, dev included ──
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY century-nit-api/package.json ./century-nit-api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
# The web and ops workspaces are not needed to build the API, but npm resolves
# the whole workspace graph from the lockfile, so their manifests must be present.
COPY century-nit-web/package.json ./century-nit-web/
COPY century-nit-ops/package.json ./century-nit-ops/
RUN npm ci \
	--workspace=century-nit-api \
	--workspace=packages/shared \
	--workspace=packages/core \
	--include-workspace-root

# ── Stage 2: compile the workspaces the API imports, then the API ──
FROM deps AS builder
WORKDIR /app
COPY packages/shared ./packages/shared
COPY packages/core ./packages/core
COPY century-nit-api ./century-nit-api
# Order matters: the API imports the emitted types of both packages, so they must
# be built first. `century-nit-core` also imports `century-nit-shared`.
RUN npm run build --workspace=packages/shared \
	&& npm run build --workspace=packages/core \
	&& npm run build --workspace=century-nit-api

# ── Stage 3: production dependencies only ──
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY century-nit-api/package.json ./century-nit-api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/core/package.json ./packages/core/
COPY century-nit-web/package.json ./century-nit-web/
COPY century-nit-ops/package.json ./century-nit-ops/
RUN npm ci --omit=dev \
	--workspace=century-nit-api \
	--workspace=packages/shared \
	--workspace=packages/core \
	--include-workspace-root

# ── Stage 4: runtime ──
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Run unprivileged. node:22-alpine ships a `node` user for exactly this.
RUN mkdir -p /app && chown -R node:node /app
USER node

COPY --chown=node:node --from=prod-deps /app/node_modules ./node_modules
COPY --chown=node:node --from=prod-deps /app/century-nit-api/node_modules ./century-nit-api/node_modules
COPY --chown=node:node --from=builder /app/century-nit-api/package.json ./century-nit-api/package.json
COPY --chown=node:node --from=builder /app/century-nit-api/dist ./century-nit-api/dist
# Migrations are the source of truth for the schema and must ship with the image.
COPY --chown=node:node --from=builder /app/century-nit-api/drizzle ./century-nit-api/drizzle
COPY --chown=node:node --from=builder /app/century-nit-api/drizzle.config.ts ./century-nit-api/drizzle.config.ts
# Workspace packages resolve through the root node_modules symlinks into here, so
# both the manifest and the emitted output are required at runtime.
COPY --chown=node:node --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --chown=node:node --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --chown=node:node --from=builder /app/packages/core/package.json ./packages/core/package.json
COPY --chown=node:node --from=builder /app/packages/core/dist ./packages/core/dist

WORKDIR /app/century-nit-api
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
