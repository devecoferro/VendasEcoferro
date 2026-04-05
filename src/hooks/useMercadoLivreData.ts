import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMLConnectionStatus,
  getMLDashboard,
  getMLOrders,
  syncMLOrders,
  type MLConnection,
  type MLDashboardResponse,
  type MLOrder,
} from "@/services/mercadoLivreService";

interface UseMercadoLivreDataOptions {
  autoSync?: boolean;
  autoSyncIntervalMs?: number;
}

interface SyncOptions {
  silent?: boolean;
  forceFullSync?: boolean;
}

interface RefreshOptions {
  background?: boolean;
}

interface MercadoLivreDataState {
  connection: MLConnection | null;
  orders: MLOrder[];
  dashboard: MLDashboardResponse | null;
  loading: boolean;
  error: string | null;
  refresh: (options?: RefreshOptions) => Promise<void>;
  syncNow: (options?: SyncOptions) => Promise<void>;
}

const DEFAULT_AUTO_SYNC_INTERVAL_MS = 15000;

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

export function useMercadoLivreData(
  options: UseMercadoLivreDataOptions = {}
): MercadoLivreDataState {
  const {
    autoSync = false,
    autoSyncIntervalMs = DEFAULT_AUTO_SYNC_INTERVAL_MS,
  } = options;

  const [connection, setConnection] = useState<MLConnection | null>(null);
  const [orders, setOrders] = useState<MLOrder[]>([]);
  const [dashboard, setDashboard] = useState<MLDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const connectionRef = useRef<MLConnection | null>(null);
  const ordersRef = useRef<MLOrder[]>([]);
  const syncInFlightRef = useRef(false);
  const bootstrappedConnectionRef = useRef<string | null>(null);

  const refresh = useCallback(async (options: RefreshOptions = {}) => {
    const { background = false } = options;
    if (!background) {
      setLoading(true);
    }
    setError(null);

    try {
      const [ordersResult, dashboardResult] = await Promise.allSettled([
        getMLOrders(),
        getMLDashboard(),
      ]);

      const importedOrders =
        ordersResult.status === "fulfilled" ? ordersResult.value : [];
      const dashboardResponse =
        dashboardResult.status === "fulfilled" ? dashboardResult.value : null;
      let currentConnection =
        buildFallbackConnection(dashboardResponse, importedOrders) ?? connectionRef.current;
      let connectionError: unknown = null;

      if (!currentConnection) {
        try {
          currentConnection = await getMLConnectionStatus();
        } catch (caughtConnectionError) {
          connectionError = caughtConnectionError;
        }
      }

      setConnection(currentConnection);
      setOrders(importedOrders);
      setDashboard(dashboardResponse);

      const failures = [ordersResult, dashboardResult].filter(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );

      if (failures.length > 0) {
        throw failures[0].reason;
      }

      if (!currentConnection && connectionError) {
        throw connectionError;
      }
    } catch (caughtError) {
      console.error("Failed to load Mercado Livre data:", caughtError);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Falha ao carregar os dados do Mercado Livre."
      );
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, []);

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

        setError(null);
        const shouldRefresh =
          forceFullSync ||
          ordersRef.current.length === 0 ||
          (syncResult?.synced ?? 0) > 0;

        if (shouldRefresh) {
          await refresh({ background: true });
        }
      } catch (caughtError) {
        console.error("Mercado Livre sync failed:", caughtError);
        if (!silent) {
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
    void refresh();
  }, [refresh]);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  useEffect(() => {
    ordersRef.current = orders;
  }, [orders]);

  useEffect(() => {
    if (!autoSync || !connection?.id) {
      bootstrappedConnectionRef.current = null;
      return;
    }

    if (bootstrappedConnectionRef.current !== connection.id) {
      bootstrappedConnectionRef.current = connection.id;
      void syncNow({
        silent: true,
        forceFullSync: ordersRef.current.length === 0,
      });
    }

    const intervalId = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) {
        return;
      }

      void syncNow({ silent: true });
    }, autoSyncIntervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [autoSync, autoSyncIntervalMs, connection?.id, syncNow]);

  return {
    connection,
    orders,
    dashboard,
    loading,
    error,
    refresh,
    syncNow,
  };
}
