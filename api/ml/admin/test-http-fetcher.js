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

  if (diagnostics.storageState.exists) {
    try {
      const raw = fs.readFileSync(statePath, "utf8");
      const parsed = JSON.parse(raw);
      diagnostics.storageState.sizeBytes = raw.length;
      diagnostics.storageState.cookieCount = parsed.cookies?.length || 0;
      diagnostics.storageState.originsCount = parsed.origins?.length || 0;

      // Listar nomes dos cookies (sem valores por segurança)
      const cookieNames = (parsed.cookies || []).map((c) => ({
        name: c.name,
        domain: c.domain,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
      }));
      diagnostics.storageState.cookies = cookieNames;

      // Verificar cookies ML
      const mlCookies = (parsed.cookies || []).filter(
        (c) =>
          c.domain?.includes("mercadolivre") ||
          c.domain?.includes("mercadolibre") ||
          c.domain?.includes(".ml.com")
      );
      diagnostics.storageState.mlCookieCount = mlCookies.length;
      diagnostics.storageState.mlCookieNames = mlCookies.map((c) => c.name);

      // Calcular tamanho do cookie header
      const cookieHeader = mlCookies
        .map((c) => `${c.name}=${c.value}`)
        .join("; ");
      diagnostics.storageState.cookieHeaderLength = cookieHeader.length;
      diagnostics.storageState.cookieHeaderTooLarge = cookieHeader.length > 8000;
    } catch (err) {
      diagnostics.storageState.error = err.message;
    }
  }

  // 2. Verificar se o HTTP fetcher está configurado
  diagnostics.httpFetcher.configured = isHTTPFetcherConfigured(connectionId);

  // 3. Executar o HTTP fetcher (invalidar cache primeiro)
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
