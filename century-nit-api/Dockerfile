# Build context is the MONOREPO ROOT, not this directory:
#
#   docker build -f century-nit-api/Dockerfile -t century-nit-api .
#
# It has to be. century-nit-api depends on the `century-nit-shared` workspace
# package, and the only lockfile lives at the root. Building from this directory
# fails on `npm ci` (no lockfile here) and then again on resolving
# century-nit-shared from the public registry, where it does not exist.

# ── Stage 1: install every workspace dependency, dev included ──
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY century-nit-api/package.json ./century-nit-api/
COPY packages/shared/package.json ./packages/shared/
# The web workspace is not needed to build the API, but npm resolves the whole
# workspace graph from the lockfile, so its manifest has to be present.
COPY century-nit-web/package.json ./century-nit-web/
RUN npm ci --workspace=century-nit-api --workspace=packages/shared --include-workspace-root

# ── Stage 2: compile shared first, then the API that imports its types ──
FROM deps AS builder
WORKDIR /app
COPY packages/shared ./packages/shared
COPY century-nit-api ./century-nit-api
RUN npm run build --workspace=packages/shared \
	&& npm run build --workspace=century-nit-api

# ── Stage 3: production dependencies only ──
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY century-nit-api/package.json ./century-nit-api/
COPY packages/shared/package.json ./packages/shared/
COPY century-nit-web/package.json ./century-nit-web/
RUN npm ci --omit=dev --workspace=century-nit-api --workspace=packages/shared --include-workspace-root

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
# `century-nit-shared` resolves through the root node_modules symlink into here.
COPY --chown=node:node --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --chown=node:node --from=builder /app/packages/shared/dist ./packages/shared/dist

WORKDIR /app/century-nit-api
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
