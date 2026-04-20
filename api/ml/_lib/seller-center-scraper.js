// ═══════════════════════════════════════════════════════════════════
// Seller Center Scraper — Playwright headless
//
// Captura os chips da UI do Mercado Livre Seller Center diretamente via
// DOM scraping, pois a API pública do ML não expõe os mesmos números
// que a UI mostra (agregações internas que misturam orders, shipments,
// post-sale e reputação).
//
// Fluxo:
// 1. Setup manual (1x): admin loga no ML via script dedicated e salva
//    storage state (cookies/localStorage) em arquivo.
// 2. Cron em produção: a cada N min, playwright headless carrega o state,
//    navega pra https://www.mercadolivre.com.br/vendas/omni/lista,
//    extrai os chips do DOM, retorna objeto { today, upcoming, in_transit,
//    finalized }.
// 3. Resultado é cacheado em memória por ~5min e exposto em
//    buildDashboardPayload como ml_ui_chip_counts.
// 4. Se a sessão expirar (redirect pra login ou DOM não bate), retorna
//    { error: "session_expired" } e admin é alertado via log.
//
// ⚠️ SEGURANÇA:
// - Storage state é ARMAZENADO em disco NO DATA_DIR (volume persistente)
// - NUNCA vai pro git (.gitignore exclui data/)
// - Rotacionado se for detectada sessão inválida
//
// ⚠️ RISCO:
// - ML pode detectar padrão de scraping e bloquear a conta.
// - Mitigar: intervalo de 5min min, user-agent real, comportamento humano-like
//   (waits, scroll). Não fazer scraping demais.
// ═══════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import createLogger from "../../_lib/logger.js";
import { DATA_DIR } from "../../_lib/app-config.js";

const log = createLogger("ml-scraper");

// Defaults e configs
const ML_VENDAS_URL = "https://www.mercadolivre.com.br/vendas/omni/lista";
const DEFAULT_STORAGE_STATE_PATH = path.join(
  DATA_DIR,
  "playwright",
  "ml-seller-center-state.json"
);
const SCRAPER_STORAGE_STATE_PATH =
  process.env.ML_SCRAPER_STORAGE_STATE_PATH || DEFAULT_STORAGE_STATE_PATH;
const SCRAPER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

// Cache em memória do último scrape bem-sucedido
let cachedResult = null; // { data, expiresAt, capturedAt }
let lastError = null; // { error, timestamp }

// Cache em memória do scrape FULL (engenharia reversa via XHR interception)
// Estrutura: { tabs: { [tabKey]: { [storeKey]: { url, xhrJsonResponses: [], domSnapshot } } }, capturedAt, expiresAt }
let cachedFullResult = null;

// ─── Configuracao das combinacoes (tab × store) que serao scraped ───
// Tabs do ML Seller Center (filters URL param)
const ML_TABS = [
  { key: "today", filter: "TAB_TODAY", label: "Envios de hoje" },
  { key: "upcoming", filter: "TAB_NEXT_DAYS", label: "Próximos dias" },
  { key: "in_transit", filter: "TAB_IN_THE_WAY", label: "Em trânsito" },
  { key: "finalized", filter: "TAB_FINISHED", label: "Finalizadas" },
];

// Stores conhecidas (configuravel via env ML_SCRAPER_STORES)
// Default: pega "outros" (sem store param) e "full" (logistic_type fulfillment)
const ML_STORES = (process.env.ML_SCRAPER_STORES || "all,outros,full")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Mapeia store key → URL store param que o ML usa
function storeToUrlParam(store) {
  if (store === "all") return ""; // Todas as vendas
  if (store === "outros") return ""; // Vendas sem deposito (usa mesma URL)
  if (store === "full") return "full";
  return store; // Pode ser ID numerico (ex: 79856028 = Ourinhos)
}

/**
 * Verifica se o storage state está disponível no disco.
 */
export function isScraperConfigured() {
  try {
    return fs.existsSync(SCRAPER_STORAGE_STATE_PATH) &&
      fs.statSync(SCRAPER_STORAGE_STATE_PATH).size > 0;
  } catch {
    return false;
  }
}

