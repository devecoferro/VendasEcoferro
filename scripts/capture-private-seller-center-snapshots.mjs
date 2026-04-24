import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const STORE_VIEWS = [
  { store: "all", view_selector: "all", view_label: "Todas as vendas" },
  {
    store: "unknown",
    view_selector: "unknown",
    view_label: "Vendas sem deposito",
  },
  {
    store: "79856028",
    view_selector: "79856028",
    view_label: "Ourinhos Rua Dario Alonso",
  },
  { store: "full", view_selector: "full", view_label: "Full" },
];

const TAB_LABELS = {
  TAB_TODAY: "Envios de hoje",
  TAB_NEXT_DAYS: "Proximos dias",
  TAB_IN_THE_WAY: "Em transito",
  TAB_FINISHED: "Finalizadas",
};
const TAB_KEYS = Object.keys(TAB_LABELS);

const TARGET_PRIVATE_PATHS = {
  tabs: "/sales-omni/packs/marketshops/operations-dashboard/tabs",
  actions: "/sales-omni/packs/marketshops/operations-dashboard/actions",
  dashboard: "/sales-omni/packs/marketshops/operations-dashboard",
  list: "/sales-omni/packs/marketshops/list",
};

const DEFAULT_STORAGE_STATE_PATH = path.join(
  process.cwd(),
  "data",
  "playwright",
  "private-seller-center.storage-state.json"
);

function logStep(message) {
  console.log(`[seller-center-capture] ${message}`);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value, fallback = "") {
  if (value == null) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.trunc(parsed));
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y"].includes(normalized)) return true;
    if (["0", "false", "no", "n"].includes(normalized)) return false;
  }

  return fallback;
}

function parseJsonSafely(value, fallback = null) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (process.env[key] != null && process.env[key] !== "") {
      continue;
    }

    let value = line.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function parseCliArgs(argv) {
  const args = {
    headless: null,
    selectedTab: null,
    allTabs: false,
    stores: null,
    skipPost: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === "--help" || current === "-h") {
      args.help = true;
      continue;
    }

    if (current === "--headless") {
      args.headless = true;
      continue;
    }

    if (current === "--headed") {
      args.headless = false;
      continue;
    }

    if (current === "--skip-post") {
      args.skipPost = true;
      continue;
    }

    if (current === "--all-tabs") {
      args.allTabs = true;
      continue;
    }

    if (current === "--selected-tab" && argv[index + 1]) {
      args.selectedTab = argv[index + 1];
      index += 1;
      continue;
    }

    if (current.startsWith("--selected-tab=")) {
      args.selectedTab = current.slice("--selected-tab=".length);
      continue;
    }

    if (current === "--stores" && argv[index + 1]) {
      args.stores = argv[index + 1];
      index += 1;
      continue;
    }

    if (current.startsWith("--stores=")) {
      args.stores = current.slice("--stores=".length);
      continue;
    }
  }

  return args;
}

function printHelp() {
  console.log(`Captura snapshots privados do Seller Center e envia para o backend do EcoFerro.

Uso:
  node scripts/capture-private-seller-center-snapshots.mjs [opcoes]

Opcoes:
  --headless              Roda sem abrir a janela do navegador
  --headed                Forca modo com janela (padrao)
  --selected-tab <TAB>    TAB_TODAY | TAB_NEXT_DAYS | TAB_IN_THE_WAY | TAB_FINISHED
  --all-tabs              Captura todas as tabs de uma vez
  --stores <lista>        Lista separada por virgula. Ex: all,unknown,79856028,full
  --skip-post             Captura e mostra o resultado, mas nao envia ao backend
  --help                  Mostra esta ajuda

Variaveis de ambiente opcionais:
  SELLER_CENTER_CAPTURE_BASE_URL
  SELLER_CENTER_CAPTURE_STORAGE_STATE_PATH
  SELLER_CENTER_CAPTURE_SELECTED_TAB
  SELLER_CENTER_CAPTURE_HEADLESS
  SELLER_CENTER_CAPTURE_LOGIN_TIMEOUT_MS
  ECOFERRO_CAPTURE_BASE_URL
  ECOFERRO_CAPTURE_USERNAME
  ECOFERRO_CAPTURE_PASSWORD
  ECOFERRO_CAPTURE_SESSION_COOKIE_NAME
`);
}

