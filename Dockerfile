FROM node:22-slim

# System Chromium (+ fonts/tzdata) for Puppeteer: PDF export and email chart rendering
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation tzdata \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    TZ=Asia/Kolkata \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# --ignore-scripts skips the Render-era postinstall that downloads Chrome
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY . .

# Cloud Run injects PORT (8080)
EXPOSE 8080
CMD ["node", "server.js"]
