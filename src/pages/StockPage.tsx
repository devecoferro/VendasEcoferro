import { useCallback, useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getMLConnectionStatus,
  getMLStock,
  syncMLStock,
  syncStockToWebsite,
  updateMLStockItem,
  deleteMLStockItem,
  type MLStockItem,
  type StockSalesPeriod,
  type StockCustomRange,
} from "@/services/mercadoLivreService";
import {
  AlertCircle,
  ExternalLink,
  Filter,
  Flame,
  Globe,
  Loader2,
  Package,
  Pencil,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
  MapPin,
  AlertTriangle,
} from "lucide-react";
import {
  exportStockListPdf,
  type StockReportColumnOptions,
} from "@/services/stockReportService";
import { StockReportColumnsDialog } from "@/components/StockReportColumnsDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type SortKey =
  | "available_quantity"
  | "sold_quantity"
  | "title"
  | "price"
  // Novo: ordena pelos produtos que mais venderam na janela selecionada.
  // Permite o operador priorizar reposicao de estoque dos itens "quentes".
  | "recent_sales_qty"
  // Novo: ordena pela data da venda mais recente, util para identificar
  // produtos que ainda estao vendendo vs produtos parados.
  | "last_sale_date";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "active" | "paused" | "closed";

export default function StockPage() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [items, setItems] = useState<MLStockItem[]>([]);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [publishingToSite, setPublishingToSite] = useState(false);
  const [publishResult, setPublishResult] = useState<{ created: number; updated: number; errors: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("available_quantity");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [onlyMissingSku, setOnlyMissingSku] = useState(false);
  // Janela de "vendas recentes" para o cruzamento ml_stock x ml_orders.
  // Default 30d = visao de demanda do mes (evita janela muito curta com
  // ruido e muito longa que nao reflete demanda atual).
  const [salesPeriod, setSalesPeriod] = useState<StockSalesPeriod>("30d");
  // Range manual — só ativo quando salesPeriod === "custom".
  // Default: últimos 30 dias (fica preenchido quando usuário seleciona custom).
  const todayIso = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const [customRange, setCustomRange] = useState<StockCustomRange>({
    from: thirtyDaysAgoIso,
    to: todayIso,
  });
  // Filtro "so itens com venda no periodo": ajuda a identificar rapido
  // o que realmente esta saindo, escondendo anuncios parados.
  const [onlyWithRecentSales, setOnlyWithRecentSales] = useState(false);
  const [editing, setEditing] = useState<MLStockItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MLStockItem | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  // Dialog de seleção de colunas do relatório
  const [columnsDialogOpen, setColumnsDialogOpen] = useState(false);
  // Filtros "pendentes" — salvos quando user clica "Imprimir Lista"
  // e consumidos quando confirma colunas no dialog.
  const [pendingReportFilters, setPendingReportFilters] = useState<
    Parameters<typeof exportStockListPdf>[1] | null
  >(null);
  // Seleção de produtos pra imprimir só um subset no PDF.
  // Vazio = imprime todos os filtrados (comportamento anterior).
  // Com IDs = imprime só os selecionados.
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    getMLConnectionStatus()
      .then((conn) => {
        if (conn?.id) setConnectionId(conn.id);
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const loadStock = useCallback(
    async (
      id: string,
      period: StockSalesPeriod,
      range: StockCustomRange
    ) => {
      setLoading(true);
      setError(null);
      try {
        const result = await getMLStock(id, {
          salesPeriod: period,
          customRange: period === "custom" ? range : undefined,
        });
        setItems(result.items);
        setStale(result.stale);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao carregar estoque.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Recarrega estoque quando muda conexao, periodo, ou range customizado
  // (quando salesPeriod === "custom"). Pra evitar refetch a cada keystroke
  // na data, só dispara quando o range está completo e válido.
  useEffect(() => {
    if (!connectionId) return;
    if (salesPeriod === "custom") {
      const fromValid = /^\d{4}-\d{2}-\d{2}$/.test(customRange.from);
      const toValid = /^\d{4}-\d{2}-\d{2}$/.test(customRange.to);
      if (!fromValid || !toValid || customRange.from > customRange.to) return;
    }
    loadStock(connectionId, salesPeriod, customRange);
  }, [connectionId, loadStock, salesPeriod, customRange]);

  const handleSync = useCallback(async () => {
    if (!connectionId) return;
    setSyncing(true);
    setError(null);
    try {
      await syncMLStock(connectionId);
      await loadStock(connectionId, salesPeriod, customRange);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao sincronizar estoque.");
    } finally {
      setSyncing(false);
    }
  }, [connectionId, loadStock, salesPeriod, customRange]);

  const handlePublishToSite = useCallback(async () => {
    setPublishingToSite(true);
    setError(null);
    setPublishResult(null);
    try {
      const result = await syncStockToWebsite();
      setPublishResult({ created: result.created, updated: result.updated, errors: result.errors });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao publicar no site.");
    } finally {
      setPublishingToSite(false);
    }
  }, []);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "title" ? "asc" : "desc");
    }
  };

  // Extrair opcoes unicas de marca, modelo e ano — CASCATA
  // Marcas: sempre todas. Modelos: filtrados pela marca. Anos: filtrados pela marca+modelo.
  const filterOptions = useMemo(() => {
    const brands = new Set<string>();
    const models = new Set<string>();
    const years = new Set<string>();

    for (const item of items) {
      if (item.brand) brands.add(item.brand);

      // Modelos: só da marca selecionada (ou todos se nenhuma marca)
      const matchesBrand = brandFilter === "all" || item.brand === brandFilter;
      if (matchesBrand && item.model) models.add(item.model);

      // Anos: só da marca+modelo selecionados
      const matchesModel = modelFilter === "all" || item.model === modelFilter;
      if (matchesBrand && matchesModel && item.vehicle_year) years.add(item.vehicle_year);
    }

    return {
      brands: [...brands].sort((a, b) => a.localeCompare(b, "pt-BR")),
      models: [...models].sort((a, b) => a.localeCompare(b, "pt-BR")),
      years: [...years].sort((a, b) => b.localeCompare(a)),
    };
  }, [items, brandFilter, modelFilter]);

  // Resetar modelo/ano quando a marca muda e o valor nao existe mais
  useEffect(() => {
    if (modelFilter !== "all" && !filterOptions.models.includes(modelFilter)) {
      setModelFilter("all");
    }
  }, [filterOptions.models, modelFilter]);

  useEffect(() => {
    if (yearFilter !== "all" && !filterOptions.years.includes(yearFilter)) {
      setYearFilter("all");
    }
  }, [filterOptions.years, yearFilter]);

  const hasActiveFilters =
    brandFilter !== "all" ||
    modelFilter !== "all" ||
    yearFilter !== "all" ||
    statusFilter !== "all" ||
    onlyWithRecentSales;
  const activeFilterCount =
    [brandFilter, modelFilter, yearFilter, statusFilter].filter((f) => f !== "all").length +
    (onlyWithRecentSales ? 1 : 0);

  const clearFilters = () => {
    setBrandFilter("all");
    setModelFilter("all");
    setYearFilter("all");
    setStatusFilter("all");
    setOnlyWithRecentSales(false);
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let result = items;

    // Filtro de texto
    if (q) {
      result = result.filter(
        (item) =>
          item.title?.toLowerCase().includes(q) ||
          item.sku?.toLowerCase().includes(q) ||
          item.item_id.toLowerCase().includes(q) ||
          item.brand?.toLowerCase().includes(q) ||
          item.model?.toLowerCase().includes(q)
      );
    }

    // Filtros de marca/modelo/ano
    if (brandFilter !== "all") {
      result = result.filter((item) => item.brand === brandFilter);
    }
    if (modelFilter !== "all") {
      result = result.filter((item) => item.model === modelFilter);
    }
    if (yearFilter !== "all") {
      result = result.filter((item) => item.vehicle_year === yearFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((item) => item.status === statusFilter);
    }

    // Filtro: apenas produtos sem SKU (não sincronizados)
    if (onlyMissingSku) {
      result = result.filter((item) => !item.sku || item.sku.trim() === "");
    }

    // Filtro: apenas produtos com venda no periodo selecionado. Util pra
    // focar no que esta efetivamente girando — esconde anuncios parados.
    if (onlyWithRecentSales) {
      result = result.filter((item) => (item.recent_sales_qty || 0) > 0);
    }

    return [...result].sort((a, b) => {
      // Sort por vendas recentes — numero, maior desc por padrao.
      // Items sem venda (0) vao pro fundo quando desc (comportamento
      // esperado: "mais vendidos no topo").
      if (sortKey === "recent_sales_qty") {
        const va = a.recent_sales_qty ?? 0;
        const vb = b.recent_sales_qty ?? 0;
        return sortDir === "asc" ? va - vb : vb - va;
      }
      // Sort por data da ultima venda — items sem venda vao sempre pro
      // fim (null e "pior" que qualquer data), independente da direcao
      // ser asc/desc no que tem venda.
      if (sortKey === "last_sale_date") {
        const va = a.last_sale_date || "";
        const vb = b.last_sale_date || "";
        if (!va && !vb) return 0;
        if (!va) return 1;
        if (!vb) return -1;
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }

      const va: string | number | null = a[sortKey] ?? null;
      const vb: string | number | null = b[sortKey] ?? null;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "string" && typeof vb === "string") {
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortDir === "asc"
        ? (va as number) - (vb as number)
        : (vb as number) - (va as number);
    });
  }, [items, search, brandFilter, modelFilter, yearFilter, statusFilter, onlyMissingSku, onlyWithRecentSales, sortKey, sortDir]);

  const missingSkuCount = useMemo(
    () => items.filter((i) => !i.sku || i.sku.trim() === "").length,
    [items]
  );

  const handleSaveEdit = useCallback(async () => {
    if (!editing || !connectionId) return;
    setSavingEdit(true);
    try {
      await updateMLStockItem(connectionId, editing.item_id, {
        sku: editing.sku,
        location_corridor: editing.location_corridor,
        location_shelf: editing.location_shelf,
        location_level: editing.location_level,
        location_notes: editing.location_notes,
      });
      toast.success("Produto atualizado!");
      // Atualiza local state sem reload
      setItems((prev) =>
        prev.map((i) => (i.item_id === editing.item_id ? { ...i, ...editing } : i))
      );
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSavingEdit(false);
    }
  }, [editing, connectionId]);

  // Handler vai ser chamado mais embaixo no componente (apos sortLabel/filtered
  // estarem definidos). Encapsulado em useCallback dentro do return-effect.
  // Handler do botao "Imprimir Lista" — em vez de gerar PDF direto,
  // abre o dialog de selecao de colunas. O dialog chama
  // handleConfirmGenerateReport no final.
  const handleOpenColumnsDialog = useCallback(
    (
      filteredItems: MLStockItem[],
      reportFilters: Parameters<typeof exportStockListPdf>[1]
    ) => {
      if (filteredItems.length === 0) {
        toast.info("Nenhum produto pra imprimir — ajuste os filtros.");
        return;
      }
      if (filteredItems.length > 500) {
        const ok = window.confirm(
          `${filteredItems.length} produtos vao ser impressos. Isso vai gerar muitas paginas. Continuar?`
        );
        if (!ok) return;
      }
      setPendingReportFilters(reportFilters);
      setColumnsDialogOpen(true);
    },
    []
  );

  // Chamado pelo dialog quando user confirma colunas selecionadas.
  // Efetivamente gera o PDF com as colunas escolhidas.
  const handleConfirmGenerateReport = useCallback(
    async (
      filteredItems: MLStockItem[],
      columns: StockReportColumnOptions
    ) => {
      if (!pendingReportFilters) return;
      setExportingPdf(true);
      try {
        await exportStockListPdf(filteredItems, pendingReportFilters, {
          totalInBase: items.length,
          columns,
        });
        toast.success(
          `PDF gerado com ${filteredItems.length} produto${filteredItems.length === 1 ? "" : "s"}.`
        );
        setColumnsDialogOpen(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao gerar PDF.");
      } finally {
        setExportingPdf(false);
      }
    },
    [items.length, pendingReportFilters]
  );

  const handleDelete = useCallback(async () => {
    if (!confirmDelete || !connectionId) return;
    try {
      await deleteMLStockItem(connectionId, confirmDelete.item_id);
      toast.success("Produto removido do estoque local");
      setItems((prev) => prev.filter((i) => i.item_id !== confirmDelete.item_id));
      setConfirmDelete(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir");
    }
  }, [confirmDelete, connectionId]);

  const stockStats = useMemo(() => {
    const active = items.filter((i) => i.status === "active").length;
    const paused = items.filter((i) => i.status === "paused").length;
    const closed = items.filter((i) => i.status === "closed" || i.status === "under_review").length;
    const lowStock = items.filter((i) => i.available_quantity <= 3 && i.status === "active").length;
    const outOfStock = items.filter((i) => i.available_quantity === 0 && i.status === "active").length;
    return { active, paused, closed, lowStock, outOfStock };
  }, [items]);

  const lowStockCount = stockStats.lowStock;

  // Formata YYYY-MM-DD → DD/MM/YYYY pra exibir labels em PT-BR.
  const formatIsoDate = (iso: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  };

  // Label humano do periodo, usado em tooltips e no cabecalho da coluna.
  // Mantem uma fonte unica — trocar o enum e o label aqui e basta.
  const salesPeriodLabel = useMemo(() => {
    switch (salesPeriod) {
      case "7d":
        return "nos últimos 7 dias";
      case "30d":
        return "nos últimos 30 dias";
      case "90d":
        return "nos últimos 90 dias";
      case "all":
        return "em todo o período";
      case "custom":
        return `de ${formatIsoDate(customRange.from)} a ${formatIsoDate(customRange.to)}`;
    }
  }, [salesPeriod, customRange]);

  const salesPeriodShortLabel = useMemo(() => {
    switch (salesPeriod) {
      case "7d":
        return "7d";
      case "30d":
        return "30d";
      case "90d":
        return "90d";
      case "all":
        return "Total";
      case "custom":
        return `${formatIsoDate(customRange.from)}–${formatIsoDate(customRange.to)}`;
    }
  }, [salesPeriod, customRange]);

  // Formata "ha 3 dias" / "ontem" / "hoje" para exibir em vez de data crua.
  // Usa dia inteiro em America/Sao_Paulo porque e como o operador pensa.
  function formatDaysAgo(isoDate: string | null | undefined): string {
    if (!isoDate) return "—";
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return "—";
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
    if (diffDays < 0) return "hoje";
    if (diffDays === 0) return "hoje";
    if (diffDays === 1) return "ontem";
    if (diffDays < 30) return `${diffDays} dias`;
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} ${months === 1 ? "mês" : "meses"}`;
    }
    const years = Math.floor(diffDays / 365);
    return `${years} ${years === 1 ? "ano" : "anos"}`;
  }

  // Estatisticas do periodo selecionado — alimenta um stat card dedicado
  // que mostra quantos produtos realmente vendem vs quantos estao parados.
  const salesStats = useMemo(() => {
    let withSales = 0;
    let totalQty = 0;
    let totalOrders = 0;
    let topSeller: MLStockItem | null = null;
    let topSellerQty = 0;
    for (const item of items) {
      const qty = item.recent_sales_qty || 0;
      const orders = item.recent_sales_orders || 0;
      if (qty > 0) withSales++;
      totalQty += qty;
      totalOrders += orders;
      if (qty > topSellerQty) {
        topSellerQty = qty;
        topSeller = item;
      }
    }
    return {
      withSales,
      withoutSales: items.length - withSales,
      totalQty,
      totalOrders,
      topSeller,
      topSellerQty,
    };
  }, [items]);

  const SortBtn = ({ label, col }: { label: string; col: SortKey }) => (
    <button
      className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
      onClick={() => toggleSort(col)}
      type="button"
    >
      {label}
      {sortKey === col && (
        <span className="text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>
      )}
    </button>
  );

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold">Estoque</h1>
              {stale && (
                <Badge variant="secondary" className="text-xs">
                  Desatualizado
                </Badge>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSync}
              disabled={syncing || !connectionId}
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Sincronizar
            </Button>
            {/* Auditoria de marcas/modelos — abre relatorio HTML em nova aba.
                Substitui a necessidade de SSH/terminal pra rodar o script de
                auditoria. So admin tem acesso (validado no backend). */}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                window.open(
                  "/api/ml/admin/audit-brands?format=html",
                  "_blank",
                  "noopener,noreferrer"
                )
              }
              title="Auditar marcas/modelos do estoque (abre em nova aba) — so admin"
              className="gap-1.5"
            >
              <AlertTriangle className="h-4 w-4" />
              Auditoria
            </Button>
            {/* Botao "Imprimir Lista" — gera PDF da lista atual respeitando
                TODOS os filtros e a ordenacao escolhida pelo usuario.
                Snapshot do que esta na tela. */}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                // Se há itens selecionados via checkbox (e visíveis no filtro
                // atual), imprime SÓ eles. Caso contrário, imprime todos os
                // filtrados (comportamento antigo).
                const selectedVisible = filtered.filter((i) =>
                  selectedItemIds.has(i.item_id)
                );
                const itemsToExport =
                  selectedVisible.length > 0 ? selectedVisible : filtered;
                handleOpenColumnsDialog(itemsToExport, {
                  search,
                  brand: brandFilter,
                  model: modelFilter,
                  year: yearFilter,
                  status: statusFilter,
                  onlyMissingSku,
                  onlyWithRecentSales,
                  salesPeriodLabel,
                  salesPeriodShort: salesPeriodShortLabel,
                  sortLabel: `${sortKey} ${sortDir === "asc" ? "↑" : "↓"}`,
                });
              }}
              disabled={exportingPdf || filtered.length === 0}
              className="gap-1.5"
              title={(() => {
                if (filtered.length === 0) {
                  return "Nenhum produto pra imprimir — ajuste os filtros";
                }
                const selectedVisibleCount = filtered.filter((i) =>
                  selectedItemIds.has(i.item_id)
                ).length;
                if (selectedVisibleCount > 0) {
                  return `Imprimir ${selectedVisibleCount} produto(s) selecionado(s)`;
                }
                return `Imprimir lista de ${filtered.length} produto(s) com os filtros atuais`;
              })()}
            >
              {exportingPdf ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Printer className="h-4 w-4" />
              )}
              Imprimir Lista
              {(() => {
                const selectedVisibleCount = filtered.filter((i) =>
                  selectedItemIds.has(i.item_id)
                ).length;
                const showCount =
                  selectedVisibleCount > 0 ||
                  (filtered.length > 0 && filtered.length < items.length);
                if (!showCount) return null;
                return (
                  <span className="ml-1 text-[10px] opacity-70">
                    ({selectedVisibleCount > 0 ? selectedVisibleCount : filtered.length})
                  </span>
                );
              })()}
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={handlePublishToSite}
              disabled={publishingToSite || !items.length}
              className="gap-1.5 bg-green-600 hover:bg-green-700"
            >
              {publishingToSite ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Globe className="h-4 w-4" />
              )}
              Publicar no Site
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {hasActiveFilters || search
              ? `${filtered.length} de ${items.length} produto(s)`
              : `${items.length} produto(s) sincronizados do Mercado Livre`}
          </p>
          {publishResult && (
            <div className="rounded-md bg-green-50 border border-green-200 px-4 py-2.5 text-sm text-green-800 flex items-center gap-2">
              <Globe className="h-4 w-4 flex-shrink-0" />
              <span>
                <strong>{publishResult.created}</strong> novos produtos criados,{" "}
                <strong>{publishResult.updated}</strong> atualizados no site.
                {publishResult.errors > 0 && (
                  <span className="text-orange-600"> ({publishResult.errors} erros)</span>
                )}
              </span>
              <a
                href="https://www.ecoferro.com.br/produtos"
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto text-green-700 hover:text-green-900 flex items-center gap-1 font-medium"
              >
                Ver no site <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </div>

        {/* Cards de resumo */}
        {items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
            <button
              type="button"
              onClick={() => { setStatusFilter(statusFilter === "active" ? "all" : "active"); setShowFilters(true); }}
              className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${statusFilter === "active" ? "border-primary bg-primary/5" : ""}`}
            >
              <p className="text-xs font-medium text-muted-foreground">Ativos</p>
              <p className="text-2xl font-bold text-green-600">{stockStats.active}</p>
            </button>
            <button
              type="button"
              onClick={() => { setStatusFilter(statusFilter === "paused" ? "all" : "paused"); setShowFilters(true); }}
              className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${statusFilter === "paused" ? "border-primary bg-primary/5" : ""}`}
            >
              <p className="text-xs font-medium text-muted-foreground">Pausados</p>
              <p className="text-2xl font-bold text-yellow-600">{stockStats.paused}</p>
            </button>
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Estoque baixo</p>
              <p className={`text-2xl font-bold ${stockStats.lowStock > 0 ? "text-orange-500" : "text-foreground"}`}>
                {stockStats.lowStock}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Sem estoque</p>
              <p className={`text-2xl font-bold ${stockStats.outOfStock > 0 ? "text-destructive" : "text-foreground"}`}>
                {stockStats.outOfStock}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOnlyMissingSku((prev) => !prev)}
              className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${onlyMissingSku ? "border-destructive bg-destructive/5" : ""}`}
              title="Mostrar só produtos sem SKU"
            >
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Sem SKU
              </p>
              <p className={`text-2xl font-bold ${missingSkuCount > 0 ? "text-destructive" : "text-foreground"}`}>
                {missingSkuCount}
              </p>
            </button>
            {/* Card clicavel: mostra quantos produtos tiveram venda no
                periodo e ao clicar ordena por mais vendidos + ativa
                "Só vendidos". Atalho do dia a dia pra ver "o que esta
                saindo mais agora". */}
            <button
              type="button"
              onClick={() => {
                setOnlyWithRecentSales(true);
                setSortKey("recent_sales_qty");
                setSortDir("desc");
              }}
              className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${
                onlyWithRecentSales ? "border-orange-500 bg-orange-500/5" : ""
              }`}
              title={`Ordenar por produtos mais vendidos ${salesPeriodLabel}`}
            >
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Flame className="h-3 w-3 text-orange-500" />
                Vendidos {salesPeriodShortLabel}
              </p>
              <p className="text-2xl font-bold text-orange-500">{salesStats.withSales}</p>
              <p className="text-[10px] text-muted-foreground">
                {salesStats.totalQty} un em {salesStats.totalOrders} pedido
                {salesStats.totalOrders !== 1 ? "s" : ""}
              </p>
            </button>
          </div>
        )}

        {/* Top seller destacado — quando ha vendas no periodo, mostra o
            produto mais quente pra o operador saber rapidinho o que
            repor em primeiro. */}
        {salesStats.topSeller && salesStats.topSellerQty > 0 && (
          <div className="rounded-lg border border-orange-200 bg-gradient-to-r from-orange-50 to-yellow-50 px-4 py-2.5 flex items-center gap-3">
            <div className="flex-shrink-0 rounded-full bg-orange-500/10 p-2">
              <Flame className="h-4 w-4 text-orange-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold text-orange-700 uppercase tracking-wide">
                Mais vendido {salesPeriodLabel}
              </p>
              <p className="text-sm font-semibold truncate">
                {salesStats.topSeller.title || salesStats.topSeller.sku || salesStats.topSeller.item_id}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-lg font-bold text-orange-600">{salesStats.topSellerQty}</p>
              <p className="text-[10px] text-muted-foreground">unidades</p>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Busca + Filtros */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9 h-10"
                placeholder="Buscar por titulo, SKU, marca ou modelo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Janela de vendas recentes — cruza ml_stock com ml_orders no
                backend pra preencher recent_sales_qty/last_sale_date de
                cada item. Trocar o period recarrega a lista porque os
                agregados sao calculados no SQL. */}
            <div className="hidden sm:flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <Select
                  value={salesPeriod}
                  onValueChange={(v) => setSalesPeriod(v as StockSalesPeriod)}
                >
                  <SelectTrigger className="h-10 w-[170px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7d">Vendas últimos 7 dias</SelectItem>
                    <SelectItem value="30d">Vendas últimos 30 dias</SelectItem>
                    <SelectItem value="90d">Vendas últimos 90 dias</SelectItem>
                    <SelectItem value="all">Vendas totais</SelectItem>
                    <SelectItem value="custom">Data manual…</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Inputs de data manual — aparecem só quando "custom" está
                  selecionado. Debounce natural: o effect do loadStock só
                  dispara quando from <= to e formatos válidos. */}
              {salesPeriod === "custom" && (
                <div className="flex items-center gap-1.5 ml-6">
                  <Input
                    type="date"
                    value={customRange.from}
                    max={customRange.to}
                    onChange={(e) =>
                      setCustomRange((r) => ({ ...r, from: e.target.value }))
                    }
                    className="h-8 w-[140px] text-xs"
                    title="Data inicial"
                  />
                  <span className="text-xs text-muted-foreground">até</span>
                  <Input
                    type="date"
                    value={customRange.to}
                    min={customRange.from}
                    max={todayIso}
                    onChange={(e) =>
                      setCustomRange((r) => ({ ...r, to: e.target.value }))
                    }
                    className="h-8 w-[140px] text-xs"
                    title="Data final"
                  />
                </div>
              )}
            </div>

            <Button
              variant={showFilters ? "default" : "outline"}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="h-10 px-3 gap-1.5"
            >
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">Filtros</span>
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="h-5 min-w-[20px] px-1.5 text-xs rounded-full">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>

            {/* Atalho: so com venda no periodo. Muito pedido pelo operador
                que quer ver rapidamente o que esta girando sem precisar
                scrollar por anuncios parados. */}
            <Button
              type="button"
              variant={onlyWithRecentSales ? "default" : "outline"}
              size="sm"
              onClick={() => setOnlyWithRecentSales((prev) => !prev)}
              className={`h-10 px-3 gap-1.5 ${onlyWithRecentSales ? "bg-orange-500 hover:bg-orange-600 text-white" : ""}`}
              title={`Mostrar somente produtos que tiveram venda ${salesPeriodLabel}`}
            >
              <Flame className="h-4 w-4" />
              <span className="hidden sm:inline">Só vendidos</span>
            </Button>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-10 px-3 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Limpar</span>
              </Button>
            )}
          </div>

          {/* Painel de filtros colapsavel */}
          {showFilters && (
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {filterOptions.brands.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Marca</label>
                    <Select value={brandFilter} onValueChange={setBrandFilter}>
                      <SelectTrigger className="h-10 bg-background">
                        <SelectValue placeholder="Todas as marcas" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas as marcas</SelectItem>
                        {filterOptions.brands.map((brand) => (
                          <SelectItem key={brand} value={brand}>
                            {brand}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {filterOptions.models.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Modelo</label>
                    <Select value={modelFilter} onValueChange={setModelFilter}>
                      <SelectTrigger className="h-10 bg-background">
                        <SelectValue placeholder="Todos os modelos" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os modelos</SelectItem>
                        {filterOptions.models.map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {filterOptions.years.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ano</label>
                    <Select value={yearFilter} onValueChange={setYearFilter}>
                      <SelectTrigger className="h-10 bg-background">
                        <SelectValue placeholder="Todos os anos" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os anos</SelectItem>
                        {filterOptions.years.map((year) => (
                          <SelectItem key={year} value={year}>
                            {year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                    <SelectTrigger className="h-10 bg-background">
                      <SelectValue placeholder="Todos os status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os status</SelectItem>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="paused">Pausado</SelectItem>
                      <SelectItem value="closed">Encerrado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Tags dos filtros ativos */}
              {hasActiveFilters && (
                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t">
                  {brandFilter !== "all" && (
                    <Badge variant="secondary" className="gap-1 pr-1">
                      {brandFilter}
                      <button type="button" onClick={() => setBrandFilter("all")} className="ml-0.5 rounded-full hover:bg-muted p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                  {modelFilter !== "all" && (
                    <Badge variant="secondary" className="gap-1 pr-1">
                      {modelFilter}
                      <button type="button" onClick={() => setModelFilter("all")} className="ml-0.5 rounded-full hover:bg-muted p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                  {yearFilter !== "all" && (
                    <Badge variant="secondary" className="gap-1 pr-1">
                      {yearFilter}
                      <button type="button" onClick={() => setYearFilter("all")} className="ml-0.5 rounded-full hover:bg-muted p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                  {statusFilter !== "all" && (
                    <Badge variant="secondary" className="gap-1 pr-1">
                      {statusFilter === "active" ? "Ativo" : statusFilter === "paused" ? "Pausado" : "Encerrado"}
                      <button type="button" onClick={() => setStatusFilter("all")} className="ml-0.5 rounded-full hover:bg-muted p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                  {onlyWithRecentSales && (
                    <Badge className="gap-1 pr-1 bg-orange-500 hover:bg-orange-600">
                      <Flame className="h-3 w-3" />
                      Vendidos {salesPeriodShortLabel}
                      <button
                        type="button"
                        onClick={() => setOnlyWithRecentSales(false)}
                        className="ml-0.5 rounded-full hover:bg-orange-700 p-0.5"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Carregando estoque...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <Package className="h-10 w-10 opacity-30" />
            <p className="text-sm">
              {items.length === 0
                ? "Nenhum produto sincronizado. Clique em Sincronizar."
                : "Nenhum produto encontrado para a busca."}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border overflow-x-auto">
            <table className="w-full text-sm table-fixed">
              {/* Larguras refeitas pra fechar 100% sem sobrar espaco e
                  manter cada coluna proxima do tamanho do conteudo, evitando
                  numero "solto" longe do cabecalho. As escondidas em
                  breakpoints menores (md/lg) liberam espaco pras visiveis. */}
              <colgroup>
                <col className="w-[4%]" />
                <col className="w-[24%]" />
                <col className="w-[10%]" />
                <col className="w-[11%]" />
                <col className="w-[7%]" />
                <col className="w-[10%]" />
                <col className="w-[10%] hidden lg:table-column" />
                <col className="w-[8%] hidden lg:table-column" />
                <col className="w-[7%] hidden md:table-column" />
                <col className="w-[9%]" />
              </colgroup>
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-2 py-3 text-center text-xs">
                    {(() => {
                      const allFilteredSelected =
                        filtered.length > 0 &&
                        filtered.every((i) => selectedItemIds.has(i.item_id));
                      const someFilteredSelected =
                        !allFilteredSelected &&
                        filtered.some((i) => selectedItemIds.has(i.item_id));
                      return (
                        <Checkbox
                          checked={
                            allFilteredSelected
                              ? true
                              : someFilteredSelected
                                ? "indeterminate"
                                : false
                          }
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedItemIds(
                                new Set(filtered.map((i) => i.item_id))
                              );
                            } else {
                              setSelectedItemIds(new Set());
                            }
                          }}
                          aria-label="Selecionar todos filtrados"
                          title={
                            allFilteredSelected
                              ? "Desmarcar todos"
                              : "Selecionar todos filtrados"
                          }
                        />
                      );
                    })()}
                  </th>
                  <th className="px-2 py-3 text-left text-xs">
                    <SortBtn label="Produto" col="title" />
                  </th>
                  <th className="px-2 py-3 text-left text-xs hidden sm:table-cell">SKU</th>
                  <th className="px-2 py-3 text-center text-xs hidden lg:table-cell">
                    Localização
                  </th>
                  <th className="px-2 py-3 text-center text-xs">
                    <div className="flex items-center justify-center">
                      <SortBtn label="Disp." col="available_quantity" />
                    </div>
                  </th>
                  {/* Coluna 1 de vendas: SO unidades no periodo. Header curto,
                      numa linha so, com Flame visivel. Sort por qty (mais
                      vendidos primeiro). */}
                  <th
                    className="px-2 py-3 text-center text-xs"
                    title={`Unidades vendidas ${salesPeriodLabel}`}
                  >
                    <div className="inline-flex items-center justify-center gap-1">
                      <Flame className="h-3 w-3 text-orange-500" />
                      <SortBtn
                        label={`Vendas ${salesPeriodShortLabel}`}
                        col="recent_sales_qty"
                      />
                    </div>
                  </th>
                  {/* Coluna 2 de vendas: SO data da ultima venda (oculta em
                      tela pequena pra economizar espaco). Sort por data —
                      asc identifica produtos parados. */}
                  <th
                    className="px-2 py-3 text-center text-xs hidden lg:table-cell"
                    title="Data da ultima venda — sort asc lista produtos parados"
                  >
                    <div className="flex items-center justify-center">
                      <SortBtn label="Última venda" col="last_sale_date" />
                    </div>
                  </th>
                  <th className="px-2 py-3 text-center text-xs hidden lg:table-cell">
                    <div className="flex items-center justify-center">
                      <SortBtn label="Preço" col="price" />
                    </div>
                  </th>
                  <th className="px-2 py-3 text-center text-xs hidden md:table-cell">Status</th>
                  <th className="px-2 py-3 text-right text-xs">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((item) => {
                  const isLow = item.available_quantity <= 3 && item.status === "active";
                  const isOut = item.available_quantity === 0;
                  const isSelected = selectedItemIds.has(item.item_id);
                  return (
                    <tr
                      key={item.item_id}
                      className={`transition-colors ${isSelected ? "bg-primary/5" : "hover:bg-muted/30"}`}
                    >
                      <td className="px-2 py-2 text-center">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            setSelectedItemIds((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(item.item_id);
                              else next.delete(item.item_id);
                              return next;
                            });
                          }}
                          aria-label={`Selecionar ${item.title ?? item.item_id}`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          {item.thumbnail ? (
                            <img
                              src={item.thumbnail}
                              alt=""
                              className="h-8 w-8 rounded object-cover flex-shrink-0"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-8 w-8 rounded bg-muted flex items-center justify-center flex-shrink-0">
                              <Package className="h-3 w-3 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-medium truncate text-xs">{item.title ?? "—"}</p>
                            <p className="text-[10px] text-muted-foreground truncate">
                              {item.item_id}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-muted-foreground hidden sm:table-cell">
                        {item.sku ? (
                          <span className="font-mono text-xs">{item.sku}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-destructive text-[10px] font-semibold">
                            <AlertTriangle className="h-3 w-3" /> SEM SKU
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center hidden lg:table-cell">
                        {item.location_corridor || item.location_shelf || item.location_level ? (
                          <span className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-semibold">
                            <MapPin className="h-2.5 w-2.5" />
                            {[
                              item.location_corridor || "—",
                              item.location_shelf || "—",
                              item.location_level || "—",
                            ].join("•")}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      {/* Disp. centralizado pra acompanhar o header centralizado */}
                      <td className="px-2 py-2 text-center font-semibold text-xs">
                        <span
                          className={
                            isOut
                              ? "text-destructive"
                              : isLow
                              ? "text-orange-500"
                              : "text-foreground"
                          }
                        >
                          {item.available_quantity}
                          {isLow && !isOut && (
                            <TrendingDown className="inline ml-1 h-3 w-3 text-orange-500" />
                          )}
                        </span>
                      </td>
                      {/* Coluna 1: SO unidades vendidas (numero grande em laranja
                          + qtd de pedidos pequena embaixo). Centralizado. */}
                      <td className="px-2 py-2 text-center text-xs">
                        {(item.recent_sales_qty || 0) > 0 ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="inline-flex items-center gap-1 font-bold text-orange-600">
                              <Flame className="h-3 w-3" />
                              <span>{item.recent_sales_qty}</span>
                              <span className="text-[10px] font-normal text-muted-foreground">
                                un
                              </span>
                            </div>
                            {(item.recent_sales_orders || 0) > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                {item.recent_sales_orders}{" "}
                                {item.recent_sales_orders === 1 ? "ped." : "peds."}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {/* Coluna 2: SO data da ultima venda em "ha X dias",
                          oculta em telas pequenas. */}
                      <td className="px-2 py-2 text-center text-xs hidden lg:table-cell">
                        {item.last_sale_date ? (
                          <span
                            className="text-[11px] text-muted-foreground"
                            title={new Date(item.last_sale_date).toLocaleString("pt-BR")}
                          >
                            há {formatDaysAgo(item.last_sale_date)}
                          </span>
                        ) : item.sold_quantity > 0 ? (
                          <span
                            className="text-[10px] text-muted-foreground/60"
                            title={`Total cumulativo do anuncio: ${item.sold_quantity} unidades`}
                          >
                            total: {item.sold_quantity}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60 text-[10px]">
                            sem venda
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center text-xs hidden lg:table-cell">
                        {item.price != null
                          ? item.price.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })
                          : "—"}
                      </td>
                      <td className="px-2 py-2 text-center hidden md:table-cell">
                        <Badge
                          variant={
                            item.status === "active"
                              ? "default"
                              : item.status === "paused"
                              ? "secondary"
                              : "outline"
                          }
                          className="text-[10px] px-1.5"
                        >
                          {item.status ?? "—"}
                        </Badge>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex gap-0.5 justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing({ ...item })}
                            className="h-7 w-7 p-0"
                            title="Editar SKU / Localização"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmDelete(item)}
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            title="Remover do estoque local"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Dialog de edição */}
        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-5 w-5" /> Editar Produto
              </DialogTitle>
            </DialogHeader>
            {editing && (
              <div className="space-y-4 max-h-[60vh] overflow-y-auto">
                <div>
                  <Label className="text-xs text-muted-foreground">Produto</Label>
                  <p className="text-sm font-medium">{editing.title}</p>
                </div>
                <div>
                  <Label>SKU</Label>
                  <Input
                    value={editing.sku || ""}
                    onChange={(e) => setEditing({ ...editing, sku: e.target.value })}
                    placeholder="Ex: YA075"
                  />
                </div>
                <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <MapPin className="h-4 w-4" /> Localização no Depósito
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <Label>Corredor</Label>
                    <Input
                      value={editing.location_corridor || ""}
                      onChange={(e) => setEditing({ ...editing, location_corridor: e.target.value })}
                      placeholder="A"
                    />
                  </div>
                  <div>
                    <Label>Estante</Label>
                    <Input
                      value={editing.location_shelf || ""}
                      onChange={(e) => setEditing({ ...editing, location_shelf: e.target.value })}
                      placeholder="3"
                    />
                  </div>
                  <div>
                    <Label>Nível</Label>
                    <Input
                      value={editing.location_level || ""}
                      onChange={(e) => setEditing({ ...editing, location_level: e.target.value })}
                      placeholder="5"
                    />
                  </div>
                </div>
                <div>
                  <Label>Observações</Label>
                  <Input
                    value={editing.location_notes || ""}
                    onChange={(e) => setEditing({ ...editing, location_notes: e.target.value })}
                    placeholder="Ex: Gaveta B4 da estante 3"
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditing(null)}>Cancelar</Button>
              <Button onClick={handleSaveEdit} disabled={savingEdit}>
                {savingEdit ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog de confirmação de exclusão */}
        <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" /> Remover do Estoque
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Remover <strong>{confirmDelete?.title}</strong> do estoque local? O item será re-criado no próximo sync do Mercado Livre se ainda estiver ativo lá.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
              <Button variant="destructive" onClick={handleDelete}>Remover</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Dialog de selecao de colunas do relatorio de estoque */}
        <StockReportColumnsDialog
          open={columnsDialogOpen}
          onOpenChange={setColumnsDialogOpen}
          totalItems={filtered.length}
          generating={exportingPdf}
          onConfirm={(columns) => handleConfirmGenerateReport(filtered, columns)}
        />
      </div>
    </AppLayout>
  );
}
