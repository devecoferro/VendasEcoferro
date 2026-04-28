import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMLLiveSnapshot,
  type MLLiveSnapshotResponse,
  type MLSnapshotScope,
} from "@/services/mlLiveSnapshotService";

// Cache POR ESCOPO em memória compartilhado entre múltiplos mounts
// (HMR, StrictMode). TTL pequeno — o backend já tem cache 2min, mas
// aqui evitamos múltiplas chamadas no mesmo instante.
const FRONTEND_CACHE_TTL_MS = 15_000; // 15s

// Brief 2026-04-28 multi-seller: cache scoped por (scope, connectionId)
// pra evitar cross-contaminacao quando 2 paginas (EcoFerro/Fantom) usam
// hooks distintos.
const sharedSnapshotByKey = new Map<
  string,
  { expiresAt: number; data: MLLiveSnapshotResponse }
>();
const inflightPromiseByKey = new Map<
  string,
  Promise<MLLiveSnapshotResponse>
>();

function buildSnapshotKey(scope: MLSnapshotScope, connectionId: string | null): string {
  return `${scope}::${connectionId || "default"}`;
}

async function fetchAndCache(
  scope: MLSnapshotScope,
  force: boolean,
  connectionId: string | null
): Promise<MLLiveSnapshotResponse> {
  const key = buildSnapshotKey(scope, connectionId);
  if (force) {
    sharedSnapshotByKey.delete(key);
  }
  const cached = sharedSnapshotByKey.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  const inflight = inflightPromiseByKey.get(key);
  if (inflight && !force) {
    return inflight;
  }
  const promise = getMLLiveSnapshot({ force, scope, connectionId }).then((data) => {
    sharedSnapshotByKey.set(key, {
      expiresAt: Date.now() + FRONTEND_CACHE_TTL_MS,
      data,
    });
    inflightPromiseByKey.delete(key);
    return data;
  });
  inflightPromiseByKey.set(key, promise);
  return promise;
}

export interface UseMLLiveSnapshotOptions {
  /** Auto-fetch on mount. Default true. */
  enabled?: boolean;
  /** Polling interval em ms. 0 = desliga polling. Default 0 (sem polling). */
  pollingIntervalMs?: number;
  /** Escopo do snapshot. Default "all" (agregado global). */
  scope?: MLSnapshotScope;
  /** Brief 2026-04-28 multi-seller: connection_id pra escolher storage state */
  connectionId?: string | null;
}

export interface UseMLLiveSnapshotReturn {
  snapshot: MLLiveSnapshotResponse | null;
  loading: boolean;
  initialLoading: boolean;
  error: string | null;
  refresh: (options?: { force?: boolean }) => Promise<void>;
  scope: MLSnapshotScope;
}

/**
 * Hook pra consumir /api/ml/live-snapshot POR ESCOPO. Cache separado
 * por escopo — trocar de scope limpa o snapshot local e busca o novo.
 */
export function useMLLiveSnapshot(
  options: UseMLLiveSnapshotOptions = {}
): UseMLLiveSnapshotReturn {
  const { enabled = true, pollingIntervalMs = 0, scope = "all", connectionId = null } = options;
  const cacheKey = buildSnapshotKey(scope, connectionId);

  const [snapshot, setSnapshot] = useState<MLLiveSnapshotResponse | null>(
    () => sharedSnapshotByKey.get(cacheKey)?.data ?? null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const initialLoadedRef = useRef(sharedSnapshotByKey.has(cacheKey));

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
        const data = await fetchAndCache(scope, force, connectionId);
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
    [scope, connectionId]
  );

  // Quando o escopo OU connectionId muda, atualiza snapshot pro cache novo
  // (se existir) e dispara fetch.
  useEffect(() => {
    if (!enabled) return;
    const cachedNew = sharedSnapshotByKey.get(cacheKey);
    setSnapshot(cachedNew?.data ?? null);
    initialLoadedRef.current = !!cachedNew;
    load(false);
  }, [enabled, cacheKey, load]);

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
    scope,
  };
}