function buildConfig(cliArgs) {
  const configuredSelectedTab =
    normalizeString(cliArgs.selectedTab || process.env.SELLER_CENTER_CAPTURE_SELECTED_TAB) ||
    "";
  const selectedTabs = cliArgs.allTabs
    ? TAB_KEYS
    : configuredSelectedTab
      ? [configuredSelectedTab]
      : ["TAB_TODAY"];

  const storesInput =
    normalizeString(cliArgs.stores || process.env.SELLER_CENTER_CAPTURE_STORES) || null;
  const storeViews =
    storesInput == null
      ? STORE_VIEWS
      : storesInput
          .split(",")
          .map((entry) => normalizeString(entry))
          .filter(Boolean)
          .map((store) => STORE_VIEWS.find((view) => view.store === store))
          .filter(Boolean);

  for (const selectedTab of selectedTabs) {
    if (!TAB_LABELS[selectedTab]) {
      throw new Error(`Selected tab invalida: ${selectedTab}`);
    }
  }

  if (!storeViews || storeViews.length === 0) {
    throw new Error("Nenhuma visao valida foi configurada para captura.");
  }

  return {
    sellerCenterBaseUrl:
      normalizeString(process.env.SELLER_CENTER_CAPTURE_BASE_URL) ||
      "https://www.mercadolivre.com.br/vendas/omni/lista",
    backendBaseUrl:
      normalizeString(process.env.ECOFERRO_CAPTURE_BASE_URL) ||
      normalizeString(process.env.APP_BASE_URL) ||
      "http://127.0.0.1:3000",
    storageStatePath:
      normalizeString(process.env.SELLER_CENTER_CAPTURE_STORAGE_STATE_PATH) ||
      DEFAULT_STORAGE_STATE_PATH,
    selectedTabs,
    headless:
      cliArgs.headless ??
      parseBoolean(process.env.SELLER_CENTER_CAPTURE_HEADLESS, false),
    loginTimeoutMs: Math.max(
      60000,
      Number.parseInt(process.env.SELLER_CENTER_CAPTURE_LOGIN_TIMEOUT_MS || "600000", 10) ||
        600000
    ),
    sessionCookieName:
      normalizeString(process.env.ECOFERRO_CAPTURE_SESSION_COOKIE_NAME) ||
      "ecoferro_session",
    backendUsername: normalizeString(process.env.ECOFERRO_CAPTURE_USERNAME),
    backendPassword: normalizeString(process.env.ECOFERRO_CAPTURE_PASSWORD),
    skipPost: Boolean(cliArgs.skipPost),
    storeViews,
  };
}

function ensureDirectoryForFile(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function buildSellerCenterUrl(baseUrl, store, selectedTab, { offset = 0, subFilters = "" } = {}) {
  const url = new URL(baseUrl);
  url.searchParams.set("search", "");
  url.searchParams.set("limit", "50");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("selectedTab", selectedTab);
  url.searchParams.set("store", store);
  url.searchParams.set("filters", selectedTab);
  url.searchParams.set("subFilters", subFilters);
  url.searchParams.set("startPeriod", "");
  return url.toString();
}

function isObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function walkDeep(value, visitor, path = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkDeep(entry, visitor, [...path, index]));
    return;
  }

  if (!isObject(value)) {
    return;
  }

  visitor(value, path);

  for (const [key, child] of Object.entries(value)) {
    walkDeep(child, visitor, [...path, key]);
  }
}

function findFirstDeep(root, predicate) {
  let found = null;
  walkDeep(root, (node, path) => {
    if (found) return;
    if (predicate(node, path)) {
      found = node;
    }
  });
  return found;
}

function objectContainsEndpoint(node, endpointPath) {
  if (!isObject(node)) return false;
  return Object.values(node).some(
    (value) => typeof value === "string" && value.includes(endpointPath)
  );
}

function pickNestedPayload(node) {
  if (!node) return null;
  const candidateKeys = ["data", "payload", "response", "body", "result", "value", "props"];

  for (const key of candidateKeys) {
    const value = node?.[key];
    if (value != null) {
      return value;
    }
  }

  return node;
}

