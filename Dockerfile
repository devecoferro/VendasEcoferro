FROM node:20-bookworm-slim AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build

WORKDIR /app
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATA_DIR=/app/data
# Playwright: cache do Chromium headless (instalado abaixo)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Dependências runtime do Chromium headless (pra scraper ML Seller Center)
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libatspi2.0-0 libcairo2 libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 \
    libnspr4 libnss3 libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 \
    libxext6 libxfixes3 libxkbcommon0 libxrandr2 libxss1 wget xdg-utils \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/server ./server
COPY --from=build /app/api ./api
COPY --from=build /app/scripts ./scripts

# Instala Chromium headless usado pelo scraper ML (best-effort: se falhar,
# o scraper fica inativo mas o resto do sistema continua funcionando).
RUN npx playwright install chromium --with-deps 2>&1 || echo "[warn] Playwright chromium install failed — scraper indisponível"

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 CMD ["node", "scripts/healthcheck-ping.mjs"]

CMD ["node", "server/index.js"]
