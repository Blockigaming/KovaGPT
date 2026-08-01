FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=optional --no-audit --no-fund && npm cache clean --force
COPY worker ./worker
RUN chown -R node:node /app
USER node
EXPOSE 8788
CMD ["node", "worker/src/index.mjs"]