function extractCountFromUnknown(value) {
  if (value == null) return 0;
  if (typeof value === "number") return normalizeInteger(value);
  if (typeof value === "string") {
    const matched = value.match(/\d+/);
    return matched ? normalizeInteger(Number.parseInt(matched[0], 10)) : 0;
  }

  if (isObject(value)) {
    const keys = ["count", "value", "quantity", "total", "badge", "number"];
    for (const key of keys) {
      if (key in value) {
        const resolved = extractCountFromUnknown(value[key]);
        if (resolved > 0) {
          return resolved;
        }
      }
    }
  }

  return 0;
}

function normalizeTabKey(segment) {
  return (
    normalizeString(segment?.id) ||
    normalizeString(segment?.key) ||
    normalizeString(segment?.value) ||
    normalizeString(segment?.tab)
  );
}

function extractTabsPayload(rawPayload) {
  const tabsNode =
    findFirstDeep(rawPayload, (node) =>
      Array.isArray(node?.segments) &&
      node.segments.some((segment) => TAB_LABELS[normalizeTabKey(segment)])
    ) ||
    findFirstDeep(rawPayload, (node) => objectContainsEndpoint(node, TARGET_PRIVATE_PATHS.tabs));

  if (!tabsNode) {
    return null;
  }

  const resolvedNode = pickNestedPayload(tabsNode);
  const segments = Array.isArray(resolvedNode?.segments)
    ? resolvedNode.segments
    : Array.isArray(resolvedNode)
      ? resolvedNode
      : [];

  const counts = {
    today: 0,
    upcoming: 0,
    in_transit: 0,
    finalized: 0,
  };

  const normalizedSegments = segments.map((segment) => {
    const tabKey = normalizeTabKey(segment);
    const count = extractCountFromUnknown(segment);

    if (tabKey === "TAB_TODAY") counts.today = count;
    if (tabKey === "TAB_NEXT_DAYS") counts.upcoming = count;
    if (tabKey === "TAB_IN_THE_WAY") counts.in_transit = count;
    if (tabKey === "TAB_FINISHED") counts.finalized = count;

    return {
      key: tabKey,
      label:
        normalizeString(segment?.label) ||
        normalizeString(segment?.title) ||
        TAB_LABELS[tabKey] ||
        tabKey,
      count,
    };
  });

  return {
    counts,
    segments: normalizedSegments,
    raw: resolvedNode,
  };
}

function extractActionsPayload(rawPayload) {
  const actionsNode =
    findFirstDeep(rawPayload, (node) => isObject(node?.post_sale_button_marketshops)) ||
    findFirstDeep(rawPayload, (node) =>
      objectContainsEndpoint(node, TARGET_PRIVATE_PATHS.actions)
    );

  if (!actionsNode) {
    return null;
  }

  const resolvedNode = isObject(actionsNode?.post_sale_button_marketshops)
    ? pickNestedPayload(actionsNode.post_sale_button_marketshops)
    : pickNestedPayload(actionsNode);

  return {
    count: extractCountFromUnknown(resolvedNode),
    raw: resolvedNode,
  };
}

function scoreCardArray(candidate) {
  if (!Array.isArray(candidate) || candidate.length === 0) {
    return 0;
  }

  let score = 0;

  for (const item of candidate.slice(0, 6)) {
    if (!isObject(item)) continue;

    if (
      normalizeString(item.label) ||
      normalizeString(item.title) ||
      normalizeString(item.name) ||
      normalizeString(item.headline)
    ) {
      score += 2;
    }

    if (extractCountFromUnknown(item) > 0 || extractCountFromUnknown(item.badge) > 0) {
      score += 1;
    }

    if (
      Array.isArray(item.tasks) ||
      Array.isArray(item.items) ||
      Array.isArray(item.rows) ||
      Array.isArray(item.children)
    ) {
      score += 3;
    }
  }

  return score;
}

