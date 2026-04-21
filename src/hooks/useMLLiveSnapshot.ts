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

const sharedSnapshotByScope = new Map<
  MLSnapshotScope,
  { expiresAt: number; data: MLLiveSnapshotResponse }
>();
const inflightPromiseByScope = new Map<
  MLSnapshotScope,
  Promise<MLLiveSnapshotResponse>
>();

async function fetchAndCache(
  scope: MLSnapshotScope,
  force: boolean
): Promise<MLLiveSnapshotResponse> {
  if (force) {
    sharedSnapshotByScope.delete(scope);
  }
  const cached = sharedSnapshotByScope.get(scope);
  if (!force && cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  // Dedup: se já tem uma chamada em andamento, reusa.
  const inflight = inflightPromiseByScope.get(scope);
  if (inflight && !force) {
    return inflight;
  }
  const promise = getMLLiveSnapshot({ force, scope }).then((data) => {
    sharedSnapshotByScope.set(scope, {
      expiresAt: Date.now() + FRONTEND_CACHE_TTL_MS,
      data,
    });
    inflightPromiseByScope.delete(scope);
    return data;
  });
  inflightPromiseByScope.set(scope, promise);
  return promise;
}

export interface UseMLLiveSnapshotOptions {
  /** Auto-fetch on mount. Default true. */
  enabled?: boolean;
  /** Polling interval em ms. 0 = desliga polling. Default 0 (sem polling). */
  pollingIntervalMs?: number;
  /** Escopo do snapshot. Default "all" (agregado global). */
  scope?: MLSnapshotScope;
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
  const { enabled = true, pollingIntervalMs = 0, scope = "all" } = options;

  const [snapshot, setSnapshot] = useState<MLLiveSnapshotResponse | null>(
    () => sharedSnapshotByScope.get(scope)?.data ?? null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const initialLoadedRef = useRef(sharedSnapshotByScope.has(scope));

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
        const data = await fetchAndCache(scope, force);
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
    [scope]
  );

  // Quando o escopo muda, atualiza snapshot pro cache novo (se existir) e
  // dispara fetch.
  useEffect(() => {
    if (!enabled) return;
    // Reset snapshot ao trocar escopo pra evitar mostrar dados do escopo
    // anterior enquanto carrega novo.
    const cachedNew = sharedSnapshotByScope.get(scope);
    setSnapshot(cachedNew?.data ?? null);
    initialLoadedRef.current = !!cachedNew;
    load(false);
  }, [enabled, scope, load]);

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