export function getScraperStorageStatePath() {
  return SCRAPER_STORAGE_STATE_PATH;
}

export function getLastScraperError() {
  return lastError;
}

export function getCachedScraperResult() {
  if (!cachedResult) return null;
  if (cachedResult.expiresAt <= Date.now()) {
    return { ...cachedResult, stale: true };
  }
  return cachedResult;
}

/**
 * Carrega o storage state do disco. Retorna null se não existe ou inválido.
 */
function loadStorageState() {
  try {
    if (!fs.existsSync(SCRAPER_STORAGE_STATE_PATH)) return null;
    const raw = fs.readFileSync(SCRAPER_STORAGE_STATE_PATH, "utf8");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Sanity check: storage state tem cookies e/ou origins
    if (!parsed || (!parsed.cookies && !parsed.origins)) return null;
    return parsed;
  } catch (err) {
    log.warn("Falha ao ler storage state", err instanceof Error ? err : new Error(String(err)));
    return null;
  }
}

/**
 * Lazy-load do playwright — só importa quando realmente for scraping.
 * Evita carregar playwright na inicialização do servidor quando não é
 * necessário.
 */
async function loadPlaywright() {
  try {
    const mod = await import("playwright");
    return mod.chromium || mod.default?.chromium;
  } catch (err) {
    log.error(
      "playwright não está instalado no ambiente",
      err instanceof Error ? err : new Error(String(err))
    );
    return null;
  }
}

/**
 * Extrai os 4 chips do DOM da página de vendas.
 * Retorna { today, upcoming, in_transit, finalized } ou null se não bater.
 */
async function extractChipsFromPage(page) {
  // Espera pelo container dos chips (seletor genérico)
  try {
    await page.waitForSelector('[role="tablist"], [data-testid*="tab"], nav', {
      timeout: 15000,
    });
  } catch {
    // se não bateu nos seletores comuns, segue e tenta extrair mesmo assim
  }

  // Pequena espera pra garantir hydration
  await page.waitForTimeout(2000);

  // Tenta extrair via texto dos chips — mais robusto que seletor fixo
  const chips = await page.evaluate(() => {
    const labels = ["Envios de hoje", "Próximos dias", "Em trânsito", "Finalizadas"];
    const result = {};

    // Estratégia 1: busca elementos que contenham os labels + número
    const allElements = document.querySelectorAll("button, div, a, span, li");
    for (const label of labels) {
      for (const el of allElements) {
        const text = (el.textContent || "").trim();
        // Procura padrão "Envios de hoje 75" ou "Envios de hoje\n75" etc.
        if (text.startsWith(label) && text.length < label.length + 15) {
          // Extrai número depois do label
          const match = text.match(new RegExp(`${label}[\\s\\n]*(\\d+)`));
          if (match) {
            result[label] = parseInt(match[1], 10);
            break;
          }
        }
      }
    }
    return result;
  });

  // Valida que pelo menos 3 dos 4 chips foram encontrados
  const foundKeys = Object.keys(chips || {});
  if (foundKeys.length < 3) {
    return null;
  }

  return {
    today: Number(chips["Envios de hoje"] || 0),
    upcoming: Number(chips["Próximos dias"] || 0),
    in_transit: Number(chips["Em trânsito"] || 0),
    finalized: Number(chips["Finalizadas"] || 0),
  };
}

/**
 * Executa o scraper completo: abre browser headless, carrega storage state,
 * navega, extrai chips, retorna resultado.
 *
 * Retorna:
 *   { ok: true, counts: {...}, capturedAt: ISO }
 *   { ok: false, error: "no_state"|"playwright_missing"|"session_expired"|"dom_mismatch"|"network" }
 */
