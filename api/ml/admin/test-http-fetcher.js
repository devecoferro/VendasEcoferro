// ═══════════════════════════════════════════════════════════════════
// Endpoint de diagnóstico: testa o HTTP fetcher do ML em tempo real
// e retorna detalhes sobre o que está funcionando ou falhando.
//
// GET /api/ml/admin/test-http-fetcher
// GET /api/ml/admin/test-http-fetcher?connection_id=fantom
// ═══════════════════════════════════════════════════════════════════
import { requireAdmin } from "../../_lib/auth-server.js";
import {
  fetchMLChipsViaHTTP,
  isHTTPFetcherConfigured,
  invalidateHTTPChipCache,
} from "../_lib/ml-chip-http-fetcher.js";
import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const ML_BASE = "https://www.mercadolivre.com.br";

export default async function handler(request, response) {
  try {
    await requireAdmin(request);
  } catch (err) {
    return response.status(err.statusCode || 403).json({ error: err.message });
  }

  const url = new URL(request.url, `http://${request.headers.host}`);
  const connectionId = url.searchParams.get("connection_id") || null;

  const diagnostics = {
    timestamp: new Date().toISOString(),
    connectionId: connectionId || "default",
    storageState: {},
    rawFetchTest: {},
    httpFetcher: {},
    result: null,
  };

  // 1. Verificar storage state
  const stateFilename = connectionId
    ? `ml-seller-center-state-${connectionId}.json`
    : "ml-seller-center-state.json";
  const statePath = path.join(DATA_DIR, "playwright", stateFilename);

  diagnostics.storageState.path = statePath;
  diagnostics.storageState.exists = fs.existsSync(statePath);

  let cookieHeader = null;

  if (diagnostics.storageState.exists) {
    try {
      const raw = fs.readFileSync(statePath, "utf8");
      const parsed = JSON.parse(raw);
      diagnostics.storageState.sizeBytes = raw.length;
      diagnostics.storageState.cookieCount = parsed.cookies?.length || 0;
      diagnostics.storageState.originsCount = parsed.origins?.length || 0;

      // Verificar cookies ML
      const mlCookies = (parsed.cookies || []).filter(
        (c) =>
          c.domain?.includes("mercadolivre") ||
          c.domain?.includes("mercadolibre") ||
          c.domain?.includes(".ml.com")
      );
      diagnostics.storageState.mlCookieCount = mlCookies.length;
      diagnostics.storageState.mlCookieNames = mlCookies.map((c) => c.name);

      // Construir cookie header
      cookieHeader = mlCookies
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
      diagnostics.storageState.cookieHeaderLength = cookieHeader.length;
      diagnostics.storageState.cookieHeaderTooLarge = cookieHeader.length > 8000;
    } catch (err) {
      diagnostics.storageState.error = err.message;
    }
  }

  // 2. Raw fetch test — testa DIRETAMENTE os endpoints do ML com os cookies
  if (cookieHeader) {
    const endpoints = [
      {
        name: "operations-dashboard/tabs (default)",
        url: `${ML_BASE}/sales-omni/packs/marketshops/operations-dashboard/tabs?sellerSegmentType=professional&filters=TAB_TODAY&subFilters=&store=all&gmt=-03:00`,
      },
      {
        name: "operations-dashboard/tabs (api)",
        url: `${ML_BASE}/sales-omni/api/packs/marketshops/operations-dashboard/tabs?sellerSegmentType=professional&filters=TAB_TODAY&subFilters=&store=all&gmt=-03:00`,
      },
      {
        name: "vendas/omni/lista/api (event-request style)",
        url: `${ML_BASE}/vendas/omni/lista/api/channels/event-request`,
      },
    ];

    diagnostics.rawFetchTest.endpoints = [];

    for (const ep of endpoints) {
      const testResult = { name: ep.name, url: ep.url };
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(ep.url, {
          method: "GET",
          headers: {
            Accept: "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest",
            "x-scope": "tabs-mlb",
            Cookie: cookieHeader,
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Referer: `${ML_BASE}/vendas/omni/lista`,
            "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          },
          redirect: "manual",
          signal: controller.signal,
        });
        clearTimeout(timeout);

        testResult.status = res.status;
        testResult.statusText = res.statusText;
        testResult.headers = Object.fromEntries(
          [...res.headers.entries()].filter(([k]) =>
            ["content-type", "location", "set-cookie", "x-request-id"].includes(k.toLowerCase())
          )
        );

        // Ler body (limitado a 2000 chars)
        const text = await res.text();
        testResult.bodyLength = text.length;
        testResult.bodyPreview = text.slice(0, 2000);

        // Tentar parsear como JSON
        try {
          const json = JSON.parse(text);
          testResult.isJson = true;
          // Verificar se tem o brick segmented_actions_marketshops
          const hasSegmented = text.includes("segmented_actions_marketshops");
          testResult.hasSegmentedActions = hasSegmented;
        } catch {
          testResult.isJson = false;
        }
      } catch (err) {
        testResult.error = err instanceof Error ? err.message : String(err);
      }
      diagnostics.rawFetchTest.endpoints.push(testResult);
    }
  }

  // 3. Verificar se o HTTP fetcher está configurado
  diagnostics.httpFetcher.configured = isHTTPFetcherConfigured(connectionId);

  // 4. Executar o HTTP fetcher (invalidar cache primeiro)
  invalidateHTTPChipCache(connectionId);

  try {
    const startTime = Date.now();
    const result = await fetchMLChipsViaHTTP(connectionId);
    const elapsed = Date.now() - startTime;

    diagnostics.httpFetcher.elapsedMs = elapsed;
    diagnostics.httpFetcher.success = result !== null;
    diagnostics.result = result;
  } catch (err) {
    diagnostics.httpFetcher.error = err.message || String(err);
    diagnostics.httpFetcher.success = false;
  }

  response.setHeader("Content-Type", "application/json");
  return response.status(200).json(diagnostics);
}
