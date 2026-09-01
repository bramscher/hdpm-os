# Playwright's official image ships Chromium + system deps — no postinstall download needed.
# NOTE: this tag MUST match the pinned "playwright" version in package.json, or
# Playwright looks for a Chromium build the image doesn't have.
FROM mcr.microsoft.com/playwright:v1.62.1-jammy

WORKDIR /app

# Install deps without the postinstall browser download (image already has Chromium).
COPY package.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev --ignore-scripts

COPY tsconfig.json ./
COPY src ./src
# tsc needs typescript + @types/node (the latter is a devDep omitted above).
RUN npm install --ignore-scripts typescript @types/node && npx tsc -p tsconfig.json

# Persist the AppFolio session across restarts. NOTE: Railway rejects the Docker
# VOLUME instruction — attach a Railway Volume at /data instead (done in the UI).
ENV APPFOLIO_STORAGE_STATE=/data/storageState.json

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/server.js"]
