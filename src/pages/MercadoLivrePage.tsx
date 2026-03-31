import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useExtraction } from "@/contexts/ExtractionContext";
import {
  getMLConnectionStatus,
  startMLOAuth,
  syncMLOrders,
  disconnectML,
  getMLOrders,
  mapMLOrdersToProcessingResults,
  type MLConnection,
  type MLOrder,
} from "@/services/mercadoLivreService";
import {
  Link2,
  Unlink,
  RefreshCw,
  ShoppingCart,
  Loader2,
  CheckCircle,
  AlertCircle,
  Calendar,
  Filter,
  ArrowRight,
  FileOutput,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ShipmentBucket = "today" | "upcoming" | "in_transit" | "finalized";

interface DepositOption {
  key: string;
  label: string;
}

const SHIPMENT_FILTERS: Array<{ key: ShipmentBucket; label: string }> = [
  { key: "today", label: "Envios de hoje" },
  { key: "upcoming", label: "Proximos dias" },
  { key: "in_transit", label: "Em transito" },
  { key: "finalized", label: "Finalizadas" },
];

const KNOWN_DEPOSIT_LABELS: Record<string, string> = {
  "store:79856028": "Ourinhos Rua Dario Alonso",
  "node:BRP750436881": "Ourinhos Rua Dario Alonso",
  "logistic:fulfillment": "Full",
};

function getRawData(order: MLOrder): any {
  return order.raw_data && typeof order.raw_data === "object" ? order.raw_data : null;
}

function getShipmentSnapshot(order: MLOrder): any {
  return getRawData(order)?.shipment_snapshot ?? null;
}

function getOrderStock(order: MLOrder): { storeId: string | null; nodeId: string | null } {
  const stock = getRawData(order)?.order_items?.[0]?.stock;
  return {
    storeId: stock?.store_id ? String(stock.store_id) : null,
    nodeId: stock?.node_id ? String(stock.node_id) : null,
  };
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getReferenceShipmentDate(order: MLOrder): Date | null {
  const snapshot = getShipmentSnapshot(order);
  const statusHistory = snapshot?.status_history ?? {};
  const shippingOption = snapshot?.shipping_option ?? {};

  return (
    parseDate(statusHistory.date_handling) ||
    parseDate(statusHistory.date_ready_to_ship) ||
    parseDate(shippingOption.estimated_delivery_limit) ||
    parseDate(shippingOption.estimated_delivery_final) ||
    parseDate(order.sale_date)
  );
}

function isSameCalendarDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getShipmentBucket(order: MLOrder): ShipmentBucket {
  const snapshot = getShipmentSnapshot(order);
  const status = String(snapshot?.status || order.order_status || "").toLowerCase();
  const today = new Date();

  if (["delivered", "cancelled", "returned", "not_delivered"].includes(status)) {
    return "finalized";
  }

  if (["shipped", "in_transit"].includes(status)) {
    return "in_transit";
  }

  const referenceDate = getReferenceShipmentDate(order);
  if (referenceDate && isSameCalendarDay(referenceDate, today)) {
    return "today";
  }

  return "upcoming";
}

function getDepositInfo(order: MLOrder): { key: string; label: string; hasDeposit: boolean } {
  const snapshot = getShipmentSnapshot(order);
  const logisticType = snapshot?.logistic_type ? String(snapshot.logistic_type) : null;
  const { storeId, nodeId } = getOrderStock(order);

  if (logisticType === "fulfillment") {
    return {
      key: "logistic:fulfillment",
      label: KNOWN_DEPOSIT_LABELS["logistic:fulfillment"],
      hasDeposit: true,
    };
  }

  if (storeId) {
    const key = `store:${storeId}`;
    return {
      key,
      label: KNOWN_DEPOSIT_LABELS[key] || `Deposito ${storeId}`,
      hasDeposit: true,
    };
  }

  if (nodeId) {
    const key = `node:${nodeId}`;
    return {
      key,
      label: KNOWN_DEPOSIT_LABELS[key] || `Deposito ${nodeId}`,
      hasDeposit: true,
    };
  }

  return {
    key: "without-deposit",
    label: "Vendas sem deposito",
    hasDeposit: false,
  };
}

export default function MercadoLivrePage() {
  const navigate = useNavigate();
  const { setResults } = useExtraction();
  const [connection, setConnection] = useState<MLConnection | null>(null);
  const [orders, setOrders] = useState<MLOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [shipmentFilter, setShipmentFilter] = useState<ShipmentBucket>("today");
  const [depositFilter, setDepositFilter] = useState("all");

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const currentConnection = await getMLConnectionStatus();
      setConnection(currentConnection);

      if (currentConnection) {
        const importedOrders = await getMLOrders();
        setOrders(importedOrders);
      }
    } catch (error) {
      console.error("Failed to load Mercado Livre data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const url = await startMLOAuth();
      window.location.href = url;
    } catch (error: any) {
      toast.error(error.message || "Erro ao iniciar conexao");
      setConnecting(false);
    }
  };

  const handleSync = async () => {
    if (!connection) return;

    setSyncing(true);
    try {
      const result = await syncMLOrders(connection.id, {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        status_filter: statusFilter === "all" ? undefined : statusFilter,
      });

      toast.success(`${result.synced} pedidos sincronizados de ${result.total_fetched} encontrados`);

      const importedOrders = await getMLOrders();
      setOrders(importedOrders);
      const currentConnection = await getMLConnectionStatus();
      setConnection(currentConnection);
    } catch (error: any) {
      toast.error(error.message || "Erro ao sincronizar");
    } finally {
      setSyncing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!connection) return;

    try {
      await disconnectML(connection.id);
      setConnection(null);
      setOrders([]);
      toast.success("Conta desconectada");
    } catch (error: any) {
      toast.error(error.message || "Erro ao desconectar");
    }
  };

  const handleReviewOrders = (ordersToReview: MLOrder[]) => {
    if (ordersToReview.length === 0) {
      toast.info("Nenhum pedido importado para gerar etiqueta");
      return;
    }

    setResults(mapMLOrdersToProcessingResults(ordersToReview));
    toast.success(`${ordersToReview.length} pedido(s) enviados para conferencia`);
    navigate("/review");
  };

  const statusColors: Record<string, string> = {
    paid: "default",
    confirmed: "default",
    shipped: "secondary",
    delivered: "default",
    cancelled: "destructive",
  };

  const missingImageCount = orders.filter((order) => !order.product_image_url).length;

  const depositOptions = useMemo<DepositOption[]>(() => {
    const optionsMap = new Map<string, string>();

    for (const order of orders) {
      const depositInfo = getDepositInfo(order);
      if (depositInfo.hasDeposit) {
        optionsMap.set(depositInfo.key, depositInfo.label);
      }
    }

    return Array.from(optionsMap.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
  }, [orders]);

  const depositFilteredOrders = useMemo(() => {
    if (depositFilter === "all") return orders;

    return orders.filter((order) => {
      const depositInfo = getDepositInfo(order);

      if (depositFilter === "without-deposit") {
        return !depositInfo.hasDeposit;
      }

      return depositInfo.key === depositFilter;
    });
  }, [depositFilter, orders]);

  const shipmentCounts = useMemo(() => {
    return SHIPMENT_FILTERS.reduce<Record<ShipmentBucket, number>>(
      (accumulator, currentFilter) => {
        accumulator[currentFilter.key] = depositFilteredOrders.filter(
          (order) => getShipmentBucket(order) === currentFilter.key
        ).length;
        return accumulator;
      },
      {
        today: 0,
        upcoming: 0,
        in_transit: 0,
        finalized: 0,
      }
    );
  }, [depositFilteredOrders]);

  const filteredOrders = useMemo(() => {
    return depositFilteredOrders.filter(
      (order) => getShipmentBucket(order) === shipmentFilter
    );
  }, [depositFilteredOrders, shipmentFilter]);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Mercado Livre</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Conecte sua conta, sincronize os pedidos e envie as vendas para gerar etiquetas.
          </p>
        </div>

        <div className="glass-card space-y-4 p-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              Conexao
            </h2>
            {connection ? (
              <Badge variant="default" className="bg-success text-success-foreground">
                <CheckCircle className="mr-1 h-3 w-3" />
                Conectado
              </Badge>
            ) : (
              <Badge variant="outline">
                <AlertCircle className="mr-1 h-3 w-3" />
                Desconectado
              </Badge>
            )}
          </div>

          {connection ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Vendedor</p>
                  <p className="font-medium text-foreground">
                    {connection.seller_nickname || connection.seller_id}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Ultima sincronizacao
                  </p>
                  <p className="font-medium text-foreground">
                    {connection.last_sync_at
                      ? new Date(connection.last_sync_at).toLocaleString("pt-BR")
                      : "Nunca"}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    Pedidos importados
                  </p>
                  <p className="font-medium text-foreground">{orders.length}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSync} disabled={syncing} size="sm">
                  <RefreshCw className={`mr-1 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Sincronizando..." : "Sincronizar Agora"}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={filteredOrders.length === 0}
                  onClick={() => handleReviewOrders(filteredOrders)}
                >
                  <FileOutput className="mr-1 h-4 w-4" />
                  Gerar Etiquetas ({filteredOrders.length})
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-destructive">
                      <Unlink className="mr-1 h-4 w-4" />
                      Desconectar
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Desconectar Mercado Livre?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Isso removera a conexao e todos os pedidos importados. Essa acao nao pode ser desfeita.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={handleDisconnect}>Desconectar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-6 text-center">
              <ShoppingCart className="mx-auto h-10 w-10 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">
                Conecte sua conta do Mercado Livre para importar vendas automaticamente.
              </p>
              <Button onClick={handleConnect} disabled={connecting}>
                {connecting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="mr-2 h-4 w-4" />
                )}
                Conectar Mercado Livre
              </Button>
            </div>
          )}
        </div>

        {connection && (
          <>
            <div className="glass-card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                    className="h-8 w-40 bg-secondary/50 text-xs"
                    placeholder="De"
                  />
                  <span className="text-xs text-muted-foreground">ate</span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                    className="h-8 w-40 bg-secondary/50 text-xs"
                    placeholder="Ate"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 w-40 text-xs">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="paid">Pago</SelectItem>
                    <SelectItem value="confirmed">Confirmado</SelectItem>
                    <SelectItem value="shipped">Enviado</SelectItem>
                    <SelectItem value="delivered">Entregue</SelectItem>
                    <SelectItem value="cancelled">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={handleSync}
                  disabled={syncing}
                >
                  <RefreshCw className={`mr-1 h-3 w-3 ${syncing ? "animate-spin" : ""}`} />
                  Buscar
                </Button>
              </div>
            </div>

            <div className="glass-card p-5">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                    Pedidos para etiquetas ({filteredOrders.length} de {orders.length})
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Aplique os filtros abaixo e gere somente as etiquetas desejadas.
                  </p>
                </div>

                <div className="w-full max-w-sm">
                  <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                    Vendas
                  </p>
                  <Select value={depositFilter} onValueChange={setDepositFilter}>
                    <SelectTrigger className="h-11 bg-secondary/40 text-sm">
                      <SelectValue placeholder="Todas as vendas" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as vendas</SelectItem>
                      <SelectItem value="without-deposit">Vendas sem deposito</SelectItem>
                      {depositOptions.map((option) => (
                        <SelectItem key={option.key} value={option.key}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="mb-4 rounded-2xl border border-border/60 bg-secondary/40 p-2">
                <div className="flex flex-wrap gap-2">
                  {SHIPMENT_FILTERS.map((filterOption) => {
                    const active = shipmentFilter === filterOption.key;
                    const count = shipmentCounts[filterOption.key];

                    return (
                      <button
                        key={filterOption.key}
                        type="button"
                        onClick={() => setShipmentFilter(filterOption.key)}
                        className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                          active
                            ? "bg-white text-foreground shadow-sm"
                            : "text-muted-foreground hover:bg-white/70"
                        }`}
                      >
                        <span>{filterOption.label}</span>
                        <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-bold text-primary-foreground">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {orders.length > 0 && missingImageCount > 0 && (
                <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground">
                  <p className="font-medium">
                    {missingImageCount} pedido(s) ainda sem foto do produto.
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Para puxar a imagem direto do item do Mercado Livre, habilite no app do
                    Mercado Livre a permissao "Publicacao e sincronizacao" em modo "Leitura",
                    reconecte a conta e sincronize novamente.
                  </p>
                </div>
              )}

              {filteredOrders.length > 0 && (
                <div className="mb-4 flex justify-end">
                  <Button size="sm" onClick={() => handleReviewOrders(filteredOrders)}>
                    <FileOutput className="mr-2 h-4 w-4" />
                    Revisar e Exportar Filtradas ({filteredOrders.length})
                  </Button>
                </div>
              )}

              {orders.length === 0 ? (
                <div className="py-8 text-center">
                  <ShoppingCart className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    Nenhum pedido importado. Clique em "Sincronizar Agora" para buscar.
                  </p>
                </div>
              ) : filteredOrders.length === 0 ? (
                <div className="py-8 text-center">
                  <ShoppingCart className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    Nenhum pedido encontrado para o filtro selecionado.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredOrders.map((order) => (
                    <div
                      key={order.id}
                      className="flex items-center justify-between gap-4 rounded-lg bg-secondary/50 p-3 transition-colors hover:bg-secondary"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-white">
                          {order.product_image_url ? (
                            <img
                              src={order.product_image_url}
                              alt={order.item_title || "Produto"}
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                              Sem foto
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium text-foreground">#{order.sale_number}</p>
                            <Badge
                              variant={
                                (statusColors[order.order_status || ""] as
                                  | "default"
                                  | "secondary"
                                  | "destructive"
                                  | "outline") || "outline"
                              }
                              className="text-[10px]"
                            >
                              {order.order_status || "-"}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {getDepositInfo(order).label}
                            </Badge>
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {order.item_title || "Sem titulo"}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>{order.buyer_name || order.buyer_nickname || "-"}</span>
                            <span>{new Date(order.sale_date).toLocaleDateString("pt-BR")}</span>
                            {order.sku && <span className="font-mono">{order.sku}</span>}
                            <span>Qtd: {order.quantity}</span>
                          </div>
                        </div>
                      </div>

                      <Button size="sm" variant="outline" onClick={() => handleReviewOrders([order])}>
                        Gerar Etiqueta
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
