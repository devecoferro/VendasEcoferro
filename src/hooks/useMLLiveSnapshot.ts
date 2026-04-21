import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMLLiveSnapshot,
  type MLLiveSnapshotResponse,
} from "@/services/mlLiveSnapshotService";

// Cache em memória compartilhado entre múltiplos mounts (HMR, StrictMode).
// TTL pequeno — o backend já tem cache 5min, mas aqui evitamos múltiplas
// chamadas no mesmo instante (durante render de vários componentes).
// Cache do frontend é menor que o polling (30s) pra garantir que toda
// tick do polling realmente busca dados do servidor. O backend faz o
// rate-limiting/single-flight do scrape, então chamadas excedentes só
// retornam do cache do backend (instantâneo, sem custo).
const FRONTEND_CACHE_TTL_MS = 15_000; // 15s

let sharedSnapshot: {
  expiresAt: number;
  data: MLLiveSnapshotResponse;
} | null = null;

let inflightPromise: Promise<MLLiveSnapshotResponse> | null = null;

async function fetchAndCache(force: boolean): Promise<MLLiveSnapshotResponse> {
  if (force) {
    sharedSnapshot = null;
  }
  if (!force && sharedSnapshot && sharedSnapshot.expiresAt > Date.now()) {
    return sharedSnapshot.data;
  }
  // Deduplicação: se já tem uma chamada em andamento, reusa.
  if (inflightPromise && !force) {
    return inflightPromise;
  }
  const promise = getMLLiveSnapshot({ force }).then((data) => {
    sharedSnapshot = {
      expiresAt: Date.now() + FRONTEND_CACHE_TTL_MS,
      data,
    };
    inflightPromise = null;
    return data;
  });
  inflightPromise = promise;
  return promise;
}

export interface UseMLLiveSnapshotOptions {
  /** Auto-fetch on mount. Default true. */
  enabled?: boolean;
  /** Polling interval em ms. 0 = desliga polling. Default 0 (sem polling). */
  pollingIntervalMs?: number;
}

export interface UseMLLiveSnapshotReturn {
  snapshot: MLLiveSnapshotResponse | null;
  loading: boolean;
  /** `true` apenas durante o fetch inicial (antes de ter qualquer dado). */
  initialLoading: boolean;
  error: string | null;
  /** Re-busca do cache ou do servidor. `force: true` dispara scrape novo. */
  refresh: (options?: { force?: boolean }) => Promise<void>;
}

/**
 * Hook pra consumir /api/ml/live-snapshot com cache em memória e
 * deduplicação. Use em qualquer componente que precise dos dados
 * live do ML (banner counters, sub-cards, lista de pedidos por tab).
 */
export function useMLLiveSnapshot(
  options: UseMLLiveSnapshotOptions = {}
): UseMLLiveSnapshotReturn {
  const { enabled = true, pollingIntervalMs = 0 } = options;

  const [snapshot, setSnapshot] = useState<MLLiveSnapshotResponse | null>(
    () => sharedSnapshot?.data ?? null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const initialLoadedRef = useRef(sharedSnapshot !== null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (force = false) => {
      if (!mountedRef.current) return;
      setLoading(true);
      setError(null);
      try {
        const data = await fetchAndCache(force);
        if (!mountedRef.current) return;
        setSnapshot(data);
        initialLoadedRef.current = true;
      } catch (err) {
        if (!mountedRef.current) return;
        const message =
          err instanceof Error ? err.message : "Erro desconhecido";
        setError(message);
      } finally {
        if (mountedRef.current) {
          setLoading(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (!enabled) return;
    load(false);
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled || pollingIntervalMs <= 0) return;
    const id = window.setInterval(() => {
      load(false);
    }, pollingIntervalMs);
    return () => window.clearInterval(id);
  }, [enabled, pollingIntervalMs, load]);

  const refresh = useCallback(
    async (opts: { force?: boolean } = {}) => {
      await load(Boolean(opts.force));
    },
    [load]
  );

  return {
    snapshot,
    loading,
    initialLoading: loading && !initialLoadedRef.current,
    error,
    refresh,
  };
}
