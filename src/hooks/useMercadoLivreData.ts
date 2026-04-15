import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getMLConnectionStatus,
  getMLDashboard,
  getMLOrdersPage,
  syncMLOrders,
  type MLConnection,
  type MLDashboardResponse,
  type MLOrder,
  type MLOrdersPagination,
} from "@/services/mercadoLivreService";

interface UseMercadoLivreDataOptions {
  autoSync?: boolean;
  autoSyncIntervalMs?: number;
  ordersScope?: "all" | "operational";
  ordersLimit?: number | null;
  ordersView?: "full" | "dashboard";
  autoLoadAllPages?: boolean;
}

interface SyncOptions {
  silent?: boolean;
  forceFullSync?: boolean;
}

interface RefreshOptions {
  background?: boolean;
  // `silent` é um alias semântico para `background`: não exibir spinner,
  // não piscar UI, e não propagar erros de rede para o usuario. Útil para
  // recargas disparadas por eventos SSE ou polling em background.
  silent?: boolean;
}

interface LoadMoreOptions {
  background?: boolean;
}

export interface MercadoLivreOrdersPaginationState extends MLOrdersPagination {
  loading_more: boolean;
  fully_loaded: boolean;
}

interface MercadoLivreDataState {
  connection: MLConnection | null;
  orders: MLOrder[];
  ordersPagination: MercadoLivreOrdersPaginationState;
  dashboard: MLDashboardResponse | null;
  loading: boolean;
  error: string | null;
  refresh: (options?: RefreshOptions) => Promise<void>;
  syncNow: (options?: SyncOptions) => Promise<void>;
  loadMoreOrders: (options?: LoadMoreOptions) => Promise<void>;
}

const DEFAULT_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
const DATA_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
const DEFAULT_PAGE_SIZE = 300;

const mercadoLivreDataCache = new Map<
  string,
  {
    expiresAt: number;
    connection: MLConnection | null;
    orders: MLOrder[];
    ordersPagination: MercadoLivreOrdersPaginationState;
    dashboard: MLDashboardResponse | null;
  }
>();

function buildMercadoLivreCacheKey(options: UseMercadoLivreDataOptions): string {
  return `${options.ordersScope || "all"}:${options.ordersView || "full"}:${options.ordersLimit == null ? "all" : options.ordersLimit}`;
}

function readMercadoLivreCache(cacheKey: string) {
  const cached = mercadoLivreDataCache.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    mercadoLivreDataCache.delete(cacheKey);
    return null;
  }

  return cached;
}

function writeMercadoLivreCache(
  cacheKey: string,
  payload: {
    connection: MLConnection | null;
    orders: MLOrder[];
    ordersPagination: MercadoLivreOrdersPaginationState;
    dashboard: MLDashboardResponse | null;
  }
) {
  mercadoLivreDataCache.set(cacheKey, {
    ...payload,
    expiresAt: Date.now() + DATA_CACHE_TTL_MS,
  });
}

function getMercadoLivreLoadErrorMessage(error: unknown): string {
  const rawMessage =
    error instanceof Error && error.message
      ? error.message
      : "Falha ao carregar os dados do Mercado Livre.";

  return rawMessage;
}

function buildFallbackConnection(
  dashboard: MLDashboardResponse | null,
  orders: MLOrder[]
): MLConnection | null {
  const hasOperationalData = orders.length > 0 || Boolean(dashboard?.deposits?.length);
  if (!hasOperationalData) {
    return null;
  }

  return {
    id: "",
    seller_id: "",
    seller_nickname: "ECOFERRO",
    last_sync_at: dashboard?.generated_at || null,
    token_expires_at: "",
    created_at: dashboard?.generated_at || new Date().toISOString(),
  };
}

function buildEmptyPagination(limit: number): MercadoLivreOrdersPaginationState {
  return {
    offset: 0,
    limit,
    total: 0,
    loaded: 0,
    has_more: false,
    next_offset: null,
    loading_more: false,
    fully_loaded: true,
  };
}