function findBestCardArray(rawPayload) {
  const candidates = [];

  walkDeep(rawPayload, (node) => {
    if (Array.isArray(node)) {
      const score = scoreCardArray(node);
      if (score > 0) {
        candidates.push({ score, value: node });
      }
    }

    if (Array.isArray(node?.cards)) {
      const score = scoreCardArray(node.cards) + 5;
      candidates.push({ score, value: node.cards });
    }

    if (Array.isArray(node?.bricks)) {
      const score = scoreCardArray(node.bricks) + 4;
      candidates.push({ score, value: node.bricks });
    }
  });

  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.value || [];
}

function extractTasksFromCard(card) {
  const candidateArrays = [card?.tasks, card?.items, card?.rows, card?.children].filter(Array.isArray);
  const source = candidateArrays[0] || [];

  return source
    .map((task, index) => {
      if (!isObject(task)) return null;

      const label =
        normalizeString(task.label) ||
        normalizeString(task.title) ||
        normalizeString(task.name) ||
        `Tarefa ${index + 1}`;

      return {
        key:
          normalizeString(task.key) ||
          normalizeString(task.id) ||
          `task-${index + 1}`,
        label,
        count: extractCountFromUnknown(task),
      };
    })
    .filter(Boolean);
}

function normalizeCards(cards) {
  return cards
    .map((card, index) => {
      if (!isObject(card)) return null;

      const tasks = extractTasksFromCard(card);
      const label =
        normalizeString(card.label) ||
        normalizeString(card.title) ||
        normalizeString(card.name) ||
        normalizeString(card.headline) ||
        `Card ${index + 1}`;

      return {
        key:
          normalizeString(card.key) ||
          normalizeString(card.id) ||
          `card-${index + 1}`,
        label,
        count: extractCountFromUnknown(card),
        tag: normalizeString(card.tag),
        tasks,
      };
    })
    .filter(Boolean);
}

function extractDashboardPayload(rawPayload) {
  const dashboardNode =
    findFirstDeep(rawPayload, (node) => objectContainsEndpoint(node, TARGET_PRIVATE_PATHS.dashboard)) ||
    rawPayload;
  const resolvedNode = pickNestedPayload(dashboardNode);
  const cards = normalizeCards(findBestCardArray(resolvedNode));

  return {
    cards,
    raw: resolvedNode,
  };
}

function extractListPayload(rawPayload) {
  const listNode = findFirstDeep(rawPayload, (node) =>
    objectContainsEndpoint(node, TARGET_PRIVATE_PATHS.list)
  );

  if (!listNode) {
    return null;
  }

  const resolvedNode = pickNestedPayload(listNode);
  return {
    total: extractCountFromUnknown(resolvedNode?.total ?? resolvedNode?.count),
    raw: resolvedNode,
  };
}

async function extractFallbackUiSnapshot(page, selectedTab, selectedTabLabel) {
  return page.evaluate(({ selectedTab, selectedTabLabel }) => {
    function normalizeIntegerInner(value) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return 0;
      return Math.max(0, Math.trunc(parsed));
    }

    function extractCountFromText(text, label) {
      if (!text) return null;
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`${escaped}\\s*(\\d+)`, "i");
      const matched = text.match(regex);
      return matched ? normalizeIntegerInner(Number.parseInt(matched[1], 10)) : null;
    }

    function extractCountFromLabels(text, labels) {
      for (const label of labels) {
        const value = extractCountFromText(text, label);
        if (value != null) {
          return value;
        }
      }

      return null;
    }

    const bodyText = document.body.innerText || "";
    const counts = {
      today: extractCountFromLabels(bodyText, ["Envios de hoje"]) ?? 0,
      upcoming: extractCountFromLabels(bodyText, ["Proximos dias", "Próximos dias"]) ?? 0,
      in_transit: extractCountFromLabels(bodyText, ["Em transito", "Em trânsito"]) ?? 0,
      finalized: extractCountFromLabels(bodyText, ["Finalizadas"]) ?? 0,
    };

    const postSaleCount =
      extractCountFromLabels(bodyText, [
        "Gerenciar Pos-venda",
        "Gerenciar Pós-venda",
      ]) ?? 0;

    const cards = [];
    const seenLabels = new Set();
    const cardNodes = Array.from(document.querySelectorAll("div"))
      .filter((node) => {
        const text = (node.innerText || "").trim();
        return text && text.length < 400 && /\d/.test(text) && text.split("\n").length >= 2;
      })
      .slice(0, 50);

    for (const node of cardNodes) {
      const lines = (node.innerText || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length < 2) continue;

      const label = lines[0];
      if (seenLabels.has(label)) continue;

      const tasks = lines.slice(1).map((line, index) => {
        const matched = line.match(/^(.*?)(\d+)$/);
        return {
          key: `task-${index + 1}`,
          label: matched ? matched[1].trim() : line,
          count: matched ? normalizeIntegerInner(Number.parseInt(matched[2], 10)) : 0,
        };
      });

      cards.push({
        key: `dom-${cards.length + 1}`,
        label,
        count: tasks.reduce((total, task) => total + task.count, 0),
        tag: "",
        tasks,
      });
      seenLabels.add(label);
    }

    return {
      selected_tab: selectedTab,
      selected_tab_label: selectedTabLabel,
      tab_counts: counts,
      post_sale_count: postSaleCount,
      cards,
    };
  }, { selectedTab, selectedTabLabel });
}

