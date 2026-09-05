# syntax=docker/dockerfile:1.7
FROM node:24-bookworm-slim
ARG KOVA_SOURCE_SHA=unknown
ARG KOVA_SOURCE_TREE=unknown
LABEL org.opencontainers.image.revision=$KOVA_SOURCE_SHA com.kovagpt.source.tree=$KOVA_SOURCE_TREE
WORKDIR /app
ENV NODE_ENV=production PORT=8081
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src/lib/sites-policy.mjs ./src/lib/sites-policy.mjs
COPY sites-server/*.mjs ./sites-server/
USER node
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8081/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "sites-server/index.mjs"]
