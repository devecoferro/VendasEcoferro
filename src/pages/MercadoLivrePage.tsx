import { useState, useEffect, useCallback } from "react";
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

export default function MercadoLivrePage() {
  const navigate = useNavigate();
  const { setResults } = useExtraction();
  const [connection, setConnection] = useState<MLConnection | null>(null);
  const [orders, setOrders] = useState<MLOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);

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

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Mercado Livre</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Conecte sua conta, sincronize os pedidos e envie as vendas para gerar etiquetas.
          </p>
        </div>

        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Link2 className="w-4 h-4 text-muted-foreground" />
              Conexao
            </h2>
            {connection ? (
              <Badge variant="default" className="bg-success text-success-foreground">
                <CheckCircle className="w-3 h-3 mr-1" />
                Conectado
              </Badge>
            ) : (
              <Badge variant="outline">
                <AlertCircle className="w-3 h-3 mr-1" />
                Desconectado
              </Badge>
            )}
          </div>

          {connection ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wider">Vendedor</p>
                  <p className="font-medium text-foreground">
                    {connection.seller_nickname || connection.seller_id}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wider">
                    Ultima sincronizacao
                  </p>
                  <p className="font-medium text-foreground">
                    {connection.last_sync_at
                      ? new Date(connection.last_sync_at).toLocaleString("pt-BR")
                      : "Nunca"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wider">
                    Pedidos importados
                  </p>
                  <p className="font-medium text-foreground">{orders.length}</p>
                </div>
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button onClick={handleSync} disabled={syncing} size="sm">
                  <RefreshCw className={`w-4 h-4 mr-1 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Sincronizando..." : "Sincronizar Agora"}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={orders.length === 0}
                  onClick={() => handleReviewOrders(orders)}
                >
                  <FileOutput className="w-4 h-4 mr-1" />
                  Gerar Etiquetas ({orders.length})
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="text-destructive">
                      <Unlink className="w-4 h-4 mr-1" />
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
            <div className="text-center py-6 space-y-3">
              <ShoppingCart className="w-10 h-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">
                Conecte sua conta do Mercado Livre para importar vendas automaticamente.
              </p>
              <Button onClick={handleConnect} disabled={connecting}>
                {connecting ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Link2 className="w-4 h-4 mr-2" />
                )}
                Conectar Mercado Livre
              </Button>
            </div>
          )}
        </div>

        {connection && (
          <>
            <div className="glass-card p-4">
              <div className="flex items-center gap-3 flex-wrap">
                <Filter className="w-4 h-4 text-muted-foreground" />
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-muted-foreground" />
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(event) => setDateFrom(event.target.value)}
                    className="w-40 h-8 text-xs bg-secondary/50"
                    placeholder="De"
                  />
                  <span className="text-muted-foreground text-xs">ate</span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(event) => setDateTo(event.target.value)}
                    className="w-40 h-8 text-xs bg-secondary/50"
                    placeholder="Ate"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40 h-8 text-xs">
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
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleSync} disabled={syncing}>
                  <RefreshCw className={`w-3 h-3 mr-1 ${syncing ? "animate-spin" : ""}`} />
                  Buscar
                </Button>
              </div>
            </div>

            <div className="glass-card p-5">
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-muted-foreground" />
                  Pedidos Importados ({orders.length})
                </h2>

                {orders.length > 0 && (
                  <Button size="sm" onClick={() => handleReviewOrders(orders)}>
                    <FileOutput className="w-4 h-4 mr-2" />
                    Revisar e Exportar Todas
                  </Button>
                )}
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

              {orders.length === 0 ? (
                <div className="text-center py-8">
                  <ShoppingCart className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    Nenhum pedido importado. Clique em "Sincronizar Agora" para buscar.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {orders.map((order) => (
                    <div
                      key={order.id}
                      className="flex items-center justify-between gap-4 p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
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
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-foreground">#{order.sale_number}</p>
                            <Badge
                              variant={(statusColors[order.order_status || ""] as "default" | "secondary" | "destructive" | "outline") || "outline"}
                              className="text-[10px]"
                            >
                              {order.order_status || "-"}
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

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleReviewOrders([order])}
                      >
                        Gerar Etiqueta
                        <ArrowRight className="w-4 h-4 ml-2" />
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
