# syntax=docker/dockerfile:1.7

FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
WORKDIR /app
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG EXPECTED_SUPABASE_PROJECT_REF
ENV NODE_ENV=production \
    KOVA_BROWSER_PREVIEW=node \
    AI_GENERATION_ENABLED=false \
    VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY} \
    EXPECTED_SUPABASE_PROJECT_REF=${EXPECTED_SUPABASE_PROJECT_REF}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN node scripts/validate-public-build-env.mjs && \
    npm run build && \
    node scripts/verify-browser-bundle.mjs && \
    find dist -name '*.map' -type f -delete

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0

RUN groupadd --system --gid 10001 kova && \
    useradd --system --uid 10001 --gid kova --home-dir /app --shell /usr/sbin/nologin kova

COPY --from=build --chown=kova:kova /app/dist ./dist
COPY --from=build --chown=kova:kova /app/package.json ./package.json

USER kova
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server/index.mjs"]
