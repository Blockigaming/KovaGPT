FROM mcr.microsoft.com/playwright:v1.56.0-noble

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    NODE_ENV=production \
    HOME=/home/pwuser

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev --omit=optional --no-audit --no-fund \
    && npm cache clean --force

COPY --chown=pwuser:pwuser browser-worker ./browser-worker

USER pwuser

ENTRYPOINT ["node", "browser-worker/src/index.mjs"]