function createEventCollector() {
  const captured = {
    events: [],
    tabs: null,
    actions: null,
    dashboard: null,
    list: null,
  };

  return {
    async handleResponse(response) {
      const url = response.url();
      if (!url.includes("/vendas/omni/lista/api/channels/event-request")) {
        return;
      }

      let requestBody = null;
      let responseBody = null;

      try {
        requestBody = parseJsonSafely(response.request().postData(), null);
      } catch {
        requestBody = null;
      }

      try {
        responseBody = await response.json();
      } catch {
        responseBody = null;
      }

      const eventRecord = {
        captured_at: nowIso(),
        request: requestBody,
        response: responseBody,
      };

      captured.events.push(eventRecord);

      if (!captured.tabs) {
        captured.tabs = extractTabsPayload(responseBody);
      }

      if (!captured.actions) {
        captured.actions = extractActionsPayload(responseBody);
      }

      if (!captured.dashboard) {
        captured.dashboard = extractDashboardPayload(responseBody);
      }

      if (!captured.list) {
        captured.list = extractListPayload(responseBody);
      }
    },
    hasMinimumData() {
      return Boolean(captured.tabs || captured.actions || captured.dashboard || captured.list);
    },
    buildRawPayload() {
      return {
        captured_at: nowIso(),
        tabs: captured.tabs?.raw || null,
        actions: captured.actions?.raw || null,
        dashboard: captured.dashboard?.raw || null,
        list: captured.list?.raw || null,
        event_requests: captured.events,
      };
    },
    getState() {
      return captured;
    },
  };
}

async function waitForSellerCenterReady(page, timeoutMs) {
  // Validacao simples: URL correta + DOM carregado.
  // Nao exige seletor especifico pq o ML muda DOM com frequencia e DOM
  // selectors velhos falham mesmo com login valido. Se a URL nao foi
  // pra /auth/login e tem /vendas/omni/lista, consideramos pronto.
  const deadline = Date.now() + timeoutMs;
  const checkInterval = 500;
  while (Date.now() < deadline) {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    const currentUrl = page.url();
    if (/\/auth\/login/i.test(currentUrl) || /\/registration/i.test(currentUrl)) {
      throw new Error(`Redirecionado para login: ${currentUrl}`);
    }
    if (/\/vendas\/omni\/lista/i.test(currentUrl)) {
      // URL ok. Aguarda networkidle ate 5s pra dar chance de renderizar.
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      return;
    }
    await page.waitForTimeout(checkInterval);
  }
  throw new Error("Timeout aguardando Seller Center ficar pronto");
}

async function hasBackendSession(context, backendBaseUrl, sessionCookieName) {
  const cookies = await context.cookies(backendBaseUrl);
  return cookies.some((cookie) => cookie.name === sessionCookieName && Boolean(cookie.value));
}

