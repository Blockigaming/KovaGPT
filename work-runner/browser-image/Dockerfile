# syntax=docker/dockerfile:1.7
# The source image version matches package-lock. Deployment must pin the built
# image's SHA-256; the runner refuses mutable tags.
ARG PLAYWRIGHT_BASE_IMAGE=mcr.microsoft.com/playwright:v1.56.0-noble@sha256:35246d87a7c88ea9b771c65d33171b2611b02a8253b4b12ce6f94376c55f99f2
FROM ${PLAYWRIGHT_BASE_IMAGE}
WORKDIR /browser
COPY package.json package-lock.json ./
RUN npm ci --omit=optional --ignore-scripts && chmod -R a+rX /browser /ms-playwright && mkdir -p /home/browser && chown 65532:65532 /home/browser
COPY --chmod=0444 driver.mjs worker.mjs ./
ENV HOME=/home/browser PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
LABEL com.kova.browser.protocol=kova-browser-v1
USER 65532:65532
ENTRYPOINT ["node", "/browser/worker.mjs"]
