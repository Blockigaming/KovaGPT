# syntax=docker/dockerfile:1.7

ARG KOVA_SOURCE_SHA=unknown
ARG KOVA_SOURCE_TREE=unknown
ARG KOVA_EXPECTED_SUPABASE_PROJECT_REF=unverified
ARG KOVA_VERIFY_BROWSER_CONFIG=false

FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV NODE_ENV=development
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim AS build
ARG KOVA_SOURCE_SHA
ARG KOVA_SOURCE_TREE
ARG KOVA_EXPECTED_SUPABASE_PROJECT_REF
ARG KOVA_VERIFY_BROWSER_CONFIG
ARG KOVA_FORBIDDEN_SUPABASE_PROJECT_REFS=
ARG VITE_SUPABASE_URL=
ARG VITE_SUPABASE_PUBLISHABLE_KEY=
ARG VITE_KOVA_AUTH_MODE=supabase
ARG VITE_KOVA_GOOGLE_AUTH_ENABLED=false
ARG VITE_KOVA_AUTH_ORIGIN=
ARG VITE_PAYMENTS_CLIENT_TOKEN=
WORKDIR /app
ENV NODE_ENV=production \
    KOVA_BROWSER_PREVIEW=node \
    AI_GENERATION_ENABLED=false
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN case "$VITE_KOVA_AUTH_MODE" in \
      supabase|dual|kova) ;; \
      *) echo 'VITE_KOVA_AUTH_MODE must be supabase, dual, or kova' >&2; exit 1 ;; \
    esac \
    && case "$VITE_KOVA_GOOGLE_AUTH_ENABLED" in \
      true|false) ;; \
      *) echo 'VITE_KOVA_GOOGLE_AUTH_ENABLED must be true or false' >&2; exit 1 ;; \
    esac

RUN SHA="$KOVA_SOURCE_SHA" TREE="$KOVA_SOURCE_TREE" node -e "require('fs').writeFileSync('/app/.kova-source-attestation.json', JSON.stringify({schemaVersion:1,context:'acr-git',sourceSha:process.env.SHA,sourceTree:process.env.TREE}))"
RUN VITE_PAYMENTS_CLIENT_TOKEN="$VITE_PAYMENTS_CLIENT_TOKEN" NODE_OPTIONS=--max-old-space-size=5120 KOVA_BUILD_SHA="$KOVA_SOURCE_SHA" npm run build \
    && find dist -name '*.map' -type f -delete \
    && if [ "$KOVA_VERIFY_BROWSER_CONFIG" = "true" ]; then \
      env \
        KOVA_BROWSER_BUNDLE_DIR=dist/client \
        KOVA_BROWSER_CONFIG_PROVENANCE_PATH=dist/browser-config-provenance.json \
        KOVA_SOURCE_SHA="$KOVA_SOURCE_SHA" \
        KOVA_SOURCE_TREE="$KOVA_SOURCE_TREE" \
        KOVA_SOURCE_ATTESTATION_PATH=/app/.kova-source-attestation.json \
        KOVA_EXPECTED_SUPABASE_PROJECT_REF="$KOVA_EXPECTED_SUPABASE_PROJECT_REF" \
        KOVA_FORBIDDEN_SUPABASE_PROJECT_REFS="$KOVA_FORBIDDEN_SUPABASE_PROJECT_REFS" \
        VITE_SUPABASE_URL="$VITE_SUPABASE_URL" \
        VITE_SUPABASE_PUBLISHABLE_KEY="$VITE_SUPABASE_PUBLISHABLE_KEY" \
        VITE_KOVA_AUTH_MODE="$VITE_KOVA_AUTH_MODE" \
        VITE_PAYMENTS_CLIENT_TOKEN="$VITE_PAYMENTS_CLIENT_TOKEN" \
        node scripts/azure/verify-browser-config.mjs; \
    elif [ "$KOVA_VERIFY_BROWSER_CONFIG" != "false" ]; then \
      echo 'KOVA_VERIFY_BROWSER_CONFIG must be true or false' >&2; \
      exit 1; \
    fi

FROM node:24-bookworm-slim AS runtime
ARG KOVA_SOURCE_SHA
ARG KOVA_SOURCE_TREE
ARG KOVA_EXPECTED_SUPABASE_PROJECT_REF
ARG KOVA_VERIFY_BROWSER_CONFIG
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0
LABEL org.opencontainers.image.revision="${KOVA_SOURCE_SHA}" \
      com.kovagpt.source.tree="${KOVA_SOURCE_TREE}" \
      com.kovagpt.browser.supabase-project-ref="${KOVA_EXPECTED_SUPABASE_PROJECT_REF}" \
      com.kovagpt.browser.config-verified="${KOVA_VERIFY_BROWSER_CONFIG}" \
      com.kovagpt.browser.config-provenance="/app/dist/browser-config-provenance.json"

RUN groupadd --system --gid 10001 kova && \
    useradd --system --uid 10001 --gid kova --home-dir /app --shell /usr/sbin/nologin kova

COPY --from=build --chown=kova:kova /app/dist ./dist
COPY --from=build --chown=kova:kova /app/package.json ./package.json
COPY --from=build --chown=kova:kova /app/scripts/auth-email/dispatch.mjs ./scripts/auth-email/dispatch.mjs
COPY --from=build --chown=kova:kova /app/scripts/auth-email/notification-dispatch.mjs ./scripts/auth-email/notification-dispatch.mjs
COPY --from=build --chown=kova:kova /app/scripts/auth-email/production-worker.mjs ./scripts/auth-email/production-worker.mjs
COPY --from=build --chown=kova:kova /app/src/lib/kova-email-worker-auth.server.mjs ./src/lib/kova-email-worker-auth.server.mjs
COPY --from=build --chown=kova:kova /app/src/lib/kova-auth-email.server.mjs ./src/lib/kova-auth-email.server.mjs
COPY --from=build --chown=kova:kova /app/src/lib/kova-account-email.server.mjs ./src/lib/kova-account-email.server.mjs
COPY --from=build --chown=kova:kova /app/src/lib/kova-email-presentation.server.mjs ./src/lib/kova-email-presentation.server.mjs
COPY --from=build --chown=kova:kova /app/src/lib/account-email-preferences.mjs ./src/lib/account-email-preferences.mjs
COPY --from=build --chown=kova:kova /app/src/config/public-config.ts ./src/config/public-config.ts

USER kova
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const net=require('node:net');const socket=net.connect(Number(process.env.PORT||3000),'127.0.0.1');socket.setTimeout(4000);socket.once('connect',()=>{socket.destroy();process.exit(0)});socket.once('timeout',()=>process.exit(1));socket.once('error',()=>process.exit(1))"

CMD ["node", "dist/server/index.mjs"]