async function ensureSellerCenterLogin(page, context, config) {
  const initialUrl = buildSellerCenterUrl(
    config.sellerCenterBaseUrl,
    config.storeViews[0].store,
    config.selectedTabs[0]
  );
  await page.goto(initialUrl, { waitUntil: "domcontentloaded" });

  try {
    await waitForSellerCenterReady(page, 8000);
    logStep("Sessao do Seller Center reaproveitada com sucesso.");
  } catch {
    logStep(
      "Sessao do Seller Center nao estava valida. Conclua o login manualmente na janela aberta; o script continua automaticamente assim que detectar login."
    );
    // Aguarda user sair de /auth/login (login concluido)
    const loginDeadline = Date.now() + config.loginTimeoutMs;
    while (Date.now() < loginDeadline) {
      const u = page.url();
      if (!/\/auth\/login/i.test(u) && !/\/registration/i.test(u)) {
        logStep(`Login detectado (url=${u}). Forcando navegacao para /vendas/omni/lista...`);
        break;
      }
      await page.waitForTimeout(1000);
    }
    if (Date.now() >= loginDeadline) {
      throw new Error("Tempo esgotado aguardando o login manual do Seller Center.");
    }
    // Forca navegacao pra URL que queremos — apos login, ML pode ter
    // redirecionado pra home, central-vendedor, etc.
    await page.goto(initialUrl, { waitUntil: "domcontentloaded" });
    await waitForSellerCenterReady(page, 60000).catch((err) => {
      throw new Error(
        `Apos login, nao conseguiu carregar /vendas/omni/lista: ${err?.message || err}`
      );
    });
    logStep("Login manual confirmado e pagina de vendas carregada.");
  }

  await context.storageState({ path: config.storageStatePath });
}

async function tryBackendAutomaticLogin(page, context, config) {
  if (!config.backendUsername || !config.backendPassword) {
    return false;
  }

  logStep("Tentando autenticar automaticamente no EcoFerro para enviar snapshots.");
  await page.goto(`${config.backendBaseUrl.replace(/\/$/, "")}/login`, {
    waitUntil: "domcontentloaded",
  });

  const userInput = page.locator('input[type="text"], input[name="username"]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  const submitButton = page.getByRole("button", { name: /entrar no painel/i }).first();

  await userInput.waitFor({ timeout: 15000 });
  await passwordInput.waitFor({ timeout: 15000 });

  await userInput.fill(config.backendUsername);
  await passwordInput.fill(config.backendPassword);
  await submitButton.click();

  try {
    await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 15000 });
  } catch {
    // segue para a validacao por cookie
  }

  const loggedIn = await hasBackendSession(
    context,
    config.backendBaseUrl,
    config.sessionCookieName
  );

  if (loggedIn) {
    logStep("Autenticacao automatica no EcoFerro concluida.");
    await context.storageState({ path: config.storageStatePath });
  }

  return loggedIn;
}

async function ensureBackendLogin(page, context, config) {
  if (
    await hasBackendSession(context, config.backendBaseUrl, config.sessionCookieName)
  ) {
    logStep("Sessao do EcoFerro reaproveitada com sucesso.");
    return;
  }

  const automaticLoginWorked = await tryBackendAutomaticLogin(page, context, config);
  if (automaticLoginWorked) {
    return;
  }

  logStep("Sessao do EcoFerro nao encontrada. Faca o login manualmente na janela aberta.");
  await page.goto(`${config.backendBaseUrl.replace(/\/$/, "")}/login`, {
    waitUntil: "domcontentloaded",
  });

  const loginDeadline = Date.now() + config.loginTimeoutMs;
  let loggedIn = false;
  while (Date.now() < loginDeadline) {
    loggedIn = await hasBackendSession(
      context,
      config.backendBaseUrl,
      config.sessionCookieName
    );
    if (loggedIn) {
      break;
    }
    await page.waitForTimeout(1000);
  }

  if (!loggedIn) {
    throw new Error("Nao foi possivel confirmar a sessao autenticada no EcoFerro.");
  }

  await context.storageState({ path: config.storageStatePath });
  logStep("Login manual do EcoFerro confirmado.");
}