function normalizePagination(
  pagination: Partial<MLOrdersPagination> | null | undefined,
  fallbackLimit: number,
  loadedOrders: number,
  loadingMore = false
): MercadoLivreOrdersPaginationState {
  const offset =
    typeof pagination?.offset === "number" && Number.isFinite(pagination.offset)
      ? pagination.offset
      : 0;
  const limit =
    typeof pagination?.limit === "number" && Number.isFinite(pagination.limit)
      ? pagination.limit
      : fallbackLimit;
  const total =
    typeof pagination?.total === "number" && Number.isFinite(pagination.total)
      ? pagination.total
      : loadedOrders;
  const loaded =
    typeof pagination?.loaded === "number" && Number.isFinite(pagination.loaded)
      ? pagination.loaded
      : loadedOrders;
  const nextOffset =
    typeof pagination?.next_offset === "number" && Number.isFinite(pagination.next_offset)
      ? pagination.next_offset
      : null;
  const hasMore = Boolean(pagination?.has_more) && nextOffset != null;

  return {
    offset,
    limit,
    total,
    loaded,
    has_more: hasMore,
    next_offset: hasMore ? nextOffset : null,
    loading_more: loadingMore,
    fully_loaded: !hasMore && loaded >= total,
  };
}

function appendUniqueOrders(currentOrders: MLOrder[], nextOrders: MLOrder[]): MLOrder[] {
  if (currentOrders.length === 0) {
    return nextOrders;
  }

  const existingIds = new Set(currentOrders.map((order) => order.id));
  const mergedOrders = [...currentOrders];

  for (const order of nextOrders) {
    if (!existingIds.has(order.id)) {
      existingIds.add(order.id);
      mergedOrders.push(order);
    }
  }

  return mergedOrders;
}