export async function scrapeMlSellerCenter({ timeoutMs = 45_000 } = {}) {
  if (!isScraperConfigured()) {
    const err = { error: "no_state", message: "Storage state não configurado. Execute script de setup inicial." };
    lastError = { ...err, timestamp: new Date().toISOString() };
    return { ok: false, ...err };
  }

  const chromium = await loadPlaywright();
  if (!chromium) {
    const err = { error: "playwright_missing", message: "Playwright não instalado no container" };
    lastError = { ...err, timestamp: new Date().toISOString() };
    return { ok: false, ...err };
  }

  const storageState = loadStorageState();
  if (!storageState) {
    const err = { error: "no_state", message: "Storage state inválido" };
    lastError = { ...err, timestamp: new Date().toISOString() };
    return { ok: false, ...err };
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
    });
    const context = await browser.newContext({
      storageState,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
    });
    const page = await context.newPage();

    // Timeout global da operação
    const navPromise = page.goto(ML_VENDAS_URL, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await navPromise;

    // Detecta redirect pra login
    const currentUrl = page.url();
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/auth") ||
      currentUrl.includes("/authorization")
    ) {
      const err = {
        error: "session_expired",
        message: "Session expirada — admin precisa re-login.",
        redirected_to: currentUrl,
      };
      lastError = { ...err, timestamp: new Date().toISOString() };
      log.warn("Scraper redirecionou para login — session expirada");
      return { ok: false, ...err };
    }

    const counts = await extractChipsFromPage(page);
    if (!counts) {
      const err = {
        error: "dom_mismatch",
        message: "Não foi possível extrair os chips do DOM (ML pode ter mudado estrutura)",
      };
      lastError = { ...err, timestamp: new Date().toISOString() };
      return { ok: false, ...err };
    }

    const result = {
      ok: true,
      counts,
      capturedAt: new Date().toISOString(),
    };

    // Atualiza cache
    cachedResult = {
      data: counts,
      capturedAt: result.capturedAt,
      expiresAt: Date.now() + SCRAPER_CACHE_TTL_MS,
    };
    lastError = null;

    return result;
  } catch (err) {
    const errorInfo = {
      error: "network",
      message: err instanceof Error ? err.message : String(err),
    };
    lastError = { ...errorInfo, timestamp: new Date().toISOString() };
    log.error("Scraper falhou", err instanceof Error ? err : new Error(String(err)));
    return { ok: false, ...errorInfo };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // best-effort
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// ENGENHARIA REVERSA — Captura estrutura completa do ML Seller Center
// ═══════════════════════════════════════════════════════════════════
// Em vez de DOM scraping superficial (so chips), navega em cada
// combinacao tab × store e INTERCEPTA as XHRs internas do ML que
// retornam JSON com a estrutura completa de cards + sub-status +
// order_ids. Resultado: classificacao 1:1 com o ML sem chute.
//
// Salvamos TODOS os JSON responses interceptados em
// `xhrJsonResponses` por (tab, store), pra que o operador valide
// no endpoint debug e a gente identifique qual contem os dados certos.

/**
 * Padroes pra IGNORAR (assets, telemetria, third-party). Capturamos
 * QUALQUER outro JSON > 500 bytes — assim nao perdemos nenhum endpoint
 * interno do ML que possa ter os dados de cards/sub-status.
 */
const URL_BLACKLIST_PATTERNS = [
  /google-analytics/,
  /googletagmanager/,
  /facebook\.com/,
  /facebook\.net/,
  /doubleclick/,
  /datadog/,
  /newrelic/,
  /sentry\.io/,
  /\/captcha/,
  /melidata/,
  /\/v3\/melidata/,
  /\/p\.gif/,
  /\.css(\?|$)/,
  /\.js(\?|$)/,
];

function shouldCaptureUrl(url) {
  // So aceita URLs de dominios do ML (mercadolivre.com.br, mercadolibre,
  // mlstatic). Ignora assets externos.
  if (
    !url.includes("mercadolivre") &&
    !url.includes("mercadolibre") &&
    !url.includes("mlstatic")
  ) {
    return false;
  }
  return !URL_BLACKLIST_PATTERNS.some((re) => re.test(url));
}

/**
 * Navega numa URL especifica e captura responses XHR + DOM snapshot.
 * Retorna { url, xhrJsonResponses: [{url, body}], domHtml, domChipsText }.
 *
 * Esta funcao NAO renova browser — recebe page e ja navega.
 */
async function captureTabStore(page, tabFilter, storeUrlParam, timeoutMs) {
  const params = new URLSearchParams();
  if (tabFilter) params.set("filters", tabFilter);
  if (storeUrlParam) params.set("store", storeUrlParam);
  params.set("limit", "50");
  params.set("offset", "0");
  const targetUrl = `${ML_VENDAS_URL}?${params.toString()}`;

  // Buffer de XHRs interceptados nesta navegacao
  const xhrJsonResponses = [];
  let totalSeen = 0;
  let blacklisted = 0;
  let nonJson = 0;
  const responseHandler = async (response) => {
    try {
      totalSeen++;
      const url = response.url();
      if (!shouldCaptureUrl(url)) {
        blacklisted++;
        return;
      }
      const contentType = response.headers()["content-type"] || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        nonJson++;
        return;
      }
      // Limita tamanho pra nao explodir memoria
      const body = await response.text();
      if (!body || body.length > 2 * 1024 * 1024) return; // skip > 2MB
      // Pula JSONs muito pequenos (provavel telemetria/ack)
      if (body.length < 100) return;
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        return;
      }
      // Limita a 60 XHRs por navegacao (mais espaco pra ver tudo)
      if (xhrJsonResponses.length >= 60) return;
      xhrJsonResponses.push({
        url,
        status: response.status(),
        size: body.length,
        body: parsed,
      });
    } catch {
      // best-effort — algumas responses sao streamed e nao da pra ler
    }
  };

  page.on("response", responseHandler);

  let navError = null;
  try {
    // waitUntil "networkidle" espera 500ms sem requests — garante que
    // os XHRs internos do ML (que sao chamados APOS o DOM ready,
    // depois de carregar config dos microfrontends) tenham tempo de
    // serem capturados.
    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: timeoutMs });
    // Wait extra pra capturar XHRs lazy-loaded por interacao
    // (a tela carrega config primeiro, depois os dados das listagens)
    await page.waitForTimeout(5000);
  } catch (err) {
    navError = err instanceof Error ? err.message : String(err);
  } finally {
    page.off("response", responseHandler);
  }

  // Snapshot leve do DOM pra fallback (texto dos chips)
  let domChipsText = null;
  try {
    domChipsText = await page.evaluate(() => {
      const labels = ["Envios de hoje", "Próximos dias", "Em trânsito", "Finalizadas"];
      const result = {};
      const allElements = document.querySelectorAll("button, div, a, span, li");
      for (const label of labels) {
        for (const el of allElements) {
          const text = (el.textContent || "").trim();
          if (text.startsWith(label) && text.length < label.length + 15) {
            const m = text.match(new RegExp(`${label}[\\s\\n]*(\\d+)`));
            if (m) {
              result[label] = parseInt(m[1], 10);
              break;
            }
          }
        }
      }
      return result;
    });
  } catch {
    // ignore
  }

  return {
    url: targetUrl,
    xhrJsonResponses,
    domChipsText,
    navError,
    capture_stats: {
      total_seen: totalSeen,
      blacklisted,
      non_json: nonJson,
      captured: xhrJsonResponses.length,
    },
  };
}