async function capturePrivateView(page, view, selectedTab, selectedTabLabel, config) {
  const collector = createEventCollector();
  const responseListener = (response) => {
    void collector.handleResponse(response);
  };

  page.on("response", responseListener);

  try {
    // ── Z2: paginação (offset loop) ─────────────────────────────────
    // Z3: também captura subFilters/hrefs únicos dos sub-cards por página
    const MAX_PAGES = 40; // 40×50 = 2000 pedidos max por visão (finalized tem 1903)
    const PAGE_SIZE = 50;
    const allPageUrls = [];
    const subFiltersObserved = new Set();
    const sortsObserved = new Set();

    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
      const offset = pageIndex * PAGE_SIZE;
      const targetUrl = buildSellerCenterUrl(
        config.sellerCenterBaseUrl,
        view.store,
        selectedTab,
        { offset }
      );
      logStep(
        `Abrindo visao ${view.view_label} (${view.store}) tab=${selectedTab} offset=${offset}`
      );
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
      allPageUrls.push(page.url());

      // Captura hrefs da UI que tenham subFilters ou sort populados
      try {
        const hrefs = await page.$$eval("a[href*='subFilters=']", (els) =>
          els.map((a) => a.getAttribute("href") || "").filter(Boolean)
        );
        for (const h of hrefs) {
          try {
            const u = new URL(h, config.sellerCenterBaseUrl);
            const sf = u.searchParams.get("subFilters");
            const so = u.searchParams.get("sort");
            if (sf) subFiltersObserved.add(sf);
            if (so) sortsObserved.add(so);
          } catch {
            // href malformado — ignora
          }
        }
      } catch {
        // selector não achou nada — segue
      }

      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        if (collector.hasMinimumData()) break;
        await page.waitForTimeout(500);
      }

      // Conta rows desta página (se <50, é a última)
      const stateNow = collector.getState();
      const rowsThisPage = Array.isArray(stateNow.dashboard?.rows)
        ? stateNow.dashboard.rows.length - (pageIndex === 0 ? 0 : pageIndex * PAGE_SIZE)
        : 0;
      if (pageIndex > 0 && rowsThisPage < PAGE_SIZE) {
        logStep(`  ultima pagina atingida (rows=${rowsThisPage} < ${PAGE_SIZE})`);
        break;
      }

      await page.waitForTimeout(500); // polidez
    }

    const fallbackUi = await extractFallbackUiSnapshot(
      page,
      selectedTab,
      selectedTabLabel
    );
    const state = collector.getState();

    const snapshot = {
      store: view.store,
      view_selector: view.view_selector,
      view_label: view.view_label,
      selected_tab: selectedTab,
      selected_tab_label: selectedTabLabel,
      tab_counts: state.tabs?.counts || fallbackUi.tab_counts,
      post_sale_count:
        normalizeInteger(state.actions?.count) || fallbackUi.post_sale_count || 0,
      cards:
        (Array.isArray(state.dashboard?.cards) && state.dashboard.cards.length > 0
          ? state.dashboard.cards
          : fallbackUi.cards) || [],
      // Z3: valores de subFilters e sort observados em links da lista
      sub_filters_observed: Array.from(subFiltersObserved),
      sorts_observed: Array.from(sortsObserved),
      pages_captured: allPageUrls.length,
      page_urls: allPageUrls,
      raw_payload: {
        ...collector.buildRawPayload(),
        page_url: page.url(),
        page_title: await page.title(),
      },
      captured_at: nowIso(),
    };

    return snapshot;
  } finally {
    page.off("response", responseListener);
  }
}

async function postSnapshotsToBackend(page, snapshots) {
  return page.evaluate(async ({ snapshots }) => {
    const response = await fetch("/api/ml/private-seller-center-snapshots", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ snapshots }),
    });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  }, { snapshots });
}

function summarizeSnapshot(snapshot) {
  const counts = snapshot.tab_counts || {};
  return [
    `today=${normalizeInteger(counts.today)}`,
    `upcoming=${normalizeInteger(counts.upcoming)}`,
    `in_transit=${normalizeInteger(counts.in_transit)}`,
    `finalized=${normalizeInteger(counts.finalized)}`,
    `post_sale=${normalizeInteger(snapshot.post_sale_count)}`,
  ].join(" | ");
}

