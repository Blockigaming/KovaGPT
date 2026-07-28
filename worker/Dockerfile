FROM mcr.microsoft.com/playwright:v1.56.0-noble
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY package.json package-lock.json ./
RUN npm ci --omit=optional --no-audit --no-fund && npm cache clean --force
COPY worker ./worker
RUN mkdir -p /tmp/kova-agent && chown -R pwuser:pwuser /app /tmp/kova-agent
USER pwuser
EXPOSE 8788
CMD ["node", "worker/src/index.mjs"]