export function useMercadoLivreData(
  options: UseMercadoLivreDataOptions = {}
): MercadoLivreDataState {
  const {
    autoSync = false,
    autoSyncIntervalMs = DEFAULT_AUTO_SYNC_INTERVAL_MS,
    ordersScope = "all",
    ordersLimit = null,
    ordersView = "full",
    autoLoadAllPages = false,
  } = options;
  const shouldPaginateOrders =
    typeof ordersLimit === "number" && Number.isFinite(ordersLimit) && ordersLimit > 0;
  const normalizedPageSize = shouldPaginateOrders ? Math.trunc(ordersLimit) : DEFAULT_PAGE_SIZE;
  const cacheKey = useMemo(
    () =>
      buildMercadoLivreCacheKey({
        ordersScope,
        ordersLimit: shouldPaginateOrders ? normalizedPageSize : null,
        ordersView,
      }),
    [normalizedPageSize, ordersScope, ordersView, shouldPaginateOrders]
  );
  const initialCache = useMemo(() => readMercadoLivreCache(cacheKey), [cacheKey]);

  const [connection, setConnection] = useState<MLConnection | null>(initialCache?.connection ?? null);
  const [orders, setOrders] = useState<MLOrder[]>(initialCache?.orders ?? []);
  const [ordersPagination, setOrdersPagination] = useState<MercadoLivreOrdersPaginationState>(
    initialCache?.ordersPagination ?? buildEmptyPagination(normalizedPageSize)
  );
  const [dashboard, setDashboard] = useState<MLDashboardResponse | null>(initialCache?.dashboard ?? null);
  const [loading, setLoading] = useState(!initialCache);
  const [error, setError] = useState<string | null>(null);

  const connectionRef = useRef<MLConnection | null>(null);
  const ordersRef = useRef<MLOrder[]>([]);
  const ordersPaginationRef = useRef<MercadoLivreOrdersPaginationState>(
    initialCache?.ordersPagination ?? buildEmptyPagination(normalizedPageSize)
  );
  const dashboardRef = useRef<MLDashboardResponse | null>(null);
  const syncInFlightRef = useRef(false);
  const loadMoreInFlightRef = useRef(false);
  const bootstrappedConnectionRef = useRef<string | null>(null);
  const requestVersionRef = useRef(0);

  const persistCacheSnapshot = useCallback(
    (
      nextConnection: MLConnection | null,
      nextOrders: MLOrder[],
      nextPagination: MercadoLivreOrdersPaginationState,
      nextDashboard: MLDashboardResponse | null
    ) => {
      writeMercadoLivreCache(cacheKey, {
        connection: nextConnection,
        orders: nextOrders,
        ordersPagination: nextPagination,
        dashboard: nextDashboard,
      });
    },
    [cacheKey]
  );

  const refresh = useCallback(
    async (options: RefreshOptions = {}) => {
      const { background = false, silent = false } = options;
      const isSilent = background || silent;
      const hasFreshCache = Boolean(readMercadoLivreCache(cacheKey));
      const hasRenderableData =
        ordersRef.current.length > 0 || Boolean(dashboardRef.current?.deposits?.length);
      const requestVersion = requestVersionRef.current + 1;
      requestVersionRef.current = requestVersion;
      loadMoreInFlightRef.current = false;

      if (!isSilent && !hasFreshCache && !hasRenderableData) {
        setLoading(true);
      }

      if (!isSilent) {
        setError(null);
      }
      setOrdersPagination((current) => ({
        ...current,
        loading_more: false,
      }));

      try {
        const [ordersResult, dashboardResult, connectionResult] = await Promise.allSettled([
          getMLOrdersPage({
            scope: ordersScope,
            limit: shouldPaginateOrders ? normalizedPageSize : undefined,
            offset: 0,
            view: ordersView,
          }),
          getMLDashboard(),
          getMLConnectionStatus(),
        ]);

        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        const importedOrders =
          ordersResult.status === "fulfilled" ? ordersResult.value.orders : ordersRef.current;
        const importedPagination =
          ordersResult.status === "fulfilled"
            ? normalizePagination(
                ordersResult.value.pagination,
                shouldPaginateOrders ? normalizedPageSize : ordersResult.value.orders.length,
                ordersResult.value.orders.length
              )
            : ordersPaginationRef.current;
        const dashboardResponse =
          dashboardResult.status === "fulfilled" ? dashboardResult.value : dashboardRef.current;
        const fallbackConnection =
          buildFallbackConnection(dashboardResponse, importedOrders) ?? connectionRef.current;
        const currentConnection =
          connectionResult.status === "fulfilled"
            ? connectionResult.value
            : fallbackConnection;
        const connectionError =
          connectionResult.status === "rejected" ? connectionResult.reason : null;
        const ordersError = ordersResult.status === "rejected" ? ordersResult.reason : null;
        const dashboardError =
          dashboardResult.status === "rejected" ? dashboardResult.reason : null;

        setConnection(currentConnection);
        setOrders(importedOrders);
        setOrdersPagination(importedPagination);
        setDashboard(dashboardResponse);
        persistCacheSnapshot(
          currentConnection,
          importedOrders,
          importedPagination,
          dashboardResponse
        );

        const failures = [ordersResult, dashboardResult].filter(
          (result): result is PromiseRejectedResult => result.status === "rejected"
        );
        const hasRenderableOperationalData =
          importedOrders.length > 0 ||
          Boolean(dashboardResponse?.deposits?.length) ||
          ordersRef.current.length > 0 ||
          Boolean(dashboardRef.current?.deposits?.length);

        if (failures.length > 0 && !hasRenderableOperationalData) {
          throw failures[0].reason;
        }

        if (!currentConnection && connectionError && !hasRenderableOperationalData) {
          throw connectionError;
        }

        if (ordersError && importedOrders.length === 0 && dashboardResponse?.deposits?.length) {
          if (!isSilent) {
            setError(getMercadoLivreLoadErrorMessage(ordersError));
          }
          return;
        }

        if (dashboardError && !dashboardResponse?.deposits?.length && importedOrders.length > 0) {
          if (!isSilent) {
            setError(getMercadoLivreLoadErrorMessage(dashboardError));
          }
          return;
        }

        setError(null);
      } catch (caughtError) {
        if (!isSilent) {
          console.error("Failed to load Mercado Livre data:", caughtError);
          setError(getMercadoLivreLoadErrorMessage(caughtError));
        }
      } finally {
        if (!isSilent) {
          setLoading(false);
        }
      }
    },
    [cacheKey, normalizedPageSize, ordersScope, ordersView, persistCacheSnapshot, shouldPaginateOrders]
  );

  const loadMoreOrders = useCallback(
    async (options: LoadMoreOptions = {}) => {
      const { background = false } = options;
      const currentPagination = ordersPaginationRef.current;

      if (
        !shouldPaginateOrders ||
        loadMoreInFlightRef.current ||
        !currentPagination.has_more ||
        currentPagination.next_offset == null
      ) {
        return;
      }

      loadMoreInFlightRef.current = true;
      const requestVersion = requestVersionRef.current;
      setOrdersPagination((current) => ({
        ...current,
        loading_more: true,
      }));

      try {
        const nextPage = await getMLOrdersPage({
          scope: ordersScope,
          limit: shouldPaginateOrders ? normalizedPageSize : undefined,
          offset: currentPagination.next_offset,
          view: ordersView,
        });

        if (requestVersionRef.current !== requestVersion) {
          return;
        }

        const nextOrders = appendUniqueOrders(ordersRef.current, nextPage.orders);
        const nextPagination = normalizePagination(
          nextPage.pagination,
          normalizedPageSize,
          nextPage.orders.length,
          false
        );

        setOrders(nextOrders);
        setOrdersPagination(nextPagination);
        persistCacheSnapshot(
          connectionRef.current,
          nextOrders,
          nextPagination,
          dashboardRef.current
        );
      } catch (caughtError) {
        if (!background) {
          setError(getMercadoLivreLoadErrorMessage(caughtError));
        }
      } finally {
        loadMoreInFlightRef.current = false;
        if (requestVersionRef.current === requestVersion) {
          setOrdersPagination((current) => ({
            ...current,
            loading_more: false,
            fully_loaded: !current.has_more && current.loaded >= current.total,
          }));
        }
      }
    },
    [normalizedPageSize, ordersScope, ordersView, persistCacheSnapshot, shouldPaginateOrders]
  );

  const syncNow = useCallback(
    async (syncOptions: SyncOptions = {}) => {
      const { silent = false, forceFullSync = false } = syncOptions;
      const activeConnection = connectionRef.current;
      if (!activeConnection || syncInFlightRef.current) return;

      syncInFlightRef.current = true;

      try {
        const syncResult = await syncMLOrders(activeConnection.id, {
          updated_from:
            forceFullSync || !activeConnection.last_sync_at
              ? undefined
              : activeConnection.last_sync_at,
        });

        const refreshedConnection =
          syncResult.connection_last_sync_at != null
            ? {
                ...activeConnection,
                last_sync_at: syncResult.connection_last_sync_at,
              }
            : activeConnection;

        if (refreshedConnection !== activeConnection) {
          setConnection(refreshedConnection);
          persistCacheSnapshot(
            refreshedConnection,
            ordersRef.current,
            ordersPaginationRef.current,
            dashboardRef.current
          );
        }

        setError(null);
        const shouldRefresh =
          forceFullSync ||
          ordersRef.current.length === 0 ||
          (syncResult?.synced ?? 0) > 0;

        if (shouldRefresh) {
          await refresh({ background: true });
        }
      } catch (caughtError) {
        if (!silent) {
          console.error("Mercado Livre sync failed:", caughtError);
          setError(
            caughtError instanceof Error
              ? caughtError.message
              : "Falha ao sincronizar os pedidos do Mercado Livre."
          );
        }
      } finally {
        syncInFlightRef.current = false;
      }
    },
    [refresh]
  );

  useEffect(() => {
    const cached = readMercadoLivreCache(cacheKey);

    if (cached) {
      setConnection(cached.connection);
      setOrders(cached.orders);
      setOrdersPagination(cached.ordersPagination);
      setDashboard(cached.dashboard);
      setError(null);
      setLoading(false);
      void refresh({ background: true });
      return;
    }

    void refresh();
  }, [cacheKey, refresh]);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  useEffect(() => {
    ordersPaginationRef.current = ordersPagination;
  }, [ordersPagination]);

  useEffect(() => {
    dashboardRef.current = dashboard;
  }, [dashboard]);

  useEffect(() => {
    if (
      !autoLoadAllPages ||
      !shouldPaginateOrders ||
      loading ||
      ordersPagination.loading_more ||
      !ordersPagination.has_more
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }

      void loadMoreOrders({ background: true });
    }, 50);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    autoLoadAllPages,
    loadMoreOrders,
    loading,
    ordersPagination.has_more,
    ordersPagination.loading_more,
    shouldPaginateOrders,
  ]);

  // SSE: escuta eventos de sync_complete do backend para atualizar em tempo real.
  // Muito mais leve que polling — só recarrega quando há dados novos.
  useEffect(() => {
    if (!autoSync || !connection?.id) {
      bootstrappedConnectionRef.current = null;
      return;
    }

    if (bootstrappedConnectionRef.current !== connection.id) {
      bootstrappedConnectionRef.current = connection.id;
      const hasOperationalData =
        orders.length > 0 ||
        Boolean(dashboard?.deposits?.length) ||
        ordersRef.current.length > 0 ||
        Boolean(dashboardRef.current?.deposits?.length);

      if (!hasOperationalData) {
        void syncNow({
          silent: true,
          forceFullSync: true,
        });
      }
    }

    // Tenta usar SSE para atualizações em tempo real
    let eventSource: EventSource | null = null;
    let sseConnected = false;
    let fallbackIntervalId: ReturnType<typeof setInterval> | null = null;

    try {
      eventSource = new EventSource("/api/ml/sync-events");

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "sync_complete") {
            sseConnected = true;
            // Sync terminou no backend — recarrega dados silenciosamente
            if (typeof document === "undefined" || !document.hidden) {
              void refresh({ silent: true });
            }
          } else if (data.type === "connected") {
            sseConnected = true;
          }
        } catch {
          // Ignora erros de parse
        }
      };

      eventSource.onerror = () => {
        // SSE falhou — ativa fallback de polling silencioso.
        // Usamos refresh() em vez de syncNow() para só revalidar os dados
        // locais (auto-heal do backend já mantém a base fresca), evitando
        // chamar a API do ML a cada tick.
        if (!sseConnected && !fallbackIntervalId) {
          fallbackIntervalId = setInterval(() => {
            if (typeof document === "undefined" || document.hidden) return;
            void refresh({ silent: true });
          }, autoSyncIntervalMs);
        }
      };
    } catch {
      // SSE não disponível — usa polling como fallback
      fallbackIntervalId = setInterval(() => {
        if (typeof document === "undefined" || document.hidden) return;
        void refresh({ silent: true });
      }, autoSyncIntervalMs);
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
      if (fallbackIntervalId) {
        clearInterval(fallbackIntervalId);
      }
    };
  }, [autoSync, autoSyncIntervalMs, connection?.id, dashboard?.deposits?.length, orders.length, syncNow, refresh]);

  return {
    connection,
    orders,
    ordersPagination,
    dashboard,
    loading,
    error,
    refresh,
    syncNow,
    loadMoreOrders,
  };
}