/**
 * Scrape FULL — navega em cada tab × store e captura tudo.
 * Demora ~30-60s pra cobrir 4 tabs × 3 stores = 12 navegacoes.
 *
 * Quando `singleTab` e `singleStore` sao especificados, faz APENAS 1
 * navegacao (~10-15s). Util pra debug rapido sem esperar o full scrape.
 *
 * Retorna:
 *   { ok: true, tabs: { [tabKey]: { [storeKey]: <captura> } }, capturedAt }
 *   { ok: false, error, message }
 */
export async function scrapeMlSellerCenterFull({
  timeoutMs = 30_000,
  singleTab = null,
  singleStore = null,
} = {}) {
  if (!isScraperConfigured()) {
    return { ok: false, error: "no_state", message: "Storage state nao configurado" };
  }

  const chromium = await loadPlaywright();
  if (!chromium) {
    return { ok: false, error: "playwright_missing", message: "Playwright nao instalado" };
  }

  const storageState = loadStorageState();
  if (!storageState) {
    return { ok: false, error: "no_state", message: "Storage state invalido" };
  }

  let browser;
  const captures = {};
  try {
    // Args otimizados pra reduzir RAM (~150MB → ~80MB) — importante em
    // VPS pequena. --single-process roda tudo numa thread (renderer +
    // browser process) evitando overhead. --disable-* corta features
    // que nao usamos no scraping.
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-extensions",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--no-first-run",
        "--no-default-browser-check",
        "--mute-audio",
        "--single-process",
      ],
    });
    // Viewport menor (1280x720 vs 1920x1080) reduz memoria do renderer
    const context = await browser.newContext({
      storageState,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 720 },
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
      // Bloqueia recursos pesados que nao precisamos pro scraping
      // (imagens, fonts, midia). Reduz drasticamente trafego e memoria.
    });
    // Bloqueia recursos pesados via route handler
    await context.route(
      "**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,otf,mp4,webm}",
      (route) => route.abort()
    );
    const page = await context.newPage();

    // Verifica sessao com 1a navegacao
    const probeUrl = ML_VENDAS_URL;
    await page.goto(probeUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const currentUrl = page.url();
    if (
      currentUrl.includes("/login") ||
      currentUrl.includes("/auth") ||
      currentUrl.includes("/authorization")
    ) {
      lastError = {
        error: "session_expired",
        message: "Session expirada — admin precisa re-login",
        timestamp: new Date().toISOString(),
      };
      log.warn("[full-scrape] Session expirada — abortando");
      return { ok: false, error: "session_expired", message: "Session expirada" };
    }

    // Itera tab × store (ou single se especificado)
    const tabsToRun = singleTab
      ? ML_TABS.filter((t) => t.key === singleTab)
      : ML_TABS;
    const storesToRun = singleStore ? [singleStore] : ML_STORES;
    for (const tab of tabsToRun) {
      captures[tab.key] = {};
      for (const store of storesToRun) {
        const storeParam = storeToUrlParam(store);
        log.info(`[full-scrape] capturando ${tab.key} × ${store}`);
        try {
          const capture = await captureTabStore(
            page,
            tab.filter,
            storeParam,
            timeoutMs
          );
          captures[tab.key][store] = {
            url: capture.url,
            store_url_param: storeParam,
            xhr_count: capture.xhrJsonResponses.length,
            xhr_responses: capture.xhrJsonResponses,
            dom_chips_text: capture.domChipsText,
            nav_error: capture.navError,
            capture_stats: capture.capture_stats,
          };
        } catch (err) {
          captures[tab.key][store] = {
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }
    }

    const result = {
      ok: true,
      tabs: captures,
      stores_scraped: ML_STORES,
      capturedAt: new Date().toISOString(),
    };

    cachedFullResult = {
      data: result,
      capturedAt: result.capturedAt,
      expiresAt: Date.now() + SCRAPER_CACHE_TTL_MS,
    };
    lastError = null;

    return result;
  } catch (err) {
    const errorInfo = {
      error: "network",
      message: err instanceof Error ? err.message : String(err),
    };
    lastError = { ...errorInfo, timestamp: new Date().toISOString() };
    log.error("[full-scrape] falhou", err instanceof Error ? err : new Error(String(err)));
    return { ok: false, ...errorInfo };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // best-effort
      }
    }
  }
}

/**
 * Retorna o ultimo scrape FULL bem-sucedido (do cache).
 * Stale = true se passou do TTL.
 */
export function getCachedFullResult() {
  if (!cachedFullResult) return null;
  if (cachedFullResult.expiresAt <= Date.now()) {
    return { ...cachedFullResult, stale: true };
  }
  return cachedFullResult;
}

/**
 * Retorna os chips do cache ou null se vazio/expirado.
 * Não dispara scraping novo — isso é responsabilidade do cron.
 */
export function getUiChipCounts() {
  const cached = getCachedScraperResult();
  if (!cached || cached.stale) return null;
  return {
    today: cached.data.today,
    upcoming: cached.data.upcoming,
    in_transit: cached.data.in_transit,
    finalized: cached.data.finalized,
    captured_at: cached.capturedAt,
  };
}
