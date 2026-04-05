import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useExtraction } from "@/contexts/ExtractionContext";
import { useAuth } from "@/contexts/AuthContext";
import { useMercadoLivreData } from "@/hooks/useMercadoLivreData";
import {
  Download,
  Eye,
  Loader2,
  Search,
  ShoppingCart,
} from "lucide-react";
import { SaleCardPreview } from "@/components/SaleCardPreview";
import { toast } from "sonner";
import {
  mapMLOrderToProcessingResult,
  type MLOrder,
} from "@/services/mercadoLivreService";
import { exportSalePdf } from "@/services/pdfExportService";
import {
  formatSaleMoment,
  getDepositInfo,
  matchesSearch,
} from "@/services/mercadoLivreHelpers";

export default function HistoryPage() {
  const navigate = useNavigate();
  const { setResults } = useExtraction();
  const { canAccessLocation } = useAuth();
  const { orders, loading, error } = useMercadoLivreData();

  const [search, setSearch] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [exportingOrderId, setExportingOrderId] = useState<string | null>(null);

  const permittedOrders = useMemo(
    () => orders.filter((order) => canAccessLocation(getDepositInfo(order).label)),
    [canAccessLocation, orders]
  );

  const filteredOrders = useMemo(
    () => permittedOrders.filter((order) => matchesSearch(order, search)),
    [permittedOrders, search]
  );

  const selectedOrder =
    filteredOrders.find((order) => order.id === selectedOrderId) ??
    filteredOrders[0] ??
    null;

  const previewSale = selectedOrder
    ? mapMLOrderToProcessingResult(selectedOrder).sale
    : null;

  const handleExport = async (order: MLOrder) => {
    setExportingOrderId(order.id);
    try {
      await exportSalePdf(mapMLOrderToProcessingResult(order).sale);
      toast.success(`Etiqueta da venda ${order.sale_number} exportada.`);
    } catch {
      toast.error("Falha ao exportar o PDF da etiqueta.");
    } finally {
      setExportingOrderId(null);
    }
  };

  const handleReview = (order: MLOrder) => {
    setResults([mapMLOrderToProcessingResult(order)]);
    navigate("/review");
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Historico</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Historico operacional das vendas sincronizadas do Mercado Livre.
          </p>
        </div>

        {error && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por numero da venda, SKU, cliente ou produto..."
              className="pl-10 bg-card border-border"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Badge variant="outline" className="hidden items-center px-4 md:inline-flex">
            {filteredOrders.length} resultado(s)
          </Badge>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-2 lg:col-span-1">
              {filteredOrders.length === 0 ? (
                <div className="glass-card px-4 py-12 text-center">
                  <ShoppingCart className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    Nenhuma venda encontrada para a busca informada.
                  </p>
                </div>
              ) : (
                filteredOrders.map((order) => {
                  const deposit = getDepositInfo(order);
                  const isSelected = selectedOrder?.id === order.id;

                  return (
                    <button
                      key={order.id}
                      type="button"
                      onClick={() => setSelectedOrderId(order.id)}
                      className={`glass-card w-full p-4 text-left transition-all ${
                        isSelected ? "ring-2 ring-primary" : "hover:bg-secondary/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="inline-flex rounded-full bg-[#fff159] px-2 py-0.5 text-[11px] font-semibold text-[#333333]">
                              ML
                            </span>
                            <p className="truncate text-sm font-semibold text-foreground">
                              #{order.sale_number}
                            </p>
                          </div>
                          <p className="mt-2 truncate text-sm font-medium text-foreground">
                            {order.item_title || "Produto sem titulo"}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {order.buyer_name || order.buyer_nickname || "Comprador nao identificado"}
                          </p>
                        </div>
                        <Badge variant="outline" className="shrink-0">
                          {order.sku || "Sem SKU"}
                        </Badge>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span>{formatSaleMoment(order.sale_date)}</span>
                        <span>{deposit.label}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="lg:col-span-2">
              {selectedOrder && previewSale ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">
                        Preview da etiqueta
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Visualizacao a partir do pedido sincronizado.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => handleReview(selectedOrder)}>
                        <Eye className="mr-2 h-4 w-4" />
                        Conferir
                      </Button>
                      <Button
                        onClick={() => void handleExport(selectedOrder)}
                        disabled={exportingOrderId === selectedOrder.id}
                      >
                        {exportingOrderId === selectedOrder.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="mr-2 h-4 w-4" />
                        )}
                        Exportar PDF
                      </Button>
                    </div>
                  </div>

                  <SaleCardPreview sale={previewSale} />
                </div>
              ) : (
                <div className="glass-card p-16 text-center">
                  <ShoppingCart className="mx-auto mb-3 h-10 w-10 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    Selecione uma venda para visualizar a etiqueta real.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
