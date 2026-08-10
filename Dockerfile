# syntax=docker/dockerfile:1.7

ARG KOVA_SOURCE_SHA=unknown
ARG KOVA_BROWSER_SUPABASE_PROJECT_REF=unverified
ARG KOVA_VERIFY_BROWSER_CONFIG=false

FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
ARG KOVA_SOURCE_SHA
ARG KOVA_BROWSER_SUPABASE_PROJECT_REF
ARG KOVA_VERIFY_BROWSER_CONFIG
ARG KOVA_FORBIDDEN_SUPABASE_REFS=""
ARG VITE_SUPABASE_URL=""
ARG VITE_SUPABASE_PUBLISHABLE_KEY=""
WORKDIR /app
ENV NODE_ENV=production \
    KOVA_BROWSER_PREVIEW=node \
    AI_GENERATION_ENABLED=false \
    KOVA_BUILD_SHA=${KOVA_SOURCE_SHA} \
    KOVA_SOURCE_SHA=${KOVA_SOURCE_SHA} \
    KOVA_BROWSER_SUPABASE_PROJECT_REF=${KOVA_BROWSER_SUPABASE_PROJECT_REF} \
    KOVA_VERIFY_BROWSER_CONFIG=${KOVA_VERIFY_BROWSER_CONFIG} \
    KOVA_FORBIDDEN_SUPABASE_REFS=${KOVA_FORBIDDEN_SUPABASE_REFS} \
    KOVA_BROWSER_ASSET_ROOT=dist/client \
    KOVA_BROWSER_CONFIG_PROVENANCE_PATH=dist/browser-config-provenance.json \
    VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_PUBLISHABLE_KEY=${VITE_SUPABASE_PUBLISHABLE_KEY}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && \
    find dist -name '*.map' -type f -delete && \
    if [ "$KOVA_VERIFY_BROWSER_CONFIG" = "true" ]; then \
      node scripts/azure/verify-browser-image-config.mjs; \
    else \
      echo "KOVA_BROWSER_CONFIG_VERIFICATION=disabled"; \
    fi

FROM node:24-bookworm-slim AS runtime
ARG KOVA_SOURCE_SHA
ARG KOVA_BROWSER_SUPABASE_PROJECT_REF
ARG KOVA_VERIFY_BROWSER_CONFIG
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0
LABEL org.opencontainers.image.revision="${KOVA_SOURCE_SHA}" \
      io.kovagpt.browser-supabase-project-ref="${KOVA_BROWSER_SUPABASE_PROJECT_REF}" \
      io.kovagpt.browser-config-verification="${KOVA_VERIFY_BROWSER_CONFIG}"

RUN groupadd --system --gid 10001 kova && \
    useradd --system --uid 10001 --gid kova --home-dir /app --shell /usr/sbin/nologin kova

COPY --from=build --chown=kova:kova /app/dist ./dist
COPY --from=build --chown=kova:kova /app/package.json ./package.json

USER kova
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/server/index.mjs"]