async function main() {
  loadEnvFile();
  const cliArgs = parseCliArgs(process.argv.slice(2));
  if (cliArgs.help) {
    printHelp();
    return;
  }

  const config = buildConfig(cliArgs);
  ensureDirectoryForFile(config.storageStatePath);

  const browser = await chromium.launch({
    headless: config.headless,
    slowMo: config.headless ? 0 : 50,
  });

  const context = await browser.newContext(
    fs.existsSync(config.storageStatePath)
      ? { storageState: config.storageStatePath }
      : undefined
  );

  const sellerPage = await context.newPage();
  const backendPage = await context.newPage();

  try {
    await ensureSellerCenterLogin(sellerPage, context, config);
    // Backend login so e necessario pra POST dos snapshots. Pula quando
    // --skip-post (modo auditoria local — nao envia pro backend).
    if (!config.skipPost) {
      await ensureBackendLogin(backendPage, context, config);
    } else {
      logStep("--skip-post ativo: pulando login no backend EcoFerro.");
    }

    const snapshots = [];

    for (const selectedTab of config.selectedTabs) {
      const selectedTabLabel = TAB_LABELS[selectedTab];

      for (const view of config.storeViews) {
        const snapshot = await capturePrivateView(
          sellerPage,
          view,
          selectedTab,
          selectedTabLabel,
          config
        );
        snapshots.push(snapshot);
        logStep(
          `Snapshot capturado para ${view.view_label} [${selectedTabLabel}]: ${summarizeSnapshot(snapshot)}`
        );
      }
    }

    await context.storageState({ path: config.storageStatePath });

    if (config.skipPost) {
      // Salva em tmp-ml-audit3/ pra auditoria posterior (Z2+Z3)
      const outDir = path.join(process.cwd(), "tmp-ml-audit3");
      fs.mkdirSync(outDir, { recursive: true });
      for (const snap of snapshots) {
        const name = `${snap.selected_tab}.${snap.store}.json`;
        fs.writeFileSync(path.join(outDir, name), JSON.stringify(snap, null, 2));
      }
      // Consolidado: subFilters e sorts únicos agregados
      const allSubFilters = new Set();
      const allSorts = new Set();
      for (const s of snapshots) {
        for (const sf of s.sub_filters_observed || []) allSubFilters.add(sf);
        for (const so of s.sorts_observed || []) allSorts.add(so);
      }
      fs.writeFileSync(
        path.join(outDir, "_aggregate.json"),
        JSON.stringify(
          {
            generated_at: nowIso(),
            total_snapshots: snapshots.length,
            tabs_captured: [...new Set(snapshots.map((s) => s.selected_tab))],
            stores_captured: [...new Set(snapshots.map((s) => s.store))],
            sub_filters_unique: [...allSubFilters],
            sorts_unique: [...allSorts],
            pages_per_snapshot: snapshots.map((s) => ({
              tab: s.selected_tab,
              store: s.store,
              pages: s.pages_captured,
              tab_counts: s.tab_counts,
            })),
          },
          null,
          2
        )
      );
      logStep(
        `Captura concluida (--skip-post). ${snapshots.length} snapshots salvos em ${outDir}`
      );
      logStep(
        `  sub_filters unicos: ${allSubFilters.size} | sorts unicos: ${allSorts.size}`
      );
      return;
    }

    await backendPage.goto(`${config.backendBaseUrl.replace(/\/$/, "")}/`, {
      waitUntil: "domcontentloaded",
    });
    const postResult = await postSnapshotsToBackend(backendPage, snapshots);

    if (!postResult.ok) {
      throw new Error(
        `Falha ao enviar snapshots para o backend (${postResult.status}): ${JSON.stringify(
          postResult.payload || {}
        )}`
      );
    }

    logStep(
      `Snapshots enviados com sucesso. Inseridos: ${normalizeInteger(
        postResult.payload?.inserted_count
      )}`
    );
    console.log(
      JSON.stringify(
        {
          status: "ok",
          inserted_count: normalizeInteger(postResult.payload?.inserted_count),
          snapshot_status: postResult.payload?.snapshot_status || null,
          stores: snapshots.map((snapshot) => ({
            store: snapshot.store,
            view_label: snapshot.view_label,
            selected_tab: snapshot.selected_tab,
            tab_counts: snapshot.tab_counts,
            post_sale_count: snapshot.post_sale_count,
          })),
        },
        null,
        2
      )
    );
  } finally {
    await context.storageState({ path: config.storageStatePath }).catch(() => {});
    await browser.close();
  }
}

main().catch((error) => {
  console.error(
    `[seller-center-capture] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
