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
