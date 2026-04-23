// Log de erros do frontend pra /api/error-log.
// Substitui `catch {}` silenciosos por registro estruturado.
//
// Uso:
//   logError("pdf-export", err, { orderId: "123" });
//   logError({ source: "ml-snapshot", level: "warn", message: "no cache" });

export type ErrorLogLevel = "error" | "warn" | "info";

export interface ErrorLogPayload {
  source: string;
  level?: ErrorLogLevel;
  message: string;
  stack?: string;
  url?: string;
  meta?: Record<string, unknown>;
}

// Dedupe: mesma msg+source em <5s conta 1x só. Evita flood se um loop
// ficar gritando erro repetido.
const recentDedupe = new Map<string, number>();
const DEDUPE_WINDOW_MS = 5000;

function shouldSend(key: string): boolean {
  const now = Date.now();
  const last = recentDedupe.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return false;
  recentDedupe.set(key, now);
  // Cleanup entries antigas quando mapa crescer
  if (recentDedupe.size > 100) {
    const cutoff = now - DEDUPE_WINDOW_MS;
    for (const [k, t] of recentDedupe) {
      if (t < cutoff) recentDedupe.delete(k);
    }
  }
  return true;
}

/**
 * Envia erro estruturado pro backend. Best-effort — se falhar o fetch,
 * silencia (nao queremos loops de erro).
 */
export async function logError(
  sourceOrPayload: string | ErrorLogPayload,
  error?: unknown,
  meta?: Record<string, unknown>
): Promise<void> {
  let payload: ErrorLogPayload;
  if (typeof sourceOrPayload === "string") {
    const err = error as Error | string | null;
    payload = {
      source: sourceOrPayload,
      level: "error",
      message: err instanceof Error ? err.message : String(err || "(sem mensagem)"),
      stack: err instanceof Error ? err.stack : undefined,
      url: typeof window !== "undefined" ? window.location.href : undefined,
      meta,
    };
  } else {
    payload = {
      level: "error",
      url: typeof window !== "undefined" ? window.location.href : undefined,
      ...sourceOrPayload,
    };
  }

  const dedupKey = `${payload.source}:${payload.level}:${payload.message}`.slice(0, 256);
  if (!shouldSend(dedupKey)) return;

  try {
    await fetch("/api/error-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
      // Não bloqueia — se falhar, silencia.
      keepalive: true,
    });
  } catch {
    // Silencia — endpoint offline não deve quebrar o app.
  }
}

