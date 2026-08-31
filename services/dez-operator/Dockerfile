# Playwright's official image ships Chromium + system deps — no postinstall download needed.
FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app

# Install deps without the postinstall browser download (image already has Chromium).
COPY package.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
RUN npm install --ignore-scripts typescript && npx tsc -p tsconfig.json

# Persist the AppFolio session across restarts (mount a Railway volume here).
ENV APPFOLIO_STORAGE_STATE=/data/storageState.json
VOLUME ["/data"]

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/server.js"]
