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
# Playwright: cache do Chromium em VOLUME PERSISTENTE — sobrevive
# rebuilds e restarts do Coolify. Antes era /ms-playwright (efemero).
# Esse caminho fica dentro de DATA_DIR que ja e mapeado em volume.
ENV PLAYWRIGHT_BROWSERS_PATH=/app/data/playwright-browsers

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

# NAO instalamos Chromium no build porque PLAYWRIGHT_BROWSERS_PATH agora
# aponta pra volume persistente (/app/data/playwright-browsers). Se
# instalassemos no build, o container teria Chromium num path diferente
# do esperado em runtime. Em vez disso, usuario instala via endpoint
# admin (/api/ml/admin/install-chromium) que persiste no volume.
#
# As deps do sistema (libs do Chromium) ja vem instaladas via apt-get
# acima. Entao quando o Chromium for baixado em runtime, ja vai rodar.

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 CMD ["node", "scripts/healthcheck-ping.mjs"]

CMD ["node", "server/index.js"]
