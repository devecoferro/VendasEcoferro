import { useMemo, useState, useRef, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { useCallback } from "react";
import { useEffect } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { OrderOperationalDocumentsDialog } from "@/components/OrderOperationalDocumentsDialog";
import { MLClassificationsGrid } from "@/components/MLClassificationsGrid";
import { DepositFilterMenu } from "@/components/DepositFilterMenu";
import { VirtualizedOrderList } from "@/components/VirtualizedOrderList";
import {
  LiveSubCardsStrip,
  matchesLiveStatusFilterOnLocalOrder,
  type LiveStatusFilter,
} from "@/components/LiveSubCardsStrip";
import {
  type MLSubStatus,
  type MLStoreKey,
  getOrderSubstatus,
  getOrderPickupDateLabel,
  getOrderStoreKey,
  getOrderStoreLabel,
} from "@/services/mlSubStatusClassifier";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useExtraction } from "@/contexts/ExtractionContext";
import { useAuth } from "@/contexts/AuthContext";
import { useMercadoLivreData } from "@/hooks/useMercadoLivreData";
import { useMLLiveSnapshot } from "@/hooks/useMLLiveSnapshot";
import type { MLSnapshotScope } from "@/services/mlLiveSnapshotService";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  FileText,
  Info,
  Link2,
  Loader2,
  Receipt,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShoppingCart,
  SlidersHorizontal,
  Tag,
  Printer,
  ClipboardList,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  buildSeparationReport,
  exportSeparationPdf,
} from "@/services/separationReportService";
import {
  generateMLNFe,
  getMLNFeDocument,
  getMLOrderDocuments,
  mapMLOrdersToProcessingResults,
  mapMLOrderToSaleData,
  mapUnifiedPackSaleData,
  findOrdersInSamePack,
  getOrderPackId,
  markLabelsAsPrinted,
  markLabelsAsUnprinted,
  type MLDashboardDeposit,
  type MLNFeResponse,
  type MLOrderDocumentsResponse,
  type MLOrder,
  syncMLNFeWithMercadoLivre,
  startMLOAuth,
} from "@/services/mercadoLivreService";
// ColetasPanel removido do render em commit b88cf61. Import tambem
// removido (sprint 2.4 cleanup) — estava causando import morto.
import { exportSalePdf } from "@/services/pdfExportService";
import { enrichSalesWithLocations, fetchStockLocationsBySku } from "@/lib/stockLocation";
import {
  mergeLabelPdfs,
  openPdfBlobForPrint,
  type MergeSource,
} from "@/services/pdfMergeService";
import { SaleCardPreview } from "@/components/SaleCardPreview";
import {
  BUYER_TYPE_FILTER_OPTIONS,
  DELIVERY_FILTER_OPTIONS,
  DEFAULT_ML_FILTERS,
  INVOICE_FILTER_OPTIONS,
  SHIPMENT_BUCKET_LABELS,
  STATUS_FILTER_OPTIONS,
  buildDepositOptions,
  filterAndSortOrders,
  formatSaleMoment,
  formatShortTime,
  getBuyerType,
  getDepositInfo,
  getOperationalCardPresentation,
  getOperationalSummaryLabel,
  parseDate,
  sortDashboardDepositsForDisplay,
  getSelectedDepositLabel,
  getShipmentPresentation,
  isOrderForCollection,
  isOrderInvoicePending,
  isOrderReadyToPrintLabel,
  isOrderReadyForInvoiceLabel,
  canPrintMLShippingLabel,
  isOrderFulfillment,
  isOrderUnderReview,
  matchesOperationalSummaryRow,
  type DepositOptionPresentation,
  type FilterOptionDefinition,
  type MercadoLivreFilters,
  type OperationalSummaryFilter,
  type OperationalSummaryKey,
  type ShipmentBucket,
} from "@/services/mercadoLivreHelpers";

interface ActiveFilterChip {
  key: string;
  label: string;
  remove: () => void;
}

interface ContextFilterChip {
  key: string;
  label: string;
  removable?: boolean;
  tone?: "primary" | "neutral";
  remove?: () => void;
}

// Apenas os 4 chips que o ML Seller Center mostra — NÃO incluir "Canceladas"
// que não existe no ML e causava double-counting (pedidos cancelados apareciam
// tanto em "Canceladas" quanto em "Envios de hoje" se o shipping não atualizava).
const SHIPMENT_FILTERS: Array<{ key: ShipmentBucket; label: string }> = [
  { key: "today", label: "Envios de hoje" },
  { key: "upcoming", label: "Próximos dias" },
  { key: "in_transit", label: "Em trânsito" },
  { key: "finalized", label: "Finalizadas" },
];

type QuickSalesStatusFilter =
  | "all"
  | "ready"
  | "invoice_pending"
  | "under_review"
  | "collection";

interface QuickSalesFilters {
  dateFrom: string;
  dateTo: string;
  status: QuickSalesStatusFilter;
}

const DEFAULT_QUICK_SALES_FILTERS: QuickSalesFilters = {
  dateFrom: "",
  dateTo: "",
  status: "all",
};

const QUICK_SALES_STATUS_OPTIONS: Array<{
  value: QuickSalesStatusFilter;
  label: string;
}> = [
  { value: "all", label: "Todos" },
  { value: "ready", label: "Prontas para enviar" },
  { value: "invoice_pending", label: "NF-e sem emitir" },
  { value: "under_review", label: "Em revisão" },
  { value: "collection", label: "Para coleta" },
];

function getDashboardBucketCount(
  deposit: MLDashboardDeposit,
  bucket: ShipmentBucket
): number {
  return (
    deposit.internal_operational_counts?.[bucket] ??
    deposit.counts?.[bucket] ??
    0
  );
}

function getDashboardBucketOrderIds(
  deposit: MLDashboardDeposit,
  bucket: ShipmentBucket
): string[] {
  return (
    deposit.internal_operational_order_ids_by_bucket?.[bucket] ||
    deposit.order_ids_by_bucket?.[bucket] ||
    []
  );
}

function cloneFilters(filters: MercadoLivreFilters): MercadoLivreFilters {
  return {
    sort: filters.sort,
    buyerTypes: [...filters.buyerTypes],
    statuses: [...filters.statuses],
    deliveryForms: [...filters.deliveryForms],
    invoiceStates: [...filters.invoiceStates],
  };
}

const SORT_LABELS: Record<MercadoLivreFilters["sort"], string> = {
  sale_date_desc: "Vendas mais recentes",
  sale_date_asc: "Vendas mais antigas",
  amount_desc: "Maior valor",
  amount_asc: "Menor valor",
};

// ─── Presets de periodo pro toolbar compacto do painel Coletas ───────
type DatePreset =
  | "all"
  | "today"
  | "yesterday"
  | "last_week"
  | "this_month"
  | "last_30d";

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  all: "Todas as datas",
  today: "Hoje",
  yesterday: "Ontem",
  last_week: "Última semana",
  this_month: "Este mês",
  last_30d: "Últimos 30 dias",
};

function getDatePresetRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = iso(now);
  if (preset === "all") return { from: "", to: "" };
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const yIso = iso(y);
    return { from: yIso, to: yIso };
  }
  if (preset === "last_week") {
    const from = new Date(now); from.setDate(from.getDate() - 7);
    return { from: iso(from), to: today };
  }
  if (preset === "this_month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: iso(from), to: today };
  }
  if (preset === "last_30d") {
    const from = new Date(now); from.setDate(from.getDate() - 30);
    return { from: iso(from), to: today };
  }
  return { from: "", to: "" };
}

function createDefaultFilters(): MercadoLivreFilters {
  return cloneFilters(DEFAULT_ML_FILTERS);
}

function buildDateInputKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function matchesQuickSalesFilters(order: MLOrder, filters: QuickSalesFilters): boolean {
  if (filters.dateFrom || filters.dateTo) {
    const saleDate = parseDate(order.sale_date);
    if (!saleDate) {
      return false;
    }

    const saleDateKey = buildDateInputKey(saleDate);
    if (filters.dateFrom && saleDateKey < filters.dateFrom) {
      return false;
    }

    if (filters.dateTo && saleDateKey > filters.dateTo) {
      return false;
    }
  }

  switch (filters.status) {
    case "ready":
      return isOrderReadyToPrintLabel(order);
    case "invoice_pending":
      return isOrderInvoicePending(order);
    case "under_review":
      return isOrderUnderReview(order);
    case "collection":
      return isOrderForCollection(order);
    default:
      return true;
  }
}

function hasQuickSalesFilters(filters: QuickSalesFilters): boolean {
  return Boolean(filters.dateFrom || filters.dateTo || filters.status !== "all");
}

function buildQuickFilterSummary(filters: QuickSalesFilters): string | null {
  const parts: string[] = [];

  if (filters.dateFrom) {
    parts.push(`de ${filters.dateFrom}`);
  }

  if (filters.dateTo) {
    parts.push(`até ${filters.dateTo}`);
  }

  if (filters.status !== "all") {
    const statusLabel =
      QUICK_SALES_STATUS_OPTIONS.find((option) => option.value === filters.status)?.label ||
      filters.status;
    parts.push(statusLabel);
  }

  if (parts.length === 0) {
    return null;
  }

  return `Filtros rápidos ativos: ${parts.join(" · ")}.`;
}

function toggleMultiFilter<T extends string>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

function buildSummaryText(
  shipmentFilter: ShipmentBucket,
  filters: MercadoLivreFilters,
  contextLabels: string[]
): string {
  const parts = [
    `"${SHIPMENT_BUCKET_LABELS[shipmentFilter]}"`,
    ...contextLabels.map((label) => `"${label}"`),
  ];

  parts.push(
    ...filters.buyerTypes
      .map(
        (value) =>
          BUYER_TYPE_FILTER_OPTIONS.find((option) => option.value === value)?.label || value
      )
      .map((label) => `"${label}"`)
  );

  parts.push(
    ...filters.statuses
      .map(
        (value) => STATUS_FILTER_OPTIONS.find((option) => option.value === value)?.label || value
      )
      .map((label) => `"${label}"`)
  );

  parts.push(
    ...filters.deliveryForms
      .map(
        (value) =>
          DELIVERY_FILTER_OPTIONS.find((option) => option.value === value)?.label || value
      )
      .map((label) => `"${label}"`)
  );

  parts.push(
    ...filters.invoiceStates
      .map(
        (value) =>
          INVOICE_FILTER_OPTIONS.find((option) => option.value === value)?.label || value
      )
      .map((label) => `"${label}"`)
  );

  if (parts.length === 1) {
    return `Você está visualizando o bucket ${parts[0]} com resumo operacional interno no topo e detalhamento operacional separado nos cards abaixo.`;
  }

  return `Você está visualizando apenas filtros que combinam com ${parts.join(" e ")}, usando o resumo operacional interno no topo e regras operacionais derivadas para a distribuição abaixo.`;
}

function getActiveFilterCount(filters: MercadoLivreFilters): number {
  let count =
    filters.buyerTypes.length +
    filters.statuses.length +
    filters.deliveryForms.length +
    filters.invoiceStates.length;
  if (filters.sort !== DEFAULT_ML_FILTERS.sort) count += 1;
  return count;
}

function buildActiveFilterChips(
  filters: MercadoLivreFilters,
  setFilters: Dispatch<SetStateAction<MercadoLivreFilters>>
): ActiveFilterChip[] {
  const chips: ActiveFilterChip[] = [];

  for (const buyerType of filters.buyerTypes) {
    chips.push({
      key: `buyer:${buyerType}`,
      label: BUYER_TYPE_FILTER_OPTIONS.find((option) => option.value === buyerType)?.label || buyerType,
      remove: () =>
        setFilters((current) => ({
          ...current,
          buyerTypes: current.buyerTypes.filter((entry) => entry !== buyerType),
        })),
    });
  }

  for (const status of filters.statuses) {
    chips.push({
      key: `status:${status}`,
      label: STATUS_FILTER_OPTIONS.find((option) => option.value === status)?.label || status,
      remove: () =>
        setFilters((current) => ({
          ...current,
          statuses: current.statuses.filter((entry) => entry !== status),
        })),
    });
  }

  for (const delivery of filters.deliveryForms) {
    chips.push({
      key: `delivery:${delivery}`,
      label: DELIVERY_FILTER_OPTIONS.find((option) => option.value === delivery)?.label || delivery,
      remove: () =>
        setFilters((current) => ({
          ...current,
          deliveryForms: current.deliveryForms.filter((entry) => entry !== delivery),
        })),
    });
  }

  for (const invoiceState of filters.invoiceStates) {
    chips.push({
      key: `invoice:${invoiceState}`,
      label:
        INVOICE_FILTER_OPTIONS.find((option) => option.value === invoiceState)?.label ||
        invoiceState,
      remove: () =>
        setFilters((current) => ({
          ...current,
          invoiceStates: current.invoiceStates.filter((entry) => entry !== invoiceState),
        })),
    });
  }

  if (filters.sort !== DEFAULT_ML_FILTERS.sort) {
    chips.push({
      key: `sort:${filters.sort}`,
      label: SORT_LABELS[filters.sort],
      remove: () =>
        setFilters((current) => ({
          ...current,
          sort: DEFAULT_ML_FILTERS.sort,
        })),
    });
  }

  return chips;
}

function FilterOriginBadge({
  option,
}: {
  option: FilterOptionDefinition<string>;
}) {
  const className =
    option.origin === "native_api"
      ? "border-[#cde0ff] bg-[#eef4ff] text-[#2968c8]"
      : "border-[#ececec] bg-[#f8f8f8] text-[#666666]";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${className}`}
    >
      {option.sourceLabel}
    </span>
  );
}

// DepositFilterMenu extraído pra src/components/DepositFilterMenu.tsx (sprint 2 P2).

// VirtualizedOrderList extraído pra src/components/VirtualizedOrderList.tsx (sprint 2 P2).


export default function MercadoLivrePage() {
  const navigate = useNavigate();
  const { setResults } = useExtraction();
  const { currentUser, canAccessLocation } = useAuth();
  const {
    connection,
    orders,
    ordersPagination,
    dashboard,
    loading,
    error,
    refresh,
    syncNow,
    loadMoreOrders,
  } = useMercadoLivreData({
    autoSync: true,
    // Auto-refresh silencioso a cada 60s: SSE é o canal primário (empurrado
    // pelo backend quando auto-heal/sync roda), este intervalo só é usado
    // como fallback quando a conexão SSE cai. Com refresh silencioso, os
    // cards e totalizadores se atualizam sem piscar loading na tela.
    autoSyncIntervalMs: 60000,
    ordersScope: "operational",
    // Página grande (limite do servidor) + auto-load contínuo em background
    // para que toda a base operacional fique disponível sem o usuário ver
    // o progresso de carregamento.
    ordersLimit: 5000,
    ordersView: "dashboard",
    autoLoadAllPages: true,
  });

  // ─── Fase 2: snapshot LIVE do ML (dados 1:1 com Seller Center) ─────
  // Carrega automaticamente no mount (pega do cache do backend, TTL 2min)
  // e faz polling a cada 30s pra atualizar.
  //
  // Scope é derivado do dropdown do topo (selectedDepositFilters).
  // Cada scope tem cache independente no backend — trocar de depósito
  // dispara novo fetch (ou pega do cache se já foi carregado antes).

  const [connecting, setConnecting] = useState(false);
  // Default "upcoming" (Proximos dias) pra bater com o painel Coletas
  // por Data — antes era "today", fazia a lista ficar vazia na maioria
  // das vezes (os chips de bucket foram removidos do layout).
  const [shipmentFilter, setShipmentFilter] = useState<ShipmentBucket>("upcoming");
  const [selectedDepositFilters, setSelectedDepositFilters] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  // Filtro de etiqueta impressa: "all" mostra todos, "not_printed" so pendentes
  // (o que falta imprimir hoje), "printed" so os que ja imprimiu (auditoria).
  // Nao interfere nos chips de shipment bucket nem nas contagens do dashboard —
  // so afeta a lista exibida e o contador "(X/Y selecionadas)".
  // Filtro simples de etiqueta (view — nao altera fetch).
  // Os 3 estados do pipeline (sem NF / NF gerada / etiqueta impressa)
  // agora vivem dentro do painel Coletas por Data (cards clicaveis por
  // coleta), entao este filtro volta ao escopo original de "etiqueta
  // impressa sim/nao".
  const [labelPrintFilter, setLabelPrintFilter] = useState<
    "all" | "not_printed" | "printed"
  >("all");
  const [markingLabelsPrinted, setMarkingLabelsPrinted] = useState(false);

  // Deriva scope do live snapshot baseado no filtro de depósito do topo.
  // NOTA: multi-select (length > 1) usa "all" — não suportado ainda.
  const liveSnapshotScope = useMemo<MLSnapshotScope>(() => {
    if (selectedDepositFilters.length === 0) return "all";
    if (selectedDepositFilters.length > 1) return "all";
    const key = (selectedDepositFilters[0] || "").toLowerCase();
    if (key === "without-deposit" || key === "without_deposit") {
      return "without_deposit";
    }
    if (key === "full" || key.includes("full") || key.includes("fulfillment")) {
      return "full";
    }
    // Default: loja física (Ourinhos é a única no momento)
    return "ourinhos";
  }, [selectedDepositFilters]);

  const {
    snapshot: liveSnapshot,
    loading: liveSnapshotLoading,
    error: liveSnapshotError,
    refresh: refreshLiveSnapshot,
  } = useMLLiveSnapshot({
    enabled: true,
    pollingIntervalMs: 30_000,
    scope: liveSnapshotScope,
  });

  // ─── Filtros novos: replica visual do ML Seller Center ──────────────
  // Sub-status (Etiquetas pra imprimir, NF-e, Em processamento, etc) — clique
  // num card de SubClassificationsBar ativa este filtro pra estreitar a lista.
  const [selectedSubStatus, setSelectedSubStatus] = useState<MLSubStatus | null>(null);
  // Pickup group (Hoje, Amanha, Quarta-feira, A partir de 23 de abril) usado
  // junto com o sub-status quando o card e do tipo "Coleta | <dia>".
  const [selectedPickupGroup, setSelectedPickupGroup] = useState<string | null>(null);
  // Filtro por célula do ColetasPanel: quando user clica num card
  // (ex: "NFs SEM GERAR LO · Coleta 23/04"), filtra a lista abaixo
  // pros order_ids daquela célula. null = sem filtro de célula.
  const [cellFilterOrderIds, setCellFilterOrderIds] = useState<Set<string> | null>(null);
  // Store (Mercado Envios Full vs outras lojas) — substitui visualmente o
  // filtro de "loja" do ML. Default "all" mostra tudo somado igual hoje.
  const [selectedStore, setSelectedStore] = useState<MLStoreKey | "all">("all");
  // Filtro do live snapshot: quando user clica num pill do LiveSubCardsStrip
  // (ex: "Etiqueta pronta 37", "Coleta 23 de abril 2"), filtra a lista abaixo
  // pra mostrar só pedidos com aquele status_text. Toggle ao clicar de novo.
  const [selectedLiveStatusFilter, setSelectedLiveStatusFilter] =
    useState<LiveStatusFilter | null>(null);

  // Reset dos sub-filtros quando trocar de bucket — sub-status e relativo
  // ao bucket atual (ready_to_print so existe em "upcoming" por exemplo).
  // Refaz a logica do effect fica em useEffect mais abaixo (depende de
  // shipmentFilter declarado acima).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<MercadoLivreFilters>(createDefaultFilters());
  const [draftFilters, setDraftFilters] = useState<MercadoLivreFilters>(createDefaultFilters());
  const [draftQuickFilters, setDraftQuickFilters] = useState<QuickSalesFilters>(
    DEFAULT_QUICK_SALES_FILTERS
  );
  const [appliedQuickFilters, setAppliedQuickFilters] = useState<QuickSalesFilters>(
    DEFAULT_QUICK_SALES_FILTERS
  );
  // Preset de período do toolbar compacto no painel Coletas. Muda os
  // dateFrom/dateTo do draftQuickFilters automaticamente ao selecionar.
  const [datePreset, setDatePreset] = useState<DatePreset>("all");
  const [operationalFocus, setOperationalFocus] = useState<OperationalSummaryFilter | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [bulkPrintingMl, setBulkPrintingMl] = useState(false);
  const [bulkGeneratingNFe, setBulkGeneratingNFe] = useState(false);
  const [generatingSeparation, setGeneratingSeparation] = useState(false);
  // Estados per-order para os botoes "Gerar NF-e" e "Etiqueta ML + DANFe"
  // no card — evitam o spinner global dos botoes em lote e deixam claro
  // qual pedido especifico esta sendo processado.
  const [generatingNFeForOrderId, setGeneratingNFeForOrderId] = useState<string | null>(null);
  const [printingLabelForOrderId, setPrintingLabelForOrderId] = useState<string | null>(null);
  const [documentsDialogOpen, setDocumentsDialogOpen] = useState(false);
  const [documentsOrder, setDocumentsOrder] = useState<MLOrder | null>(null);
  const [orderDocuments, setOrderDocuments] = useState<MLOrderDocumentsResponse | null>(null);
  const [orderDocumentsLoading, setOrderDocumentsLoading] = useState(false);
  const [orderDocumentsError, setOrderDocumentsError] = useState<string | null>(null);
  const [orderNFe, setOrderNFe] = useState<MLNFeResponse | null>(null);
  const [orderNFeLoading, setOrderNFeLoading] = useState(false);
  const [orderNFeError, setOrderNFeError] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const url = await startMLOAuth();
      window.location.href = url;
    } catch (caughtError) {
      toast.error(
        caughtError instanceof Error
          ? caughtError.message
          : "Erro ao iniciar a conexão com o Mercado Livre."
      );
      setConnecting(false);
    }
  };

  const handleRetryLoad = async () => {
    try {
      // Dispara SYNC com o ML (puxa pedidos novos pro banco local),
      // nao so refresh (que apenas refaz a query local). Fix 2026-04-24:
      // antes so chamava refresh() — quando ML tinha pedido novo que
      // o app ainda nao tinha, o botao "Sincronizar agora" nao
      // resolvia porque nao forcava um fetch do ML.
      toast.info("Sincronizando com o Mercado Livre...");
      await syncNow({ forceFullSync: true });
      toast.success("Sincronização concluída.");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Falha ao sincronizar.";
      toast.error(msg);
    }
  };

  const handleGenerateLabels = useCallback((ordersToReview: MLOrder[]) => {
    if (ordersToReview.length === 0) {
      toast.info("Nenhum pedido disponível para gerar etiqueta.");
      return;
    }

    setResults(mapMLOrdersToProcessingResults(ordersToReview));
    toast.success(`${ordersToReview.length} pedido(s) enviados para conferência.`);
    navigate("/review");
  }, [navigate, setResults]);

  const loadOrderDocuments = useCallback(
    async (order: MLOrder, options: { refresh?: boolean } = {}) => {
      setOrderDocumentsLoading(true);
      setOrderDocumentsError(null);

      try {
        const payload = await getMLOrderDocuments(order.order_id, options);
        setOrderDocuments(payload);
      } catch (caughtError) {
        setOrderDocumentsError(
          caughtError instanceof Error
            ? caughtError.message
            : "Falha ao carregar os documentos operacionais."
        );
      } finally {
        setOrderDocumentsLoading(false);
      }
    },
    []
  );

  const loadOrderNFe = useCallback(
    async (order: MLOrder, options: { refresh?: boolean } = {}) => {
      setOrderNFeLoading(true);
      setOrderNFeError(null);

      try {
        const payload = await getMLNFeDocument(order.order_id, options);
        setOrderNFe(payload);
      } catch (caughtError) {
        setOrderNFeError(
          caughtError instanceof Error ? caughtError.message : "Falha ao carregar a NF-e."
        );
      } finally {
        setOrderNFeLoading(false);
      }
    },
    []
  );

  const handleOpenDocumentsDialog = useCallback(
    (order: MLOrder) => {
      setDocumentsOrder(order);
      setOrderDocuments(null);
      setOrderDocumentsError(null);
      setOrderNFe(null);
      setOrderNFeError(null);
      setDocumentsDialogOpen(true);
      void loadOrderDocuments(order);
      void loadOrderNFe(order);
    },
    [loadOrderDocuments, loadOrderNFe]
  );

  const handleRefreshDocuments = useCallback(() => {
    if (!documentsOrder) return;
    void loadOrderDocuments(documentsOrder, { refresh: true });
  }, [documentsOrder, loadOrderDocuments]);

  const handleRefreshOrderNFe = useCallback(() => {
    if (!documentsOrder) return;
    void loadOrderNFe(documentsOrder, { refresh: true });
  }, [documentsOrder, loadOrderNFe]);

  const handleGenerateOrderNFe = useCallback(async () => {
    if (!documentsOrder) return;

    setOrderNFeLoading(true);
    setOrderNFeError(null);

    try {
      const payload = await generateMLNFe(documentsOrder.order_id);
      setOrderNFe(payload);

      if (payload.action === "generate_failed") {
        toast.error(payload.nfe.note);
      } else if (payload.action === "blocked") {
        toast.info(payload.nfe.note);
      } else if (payload.action === "noop_existing_invoice") {
        toast.success("NF-e ja localizada para este pedido.");
      } else {
        toast.success(payload.nfe.note);
      }

      void loadOrderDocuments(documentsOrder, { refresh: true });
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Falha ao solicitar a emissao da NF-e.";
      setOrderNFeError(message);
      toast.error(message);
    } finally {
      setOrderNFeLoading(false);
    }
  }, [documentsOrder, loadOrderDocuments]);

  const handleSyncOrderNFe = useCallback(async () => {
    if (!documentsOrder) return;

    setOrderNFeLoading(true);
    setOrderNFeError(null);

    try {
      const payload = await syncMLNFeWithMercadoLivre(documentsOrder.order_id);
      setOrderNFe(payload);
      toast.success(payload.nfe.note);
      void loadOrderDocuments(documentsOrder, { refresh: true });
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Falha ao sincronizar a NF-e com o Mercado Livre.";
      setOrderNFeError(message);
      toast.error(message);
    } finally {
      setOrderNFeLoading(false);
    }
  }, [documentsOrder, loadOrderDocuments]);

  const handleOpenInternalLabelFlow = useCallback(() => {
    setDocumentsDialogOpen(false);
    if (documentsOrder) {
      handleGenerateLabels([documentsOrder]);
      return;
    }
    navigate("/review");
  }, [documentsOrder, handleGenerateLabels, navigate]);

  const handleToggleSelectOrder = useCallback((orderId: string) => {
    setSelectedOrderIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  }, []);

  const enrichSaleWithLocations = useCallback(async (sale: ReturnType<typeof mapMLOrderToSaleData>) => {
    const [enriched] = await enrichSalesWithLocations([sale]);
    return enriched ?? sale;
  }, []);

  // Ref com os orders atuais — atualizada via useEffect abaixo, depois que
  // permittedOrders é declarado. Evita TDZ (Cannot access before initialization).
  const permittedOrdersRef = useRef<MLOrder[]>([]);

  const handlePrintInternalLabelEcoferro = useCallback(async (order: MLOrder) => {
    try {
      // Busca todos os orders do mesmo pack e unifica em uma só etiqueta.
      // Se não tem pack ou tem só 1 order no pack, comporta-se normal.
      const packOrders = findOrdersInSamePack(order, permittedOrdersRef.current);
      const sale = mapUnifiedPackSaleData(packOrders);
      const enriched = await enrichSaleWithLocations(sale);
      await exportSalePdf(enriched);
    } catch (caughtError) {
      toast.error(
        caughtError instanceof Error
          ? caughtError.message
          : "Falha ao gerar a etiqueta interna Ecoferro."
      );
    }
  }, [enrichSaleWithLocations]);

  const handlePrintMlLabelsAndNFeBulk = useCallback(
    async (ordersToPrint: MLOrder[]) => {
      if (ordersToPrint.length === 0) {
        toast.info("Selecione pelo menos um pedido.");
        return;
      }
      setBulkPrintingMl(true);
      try {
        // ── Busca documentos com concorrencia BAIXA ─────────────────────
        // Cada chamada getMLOrderDocuments faz ate 7 requests a API ML
        // (etiqueta + NF-e + downloads de binarios). Com muitas concorrentes,
        // o ML faz rate limiting e rejeita tudo.
        // Concorrencia 3 + delay entre batches = seguro para 100+ pedidos.
        const DOC_CONCURRENCY = 3;
        const BATCH_DELAY_MS = 300; // pequeno delay entre batches pra nao saturar
        const docResults: { order: MLOrder; shippingUrl: string | null; danfeUrl: string | null }[] = [];
        let docFetchFailed = 0;

        for (let i = 0; i < ordersToPrint.length; i += DOC_CONCURRENCY) {
          const batch = ordersToPrint.slice(i, i + DOC_CONCURRENCY);
          const batchResults = await Promise.allSettled(
            batch.map(async (order) => {
              const docs = await getMLOrderDocuments(order.order_id);
              return {
                order,
                shippingUrl:
                  docs?.shipping_label_external?.print_url ||
                  docs?.shipping_label_external?.download_url ||
                  docs?.shipping_label_external?.view_url ||
                  null,
                danfeUrl:
                  docs?.invoice_nfe_document?.danfe_print_url ||
                  docs?.invoice_nfe_document?.danfe_download_url ||
                  docs?.invoice_nfe_document?.danfe_view_url ||
                  null,
              };
            })
          );
          for (const r of batchResults) {
            if (r.status === "fulfilled") {
              docResults.push(r.value);
            } else {
              docFetchFailed += 1;
            }
          }
          // Delay entre batches para nao saturar ML API
          if (i + DOC_CONCURRENCY < ordersToPrint.length) {
            await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
          }
        }

        // ── Monta sources para merge ────────────────────────────────────
        // Etiqueta ML e por PACK (envio), nao por pedido.
        // Pedidos no mesmo pack compartilham a mesma URL de etiqueta.
        // A deduplicacao por URL (em normalizeSources) evita imprimir
        // a mesma etiqueta duas vezes.
        // DANFe (NF-e) e geralmente por pedido — cada um tem URL propria.
        const labelSources: MergeSource[] = [];
        let withEtiqueta = 0;
        let withDanfe = 0;
        let withoutDocs = 0;
        for (const { shippingUrl, danfeUrl } of docResults) {
          if (shippingUrl && danfeUrl) {
            labelSources.push({ url: shippingUrl, maxPages: 1 });
            labelSources.push({ url: danfeUrl, maxPages: 1 });
            withEtiqueta++;
            withDanfe++;
          } else if (shippingUrl) {
            // Sem DANFe — pega ate 2 paginas do PDF ML (etiqueta + DANFe combinada)
            labelSources.push({ url: shippingUrl, maxPages: 2 });
            withEtiqueta++;
          } else if (danfeUrl) {
            labelSources.push({ url: danfeUrl, maxPages: 1 });
            withDanfe++;
          } else {
            withoutDocs += 1;
          }
        }

        if (labelSources.length === 0) {
          toast.warning("Nenhum pedido tem etiqueta/DANFe disponivel para impressao.");
          return;
        }

        const result = await mergeLabelPdfs(labelSources);

        if (result.includedSources === 0) {
          const firstError = result.errors[0]?.reason || "erro desconhecido";
          toast.error(
            `Falha ao ler os PDFs das etiquetas (${result.errors.length} erro(s): ${firstError}).`
          );
          return;
        }

        openPdfBlobForPrint(
          result.mergedPdf,
          `etiquetas-ml-${new Date().toISOString().slice(0, 10)}.pdf`
        );

        // Mensagem detalhada para o operador entender a composicao do PDF
        const totalOrders = ordersToPrint.length;
        const pageCount = result.includedSources;
        toast.success(
          `${totalOrders} pedido(s): ${withEtiqueta} etiqueta(s) + ${withDanfe} DANFe(s) → ${pageCount} pagina(s) no PDF`
        );

        if (result.errors.length > 0) {
          toast.warning(
            `${result.errors.length} PDF(s) nao foram baixados (rede ou formato).`
          );
        }
        if (docFetchFailed > 0) {
          toast.warning(
            `${docFetchFailed} pedido(s) falharam ao buscar documentos no ML.`
          );
        }
        if (withoutDocs > 0) {
          toast.warning(
            `${withoutDocs} pedido(s) sem etiqueta e sem DANFe no ML.`
          );
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Falha ao gerar etiquetas em lote."
        );
      } finally {
        setBulkPrintingMl(false);
      }
    },
    []
  );

  // Gera relatorio de separacao (picking list) agrupado por SKU.
  // O operador usa para ir ao estoque e separar os produtos dos pedidos
  // selecionados — cada produto aparece uma unica vez com a quantidade total.
  const handleGenerateSeparationReport = useCallback(
    async (ordersForReport: MLOrder[]) => {
      if (ordersForReport.length === 0) {
        toast.info("Selecione pelo menos um pedido.");
        return;
      }
      setGeneratingSeparation(true);
      try {
        const items = buildSeparationReport(ordersForReport);
        if (items.length === 0) {
          toast.warning("Nenhum produto encontrado nos pedidos selecionados.");
          return;
        }

        const skus = items.map((i) => i.sku).filter((s) => s && s !== "-");
        const locations = await fetchStockLocationsBySku(skus);
        for (const item of items) {
          const loc = locations[item.sku];
          if (loc) {
            item.locationCorridor = loc.corridor;
            item.locationShelf = loc.shelf;
            item.locationLevel = loc.level;
          }
        }

        const today = new Date().toISOString().slice(0, 10);
        await exportSeparationPdf(items, {
          date: today,
          totalOrders: ordersForReport.length,
        });
        const totalQty = items.reduce((s, i) => s + i.totalQuantity, 0);
        toast.success(
          `Relatorio de separacao: ${items.length} produto(s), ${totalQty} unidade(s) de ${ordersForReport.length} pedido(s).`
        );
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Falha ao gerar relatorio de separacao."
        );
      } finally {
        setGeneratingSeparation(false);
      }
    },
    []
  );

  // Marca manualmente as etiquetas dos pedidos selecionados como impressas
  // ou pendentes. A marcacao automatica acontece ao baixar o PDF via
  // /review; esses botoes cobrem os casos de:
  //   - O operador imprimiu em outro lugar (fora do sistema) e so quer
  //     atualizar o status para sair da lista "Sem etiqueta impressa".
  //   - O operador marcou errado ou precisa reimprimir — desmarcar
  //     devolve o pedido para a fila.
  const handleMarkSelectedLabels = useCallback(
    async (orders: MLOrder[], mode: "printed" | "unprinted") => {
      if (orders.length === 0) {
        toast.info("Selecione ao menos um pedido.");
        return;
      }
      setMarkingLabelsPrinted(true);
      try {
        const orderIds = Array.from(
          new Set(orders.map((o) => o.order_id).filter(Boolean))
        );
        const affected =
          mode === "printed"
            ? await markLabelsAsPrinted(orderIds)
            : await markLabelsAsUnprinted(orderIds);
        toast.success(
          mode === "printed"
            ? `${affected} etiqueta(s) marcada(s) como impressa(s).`
            : `${affected} etiqueta(s) devolvida(s) para a fila.`
        );
        void refresh();
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Falha ao atualizar o status das etiquetas."
        );
      } finally {
        setMarkingLabelsPrinted(false);
      }
    },
    [refresh]
  );

  // Gera a NF-e de um unico pedido direto do card, sem abrir o dialog
  // de documentos. Reusa a mesma rota que o dialog chama, porem atualiza
  // a listagem operacional no final para refletir a mudanca de status.
  const handleGenerateSingleOrderNFe = useCallback(
    async (order: MLOrder) => {
      setGeneratingNFeForOrderId(order.order_id);
      try {
        const payload = await generateMLNFe(order.order_id);
        if (payload.action === "generate_failed") {
          toast.error(payload.nfe.note);
        } else if (payload.action === "blocked") {
          toast.info(payload.nfe.note);
        } else if (payload.action === "noop_existing_invoice") {
          toast.success("NF-e ja localizada para este pedido.");
        } else {
          toast.success(payload.nfe.note);
        }
        void refresh();
      } catch (caughtError) {
        toast.error(
          caughtError instanceof Error
            ? caughtError.message
            : "Falha ao solicitar a emissao da NF-e."
        );
      } finally {
        setGeneratingNFeForOrderId(null);
      }
    },
    [refresh]
  );

  // Emite NF-e em lote para os pedidos selecionados que ainda nao tem
  // NF-e anexada. Processa em serie (ML trava se forem feitas em paralelo)
  // e contabiliza sucessos/falhas pra um unico toast de resumo no final.
  const handleGenerateNFeBulk = useCallback(
    async (ordersToGenerate: MLOrder[]) => {
      const targets = ordersToGenerate.filter(isOrderInvoicePending);
      if (targets.length === 0) {
        toast.info("Nenhum pedido pendente de NF-e na selecao.");
        return;
      }

      setBulkGeneratingNFe(true);
      let okCount = 0;
      let skipped = 0;
      let failed = 0;
      try {
        for (const order of targets) {
          try {
            const payload = await generateMLNFe(order.order_id);
            if (payload.action === "generate_failed") {
              failed += 1;
            } else if (payload.action === "blocked") {
              skipped += 1;
            } else {
              okCount += 1;
            }
          } catch {
            failed += 1;
          }
        }
        const parts: string[] = [];
        if (okCount > 0) parts.push(`${okCount} NF-e emitida(s)`);
        if (skipped > 0) parts.push(`${skipped} bloqueada(s)`);
        if (failed > 0) parts.push(`${failed} com erro`);
        const summary = parts.length > 0 ? parts.join(" • ") : "Nenhuma alteracao";
        if (failed > 0 && okCount === 0) {
          toast.error(summary);
        } else if (okCount > 0) {
          toast.success(summary);
        } else {
          toast.info(summary);
        }
        void refresh();
      } finally {
        setBulkGeneratingNFe(false);
      }
    },
    [refresh]
  );

  // Imprime etiqueta ML + DANFe de um unico pedido direto do card. Mantem
  // o spinner local (per-order) alem do estado global de bulk para nao
  // travar outros botoes do banner enquanto um card individual imprime.
  const handlePrintSingleOrderMlLabel = useCallback(
    async (order: MLOrder) => {
      setPrintingLabelForOrderId(order.order_id);
      try {
        await handlePrintMlLabelsAndNFeBulk([order]);
      } finally {
        setPrintingLabelForOrderId(null);
      }
    },
    [handlePrintMlLabelsAndNFeBulk]
  );


  const handleDepositToggle = (value: string) => {
    // Brief 2026-04-27: selecao unica. Antes era array com toggle multiplo
    // (clicar Ourinhos + Full mantinha os 2). Agora clicar num deposito
    // desmarca os outros — mesmo comportamento do dropdown do ML.
    setSelectedDepositFilters((current) =>
      current.length === 1 && current[0] === value ? [] : [value]
    );
    setOperationalFocus(null);
  };

  const handleDepositReset = () => {
    setSelectedDepositFilters([]);
    setOperationalFocus(null);
  };

  const handleShipmentBucketSelect = (value: ShipmentBucket) => {
    setShipmentFilter(value);
    setOperationalFocus(null);
  };

  const handleOperationalSummarySelect = (
    depositKey: string,
    summaryKey: OperationalSummaryKey
  ) => {
    setSelectedDepositFilters([depositKey]);
    setOperationalFocus((current) =>
      current?.depositKey === depositKey && current.summaryKey === summaryKey
        ? null
        : { depositKey, summaryKey }
    );
  };

  const permittedOrders = useMemo(
    () => orders.filter((order) => canAccessLocation(getDepositInfo(order).label)),
    [canAccessLocation, orders]
  );
  // Mantém ref sincronizada para handlers que usam permittedOrders
  // sem incluí-lo no array de deps (evita TDZ por hoisting).
  permittedOrdersRef.current = permittedOrders;

  // Orders escopados pelo filtro de deposito do topo (DepositFilterMenu),
  // sem filtrar por bucket/shipmentFilter. Alimenta o ColetasPanel, que
  // internamente reclassifica por bucket primario (today/upcoming) e
  // por pipeline state (sem_gerar_lo / nf_gerada / etiqueta_impressa).
  const coletasScopedOrders = useMemo(() => {
    if (selectedDepositFilters.length === 0) return permittedOrders;
    return permittedOrders.filter((order) =>
      selectedDepositFilters.includes(getDepositInfo(order).key)
    );
  }, [permittedOrders, selectedDepositFilters]);

  const orderMap = useMemo(
    () => new Map(permittedOrders.map((order) => [order.id, order])),
    [permittedOrders]
  );

  const allowWithoutDeposit =
    canAccessLocation("Vendas sem deposito") || canAccessLocation("Vendas sem depósito");

  const accessibleDashboardDeposits = useMemo(() => {
    const deposits = dashboard?.deposits || [];
    if (currentUser?.role === "admin") return deposits;

    return deposits.filter(
      (deposit) =>
        canAccessLocation(deposit.label) ||
        (deposit.key === "without-deposit" && allowWithoutDeposit)
      );
  }, [allowWithoutDeposit, canAccessLocation, currentUser?.role, dashboard?.deposits]);

  const depositOptions = useMemo(() => {
    const orderOptions = buildDepositOptions(permittedOrders);

    // Sempre inclui deposits do dashboard payload — antes era usado apenas
    // como fallback (quando orderOptions vazio), o que escondia o filtro
    // "Full" sempre que a lista de orders na aba atual nao tinha nenhum
    // pedido fulfillment. Bug reportado em 2026-04-25 ("ta faltando o
    // Filtron FULL"). Fix: merge SEMPRE — Full visivel mesmo quando
    // a aba selecionada nao tem fulfillment orders no momento.
    const fromDashboard = accessibleDashboardDeposits.map((deposit) => ({
      key: deposit.key,
      label: deposit.label,
      displayLabel:
        deposit.key === "without-deposit"
          ? "Vendas sem depósito"
          : deposit.logistic_type === "fulfillment"
            ? "Full"
            : deposit.label,
      isFulfillment: deposit.logistic_type === "fulfillment",
      kind:
        deposit.key === "without-deposit"
          ? ("without-deposit" as const)
          : ("deposit" as const),
    }));

    const dashboardKeys = new Set(fromDashboard.map((o) => o.key));
    const extraFromOrders = orderOptions.filter((o) => !dashboardKeys.has(o.key));
    const baseOptions = [...fromDashboard, ...extraFromOrders];

    // Whitelist: só "Vendas sem depósito", "Ourinhos Rua Dario Alonso" e "Full".
    // Filtra códigos brutos do ML (ex.: BRP750438981) que vinham listados.
    return baseOptions.filter((option) => {
      if (option.kind === "without-deposit") return true;
      if (option.isFulfillment) return true;
      const normalized = (option.displayLabel || option.label || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return normalized.includes("ourinhos") || normalized.includes("dario alonso");
    });
  }, [accessibleDashboardDeposits, permittedOrders]);

  useEffect(() => {
    const availableKeys = new Set(accessibleDashboardDeposits.map((deposit) => deposit.key));
    setSelectedDepositFilters((current) =>
      current.filter((depositKey) => availableKeys.has(depositKey))
    );
  }, [accessibleDashboardDeposits]);

  useEffect(() => {
    if (!operationalFocus) return;

    const availableKeys = new Set(accessibleDashboardDeposits.map((deposit) => deposit.key));
    if (!availableKeys.has(operationalFocus.depositKey)) {
      setOperationalFocus(null);
      return;
    }

    if (
      selectedDepositFilters.length > 0 &&
      !selectedDepositFilters.includes(operationalFocus.depositKey)
    ) {
      setOperationalFocus(null);
    }
  }, [accessibleDashboardDeposits, operationalFocus, selectedDepositFilters]);

  const selectedDashboardDeposits = useMemo(() => {
    if (selectedDepositFilters.length === 0) return accessibleDashboardDeposits;
    return accessibleDashboardDeposits.filter((deposit) =>
      selectedDepositFilters.includes(deposit.key)
    );
  }, [accessibleDashboardDeposits, selectedDepositFilters]);

  // ─── Snapshot escopado (Fase 2 — scope agora é aplicado no BACKEND) ──
  // O backend faz scrape por escopo (all / without_deposit / full /
  // ourinhos) e cacheia cada um independentemente. Aqui só aliasamos
  // scopedLiveSnapshot = liveSnapshot (que já vem do escopo correto).
  //
  // Vantagem: números 1:1 com ML pra qualquer escopo (não mais limitado
  // aos 50 primeiros da primeira página). Desvantagem: primeira troca
  // de escopo dispara scrape novo (~90s), depois fica em cache.
  const scopedLiveSnapshot = liveSnapshot;

  // Contagens dos chips: ML LIVE como fonte de verdade (pack-deduplicated).
  // Fallback para contagem local se ML API indisponível.
  const shipmentCounts = useMemo(() => {
    // Contagem local (fallback) — só os 4 buckets do ML Seller Center
    const localCounts = SHIPMENT_FILTERS.reduce<Record<string, number>>(
      (accumulator, currentFilter) => {
        accumulator[currentFilter.key] = selectedDashboardDeposits.reduce(
          (total, deposit) => total + getDashboardBucketCount(deposit, currentFilter.key),
          0
        );
        return accumulator;
      },
      { today: 0, upcoming: 0, in_transit: 0, finalized: 0 }
    ) as Record<ShipmentBucket, number>;

    // Hierarquia de fontes pros chips (maior prioridade primeiro):
    // 1. liveSnapshot.counters — Fase 2, scraper Playwright via clicks (100% 1:1 ML) ⭐
    // 2. ml_ui_chip_counts — scraper headless antigo
    // 3. ml_live_chip_counts — nossa API ML (~95% alinhado)
    // 4. localCounts — classificação interna do app (fallback final)

    // #1: Live snapshot (Fase 2) — fonte de verdade 1:1 com o Seller Center.
    // Usa a versão ESCOPADA pelo filtro de depósito do topo (Vendas sem
    // depósito / Ourinhos / Full). Quando scope é "all" (nenhum filtro),
    // scopedLiveSnapshot é igual ao liveSnapshot original.
    if (
      scopedLiveSnapshot?.counters &&
      typeof scopedLiveSnapshot.counters.today === "number"
    ) {
      return {
        today: scopedLiveSnapshot.counters.today,
        upcoming: scopedLiveSnapshot.counters.upcoming,
        in_transit: scopedLiveSnapshot.counters.in_transit,
        finalized: scopedLiveSnapshot.counters.finalized,
        cancelled: 0,
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uiCounts = (dashboard as any)?.ml_ui_chip_counts as
      | { today: number; upcoming: number; in_transit: number; finalized: number }
      | null
      | undefined;
    if (uiCounts && typeof uiCounts.today === "number") {
      return {
        today: uiCounts.today,
        upcoming: uiCounts.upcoming,
        in_transit: uiCounts.in_transit,
        finalized: uiCounts.finalized,
        cancelled: 0,
      };
    }

    const liveCounts = dashboard?.ml_live_chip_counts;
    if (liveCounts && typeof liveCounts.today === "number") {
      return {
        today: liveCounts.today,
        upcoming: liveCounts.upcoming,
        in_transit: liveCounts.in_transit,
        finalized: liveCounts.finalized,
        cancelled: 0,
      };
    }

    return localCounts;
  }, [selectedDashboardDeposits, dashboard, scopedLiveSnapshot]);

  // Indicadores de fonte dos chips — usado pra mostrar badge de staleness.
  const chipMeta = useMemo(() => {
    if (scopedLiveSnapshot?.counters && typeof scopedLiveSnapshot.counters.today === "number") {
      return { source: "live_snapshot" as const, stale: false, ageSeconds: null };
    }
    if (dashboard?.ml_ui_chip_counts && typeof dashboard.ml_ui_chip_counts.today === "number") {
      return {
        source: "ml_ui" as const,
        stale: Boolean(dashboard.ml_ui_chip_counts_stale),
        ageSeconds: dashboard.ml_ui_chip_counts_age_seconds ?? null,
      };
    }
    if (dashboard?.ml_live_chip_counts && typeof dashboard.ml_live_chip_counts.today === "number") {
      return { source: "ml_live" as const, stale: false, ageSeconds: null };
    }
    return { source: "local" as const, stale: false, ageSeconds: null };
  }, [dashboard, scopedLiveSnapshot]);

  // IDs dos pedidos que compõem a lista abaixo do chip selecionado.
  //
  // FONTE DE VERDADE: ml_live_chip_order_ids_by_bucket (ML Seller Center).
  // Quando o backend consegue a classificação LIVE do ML, esses IDs alimentam
  // tanto o NÚMERO do chip (ml_live_chip_counts) quanto a LISTA exibida —
  // mantendo paridade 1:1 com o ML Seller Center.
  //
  // FALLBACK LOCAL: se o ML API falhar/timeout, cai na classificação interna
  // por depósito. Nesse modo, o número do chip e a lista também caem juntos
  // para o fallback local, então continuam coerentes entre si (apenas podem
  // divergir do ML Seller Center até a próxima sincronização).
  //
  // FILTRO POR DEPÓSITO: quando o usuário seleciona depósitos específicos,
  // intersectamos os IDs ML com o escopo local do depósito. Os counts dos
  // chips continuam globais (ML não filtra por depósito) — esse comportamento
  // é o mesmo do /ml-diagnostics, onde counts são globais e breakdown
  // local filtra.
  const operationalOrderIds = useMemo(() => {
    const liveIds = dashboard?.ml_live_chip_order_ids_by_bucket?.[shipmentFilter];

    // Escopo local do depósito (sempre calculado para servir de fallback robusto).
    // Vem de deposit.order_ids_by_bucket que é populado pela classificação
    // interna do app por depósito, então sempre tem info de depósito.
    const localScope = new Set<string>();
    for (const deposit of selectedDashboardDeposits) {
      for (const id of getDashboardBucketOrderIds(deposit, shipmentFilter)) {
        localScope.add(id);
      }
    }

    // FASE 2 (2026-04-20): IDs vindos do live snapshot do ML Seller Center
    // (pack_id + order_id dos pedidos capturados via scraper Playwright).
    // São a fonte de verdade 1:1 com o ML — priorizamos eles sobre o
    // ml_live_chip_order_ids_by_bucket do dashboard antigo.
    // Usa a versão ESCOPADA pelo filtro de depósito do topo.
    const snapshotIds = new Set<string>();
    const snapshotOrders = scopedLiveSnapshot?.orders?.[shipmentFilter];
    if (Array.isArray(snapshotOrders)) {
      for (const o of snapshotOrders) {
        if (o.pack_id) snapshotIds.add(String(o.pack_id));
        if (o.order_id) snapshotIds.add(String(o.order_id));
      }
    }

    // Brief 2026-04-28: quando deposit filter ativo, PRIORIZA localScope
    // sempre. Razao: pack_id no DB local eh null pra essa conta, entao a
    // intersecao snapshot ∩ localScope sempre da 0 (formatos diferentes:
    // snapshot tem pack_id puro, localScope tem "pack_id:item_id"). O
    // snapshot eh fonte de verdade pros COUNTS (cards) mas a LISTA de
    // pedidos vem do DB local que tem o conjunto completo + dados
    // detalhados (NF-e emitida, etiqueta impressa, etc).
    if (selectedDepositFilters.length > 0 && localScope.size > 0) {
      return localScope;
    }
    if (snapshotIds.size > 0) {
      if (selectedDepositFilters.length > 0) {
        // selectedDepositFilters > 0 mas localScope.size === 0:
        // fallback pra snapshot (raro — depósito sem pedidos no DB).
        return snapshotIds;
      }
      return snapshotIds;
    }

    if (Array.isArray(liveIds) && liveIds.length > 0) {
      const ids = new Set<string>(liveIds);
      // Se houver filtro de depósito ativo, restringimos aos pedidos que
      // também estão no escopo local desse depósito.
      if (selectedDepositFilters.length > 0) {
        const intersected = new Set<string>([...ids].filter((id) => localScope.has(id)));

        // CORREÇÃO (2026-04-20): se a intersecção é 0 mas o escopo local tem
        // pedidos, usa o escopo local. Cenário: ML live retorna IDs que ainda
        // não foram sincronizados no banco local OU classifica diferente do
        // depósito local (ex: ML diz "today", local diz "upcoming"). Sem isso,
        // o operador via "0 vendas" mesmo com 106 no chip — o que aconteceu
        // após o redeploy de 36c5770.
        if (intersected.size === 0 && localScope.size > 0) {
          return localScope;
        }
        return intersected;
      }
      return ids;
    }

    // Fallback: nenhum live ID disponível, usa escopo local
    return localScope;
  }, [dashboard, selectedDashboardDeposits, selectedDepositFilters, shipmentFilter, scopedLiveSnapshot]);

  // P5: mapa único ID → bucket computado 1x por snapshot. Reaproveitado
  // pra derivar tanto o "qual bucket é do atual" quanto "qual está em
  // outros". Evita iterar scopedLiveSnapshot.orders duas vezes.
  const snapshotBucketByOrderId = useMemo(() => {
    const map = new Map<string, string>();
    if (!scopedLiveSnapshot?.orders) return map;
    for (const [bucket, orders] of Object.entries(scopedLiveSnapshot.orders)) {
      if (!Array.isArray(orders)) continue;
      for (const o of orders) {
        if (o.pack_id) map.set(String(o.pack_id), bucket);
        if (o.order_id) map.set(String(o.order_id), bucket);
      }
    }
    return map;
  }, [scopedLiveSnapshot]);

  // IDs que o snapshot LIVE do ML classificou em OUTROS buckets (≠ shipmentFilter).
  // Usado pra SUBTRAIR do bucket atual quando o ML UI scraper já moveu o pedido.
  // Cenário coberto (descoberto em 2026-04-23, pedido 2000016018511684):
  //   - DB local: substatus=in_packing_list → classifier manda pra today
  //   - ML API /orders/search: idem (API retorna estado stale)
  //   - ML UI scraper: pedido em "A caminho" (in_transit)
  const orderIdsInOtherSnapshotBuckets = useMemo(() => {
    const out = new Set<string>();
    for (const [id, bucket] of snapshotBucketByOrderId) {
      if (bucket !== shipmentFilter) out.add(id);
    }
    return out;
  }, [snapshotBucketByOrderId, shipmentFilter]);

  const bucketOrders = useMemo(() => {
    if (operationalOrderIds.size === 0) return [];

    const depositScopedOrders =
      selectedDepositFilters.length === 0
        ? permittedOrders
        : permittedOrders.filter((order) =>
            selectedDepositFilters.includes(getDepositInfo(order).key)
          );

    // Match por qualquer identificador (MLOrder.id composto, .order_id
    // externo do ML, ou pack_id). Assim cobrimos IDs vindos do live
    // snapshot (que usa pack_id) e do dashboard antigo (que usa .id).
    return depositScopedOrders.filter((order) => {
      // Se o snapshot já classificou esse pedido em OUTRO bucket, tira
      // daqui — o scraper da UI é mais fresh que nosso DB local.
      const packId = getOrderPackId(order);
      if (orderIdsInOtherSnapshotBuckets.size > 0) {
        if (order.order_id && orderIdsInOtherSnapshotBuckets.has(order.order_id)) return false;
        if (packId && orderIdsInOtherSnapshotBuckets.has(packId)) return false;
      }

      if (operationalOrderIds.has(order.id)) return true;
      if (order.order_id && operationalOrderIds.has(order.order_id)) return true;
      if (packId && operationalOrderIds.has(packId)) return true;
      return false;
    });
  }, [operationalOrderIds, permittedOrders, selectedDepositFilters, orderIdsInOtherSnapshotBuckets]);

  const focusedOperationalOrders = useMemo(() => {
    if (!operationalFocus) {
      return bucketOrders;
    }

    return bucketOrders.filter((order) => {
      if (getDepositInfo(order).key !== operationalFocus.depositKey) {
        return false;
      }

      return matchesOperationalSummaryRow(order, operationalFocus.summaryKey, shipmentFilter);
    });
  }, [bucketOrders, operationalFocus, shipmentFilter]);

  const quickFilteredOperationalOrders = useMemo(
    () =>
      focusedOperationalOrders.filter((order) =>
        matchesQuickSalesFilters(order, appliedQuickFilters)
      ),
    [appliedQuickFilters, focusedOperationalOrders]
  );

  const filteredOperationalOrders = useMemo(
    () => filterAndSortOrders(quickFilteredOperationalOrders, searchQuery, appliedFilters),
    [appliedFilters, quickFilteredOperationalOrders, searchQuery]
  );

  // Aplica o filtro de etiqueta impressa + filtros novos do ML (sub-status,
  // pickup group, store) sobre o conjunto ja filtrado. Fica separado dos
  // outros filtros porque e puramente uma "view" — nao interfere em
  // readyOrders/invoicePendingOrders.
  const displayedOperationalOrders = useMemo(() => {
    let result = filteredOperationalOrders;

    // Filtro de store (Full vs outros) — replicacao do filtro de loja do ML
    if (selectedStore !== "all") {
      result = result.filter((order) => getOrderStoreKey(order) === selectedStore);
    }

    // Filtro de sub-status do ML (clique num card do SubClassificationsBar)
    if (selectedSubStatus) {
      result = result.filter(
        (order) => getOrderSubstatus(order, shipmentFilter) === selectedSubStatus
      );
    }

    // Filtro de pickup group (Coleta | Quarta-feira, etc) — combina com
    // sub-status quando o card e do tipo agrupado por data
    if (selectedPickupGroup) {
      result = result.filter(
        (order) => getOrderPickupDateLabel(order) === selectedPickupGroup
      );
    }

    // Filtro LIVE do ML (clique num pill do LiveSubCardsStrip — ex
    // "Etiqueta pronta 37", "Coleta 23 de abril 2", "A caminho 49").
    //
    // ANTES: filtrava pelos 50 pedidos do snapshot do scraper via
    //        status_text match, perdia a grande maioria dos pedidos.
    // AGORA: usa matchesLiveStatusFilterOnLocalOrder que classifica
    //        cada order local via mlSubStatusClassifier. Cobre os ~1000
    //        pedidos da base e bate 1:1 com os sub-status do ML.
    if (selectedLiveStatusFilter) {
      result = result.filter((order) =>
        matchesLiveStatusFilterOnLocalOrder(
          order,
          selectedLiveStatusFilter,
          shipmentFilter
        )
      );
    }

    // Filtro de etiqueta impressa (mantido)
    if (labelPrintFilter === "printed") {
      result = result.filter((order) => Boolean(order.label_printed_at));
    } else if (labelPrintFilter === "not_printed") {
      result = result.filter((order) => !order.label_printed_at);
    }

    // Filtro por célula do painel Coletas por Data (clique num card).
    // Quando ativo, restringe a lista aos order_ids daquela célula.
    if (cellFilterOrderIds && cellFilterOrderIds.size > 0) {
      result = result.filter(
        (order) => order.order_id && cellFilterOrderIds.has(String(order.order_id))
      );
    }

    // Dedup por pack_id: ML Seller Center agrupa multiplos orders do
    // mesmo pack em 1 linha visual (1 pack = 1 etiqueta fisica). Antes
    // desse dedup, o app mostrava 67 pedidos quando o ML mostrava 50 —
    // 14 desses 17 extras eram orders filhos do mesmo pack_id.
    // Auditoria 2026-04-24 confirmou que todos sao o MESMO pedido do
    // lado do ML, so temos o order_id em vez do pack_id.
    //
    // Estrategia: para cada pack_id, manter o order_id mais antigo
    // (primeiro da venda). Orders sem pack_id passam direto.
    const seenPacks = new Set<string>();
    result = result.filter((order) => {
      const packId = getOrderPackId(order);
      if (!packId) return true;
      if (seenPacks.has(packId)) return false;
      seenPacks.add(packId);
      return true;
    });

    return result;
  }, [
    filteredOperationalOrders,
    labelPrintFilter,
    cellFilterOrderIds,
    selectedStore,
    selectedSubStatus,
    selectedPickupGroup,
    selectedLiveStatusFilter,
    shipmentFilter,
    // scopedLiveSnapshot removido do deps — nao e usado no body do memo
    // e estava forcando recompute a cada poll de 30s em ~1000 orders.
    // Auditoria qualidade sprint 1.3.
  ]);

  // Reset sub-status + pickup + filtro live quando trocar de bucket — eles
  // sao especificos do bucket atual e nao fazem sentido em outro.
  // Sprint 2.4: tambem reseta cellFilterOrderIds (filtro de celula do
  // ColetasPanel — componente removido, state nao tinha mais quem
  // escrever nele, mas leitura no displayedOperationalOrders ainda
  // poderia voltar a disparar). selectedStore NAO reseta intencional-
  // mente: user pode querer manter "Full" enquanto navega entre abas.
  useEffect(() => {
    setSelectedSubStatus(null);
    setSelectedPickupGroup(null);
    setSelectedLiveStatusFilter(null);
    setCellFilterOrderIds(null);
  }, [shipmentFilter]);

  // Contagens pros badges dos botoes de filtro de etiqueta — usam o
  // conjunto ja filtrado (quickFilters + appliedFilters + search) mas
  // SEM o filtro de etiqueta, pra mostrar quantos cairiam em cada aba.
  const labelPrintCounts = useMemo(() => {
    let printed = 0;
    let notPrinted = 0;
    for (const order of filteredOperationalOrders) {
      if (order.label_printed_at) printed++;
      else notPrinted++;
    }
    return {
      all: filteredOperationalOrders.length,
      printed,
      not_printed: notPrinted,
    };
  }, [filteredOperationalOrders]);

  // FIX (2026-04-21): elegibilidade dos botoes em lote (Gerar NF-e,
  // Imprimir etiqueta ML+DANFe, Etiquetas Ecoferro, Separacao) respeita
  // TODOS os filtros visiveis ao usuario — incluindo loja (Ourinhos vs
  // Full), sub-status, pickup group, label printed. Antes usava apenas
  // filteredOperationalOrders (que NAO tem esses filtros), causando
  // bug: user filtrava Ourinhos (2 pedidos) mas Etiqueta Ecoferro gerava
  // pra todos os 50 da lista sem filtro.
  const readyOrders = useMemo(
    () => displayedOperationalOrders.filter(isOrderReadyToPrintLabel),
    [displayedOperationalOrders]
  );
  // Pedidos que ainda precisam ter NF-e emitida — alimentam o botao
  // "Gerar NF-e" em lote no banner.
  const invoicePendingOrders = useMemo(
    () => displayedOperationalOrders.filter(isOrderInvoicePending),
    [displayedOperationalOrders]
  );
  // Pedidos elegiveis que o usuario marcou — fonte de verdade dos botoes
  // do banner. Os botoes so agem sobre o que esta selecionado (nao sobre
  // "todos elegiveis automaticamente"), evitando disparos acidentais.
  const selectedReadyOrders = useMemo(
    () => readyOrders.filter((order) => selectedOrderIds.has(order.id)),
    [readyOrders, selectedOrderIds]
  );
  const selectedReadyCount = selectedReadyOrders.length;
  // Pedidos que realmente tem etiqueta ML disponivel (exclui fulfillment).
  // Usado exclusivamente pelo botao "Imprimir etiqueta ML + DANFe".
  const selectedMlPrintableOrders = useMemo(
    () => selectedReadyOrders.filter(canPrintMLShippingLabel),
    [selectedReadyOrders]
  );
  const selectedMlPrintableCount = selectedMlPrintableOrders.length;
  const selectedInvoicePendingOrders = useMemo(
    () => invoicePendingOrders.filter((order) => selectedOrderIds.has(order.id)),
    [invoicePendingOrders, selectedOrderIds]
  );
  const selectedInvoicePendingCount = selectedInvoicePendingOrders.length;
  // Pedidos elegiveis para etiqueta interna Ecoferro — inclui TODOS com
  // pagamento aprovado + ready_to_ship (ready + invoice_pending).
  // Etiqueta Ecoferro e interna, NAO depende de NF-e ter sido emitida.
  // IMPORTANTE: respeita filtro de loja (Ourinhos vs Full) pra nao
  // gerar etiquetas de pedidos de loja diferente da filtrada.
  const ecoferroEligibleOrders = useMemo(
    () => displayedOperationalOrders.filter(isOrderReadyForInvoiceLabel),
    [displayedOperationalOrders]
  );
  const selectedEcoferroOrders = useMemo(
    () => ecoferroEligibleOrders.filter((order) => selectedOrderIds.has(order.id)),
    [ecoferroEligibleOrders, selectedOrderIds]
  );
  const selectedEcoferroCount = selectedEcoferroOrders.length;

  const isOperationalListIncomplete =
    ordersPagination.loading_more ||
    ordersPagination.has_more ||
    ordersPagination.loaded < ordersPagination.total;
  const isOperationalListFullyLoaded = ordersPagination.fully_loaded;
  const hasClientSideOperationalFilters =
    Boolean(searchQuery.trim()) ||
    hasQuickSalesFilters(appliedQuickFilters) ||
    getActiveFilterCount(appliedFilters) > 0 ||
    Boolean(operationalFocus);
  // Quando o usuário tem busca/filtro ativo NÃO mostrar o spinner "completar bucket" —
  // ele esperaria ver "0 resultados" imediatamente. O aviso de carga incremental
  // continua aparecendo logo acima do grid.
  const shouldShowProgressiveEmptyState =
    filteredOperationalOrders.length === 0 &&
    permittedOrders.length > 0 &&
    isOperationalListIncomplete &&
    !hasClientSideOperationalFilters;
  const canGenerateBatchLabels =
    selectedEcoferroCount > 0 && isOperationalListFullyLoaded;

  const hasOperationalSummaryWithoutVisibleOrders = useMemo(
    () =>
      permittedOrders.length === 0 &&
      !isOperationalListIncomplete &&
      accessibleDashboardDeposits.some((deposit) =>
        Object.values(deposit.internal_operational_counts || deposit.counts || {}).some(
          (count) => Number(count || 0) > 0
        )
      ),
    [accessibleDashboardDeposits, isOperationalListIncomplete, permittedOrders.length]
  );
  const selectedBucketTotalCount = operationalOrderIds.size;
  const visibleBucketOrderCount = bucketOrders.length;
  const shouldShowPartialBucketProgress =
    !hasClientSideOperationalFilters &&
    isOperationalListIncomplete &&
    selectedBucketTotalCount > 0 &&
    visibleBucketOrderCount < selectedBucketTotalCount;
  const headlineOrdersCount =
    !hasClientSideOperationalFilters && selectedBucketTotalCount > 0
      ? selectedBucketTotalCount
      : filteredOperationalOrders.length;
  const shouldAutoLoadVisibleBucket =
    !loading &&
    !hasClientSideOperationalFilters &&
    selectedBucketTotalCount > 0 &&
    selectedBucketTotalCount <= 120 &&
    visibleBucketOrderCount < selectedBucketTotalCount &&
    ordersPagination.has_more &&
    !ordersPagination.loading_more;

  useEffect(() => {
    if (!shouldAutoLoadVisibleBucket) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadMoreOrders({ background: true });
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loadMoreOrders, shouldAutoLoadVisibleBucket]);

  const selectedDepositLabel = useMemo(
    () => getSelectedDepositLabel(selectedDepositFilters, depositOptions),
    [depositOptions, selectedDepositFilters]
  );

  const operationalCards = useMemo(
    () =>
      sortDashboardDepositsForDisplay(
        (selectedDepositFilters.length === 0
          ? accessibleDashboardDeposits
          : selectedDashboardDeposits)
          .filter((deposit) => getDashboardBucketCount(deposit, shipmentFilter) > 0)
          .map((deposit) => ({
            ...deposit,
            internal_operational_counts: {
              ...(deposit.internal_operational_counts || deposit.counts),
              [shipmentFilter]: getDashboardBucketCount(deposit, shipmentFilter),
            },
            internal_operational_order_ids_by_bucket: {
              ...(deposit.internal_operational_order_ids_by_bucket || deposit.order_ids_by_bucket),
              [shipmentFilter]: getDashboardBucketOrderIds(deposit, shipmentFilter),
            },
            counts: {
              ...deposit.counts,
              [shipmentFilter]: getDashboardBucketCount(deposit, shipmentFilter),
            },
            order_ids_by_bucket: {
              ...deposit.order_ids_by_bucket,
              [shipmentFilter]: getDashboardBucketOrderIds(deposit, shipmentFilter),
            },
            displayLabel:
              deposit.logistic_type === "fulfillment"
                ? "Full"
                : deposit.key === "without-deposit"
                  ? "Vendas sem depósito"
                  : deposit.label,
            isFulfillment: deposit.logistic_type === "fulfillment",
          }))
      )
        .slice(0, 4)
        .map((deposit) => ({
          deposit,
          presentation: getOperationalCardPresentation(
            deposit,
            getDashboardBucketOrderIds(deposit, shipmentFilter)
              .map((id) => orderMap.get(id))
              .filter((order): order is MLOrder => Boolean(order)),
            shipmentFilter
          ),
        })),
    [
      accessibleDashboardDeposits,
      orderMap,
      selectedDashboardDeposits,
      selectedDepositFilters,
      shipmentFilter,
    ]
  );

  const placeholderCardCount = Math.max(0, 4 - operationalCards.length);
  const lastUpdateLabel = dashboard?.generated_at
    ? formatShortTime(dashboard.generated_at)
    : connection?.last_sync_at
      ? formatShortTime(connection.last_sync_at)
      : "--:--";
  const activeFilterCount = getActiveFilterCount(appliedFilters);
  const activeFilterChips = buildActiveFilterChips(appliedFilters, setAppliedFilters);
  const contextFilterChips: ContextFilterChip[] = [
    {
      key: `bucket:${shipmentFilter}`,
      label: SHIPMENT_BUCKET_LABELS[shipmentFilter],
      tone: "primary",
    },
    ...(selectedDepositFilters.length > 0
      ? selectedDepositFilters.map((depositKey) => ({
          key: `deposit:${depositKey}`,
          label:
            depositOptions.find((option) => option.key === depositKey)?.displayLabel || depositKey,
          removable: true,
          tone: "neutral" as const,
          remove: () => handleDepositToggle(depositKey),
        }))
      : []),
    ...(operationalFocus
      ? [
          {
            key: `summary:${operationalFocus.depositKey}:${operationalFocus.summaryKey}`,
            label: getOperationalSummaryLabel(operationalFocus.summaryKey, shipmentFilter),
            removable: true,
            tone: "primary" as const,
            remove: () => setOperationalFocus(null),
          },
        ]
      : []),
  ];
  const filtersSummaryText = buildSummaryText(
    shipmentFilter,
    appliedFilters,
    contextFilterChips
      .filter((chip) => chip.key !== `bucket:${shipmentFilter}`)
      .map((chip) => chip.label)
  );

  const hasToolbarFilters =
    searchQuery.trim().length > 0 ||
    hasQuickSalesFilters(appliedQuickFilters) ||
    activeFilterChips.length > 0 ||
    Boolean(operationalFocus) ||
    selectedDepositFilters.length > 0;

  const clearToolbarFilters = () => {
    setSearchQuery("");
    setAppliedFilters(createDefaultFilters());
    setDraftFilters(createDefaultFilters());
    setAppliedQuickFilters(DEFAULT_QUICK_SALES_FILTERS);
    setDraftQuickFilters(DEFAULT_QUICK_SALES_FILTERS);
    setSelectedDepositFilters([]);
    setOperationalFocus(null);
  };

  const quickFiltersSummaryText = buildQuickFilterSummary(appliedQuickFilters);

  const isServiceTimeoutState =
    !connection &&
    typeof error === "string" &&
    /timeout ao (consultar|carregar|sincronizar)/i.test(error);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!connection) {
    return (
      <AppLayout>
        <div className="font-mercado mx-auto max-w-5xl space-y-6">
          <div className="space-y-2">
            <h1 className="text-[32px] font-semibold tracking-[-0.03em] text-[#333333] sm:text-4xl">Vendas</h1>
            <p className="max-w-2xl text-base text-[#666666]">
              {isServiceTimeoutState
                ? "A base operacional está temporariamente indisponível. Assim que a infraestrutura de dados voltar, a operação reaparece automaticamente."
                : "Conecte a conta do Mercado Livre para espelhar a operação e gerar as etiquetas no mesmo fluxo do painel."}
            </p>
          </div>
          {error && (
            <div className="rounded-[20px] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}
          <div className="rounded-[24px] border border-[#e6e6e6] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.08)] sm:p-8">
            <div className="flex flex-col items-center gap-5 py-6 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#e8f0fe] text-[#3483fa]">
                <ShoppingCart className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold text-[#333333]">
                  {isServiceTimeoutState
                    ? "Base operacional temporariamente indisponível"
                    : "Conectar conta Mercado Livre"}
                </h2>
                <p className="max-w-xl text-sm text-[#666666]">
                  {isServiceTimeoutState
                    ? "O login continua funcionando, mas a leitura operacional da conta conectada está demorando para responder."
                    : "Depois da conexão, os pedidos entram automaticamente e a geração de etiquetas respeita os locais liberados para cada usuário."}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {isServiceTimeoutState ? (
                  <Button
                    className="h-11 rounded-full bg-[#3483fa] px-6 text-sm font-semibold text-white hover:bg-[#2968c8]"
                    onClick={handleRetryLoad}
                  >
                    <Loader2 className="mr-2 h-4 w-4" />
                    Tentar novamente
                  </Button>
                ) : (
                  <Button
                    className="h-11 rounded-full bg-[#3483fa] px-6 text-sm font-semibold text-white hover:bg-[#2968c8]"
                    onClick={handleConnect}
                    disabled={connecting}
                  >
                    {connecting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="mr-2 h-4 w-4" />
                    )}
                    Conectar Mercado Livre
                  </Button>
                )}
                <Badge variant="outline" className="rounded-full border-[#dbe5f8] px-4 py-2 text-[#666666]">
                  <CircleAlert className="mr-2 h-4 w-4 text-[#3483fa]" />
                  {isServiceTimeoutState
                    ? "Aguardando retorno da API"
                    : "Sincronização automática a cada 15s"}
                </Badge>
              </div>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="font-mercado space-y-6">
        <div className="space-y-4">
          <h1 className="text-[32px] font-semibold tracking-[-0.03em] text-[#333333] sm:text-4xl lg:text-[52px]">
            Vendas
          </h1>
          <DepositFilterMenu
            selectedLabel={selectedDepositLabel}
            selectedValues={selectedDepositFilters}
            onToggle={handleDepositToggle}
            onReset={handleDepositReset}
            options={depositOptions}
          />
        </div>

        {error && (
          <div className="rounded-[18px] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* ─── Bloco ML ao vivo + chips de bucket + sub-classificações ───
            Restaura layout do mockup desmotraçãoprojetoideal.jpeg:
            (1) indicador "● ML ao vivo — atualizado há Xs"
            (2) 4 chips: Envios de hoje / Próximos dias / Em trânsito / Finalizadas
            (3) Etiquetas imprimíveis indicator
            (4) LiveSubCardsStrip (pills clicáveis de sub-status)
            (5) SubClassificationsBar (cards por section/data/sub-status) */}
        <div className="rounded-[22px] border border-[#e6e6e6] bg-[#f3f3f3] px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] space-y-5">
          {(liveSnapshot || liveSnapshotLoading || liveSnapshotError) && (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              {liveSnapshot && !liveSnapshotError ? (
                <>
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700 ring-1 ring-inset ring-emerald-200">
                    <span
                      className={`h-1.5 w-1.5 rounded-full bg-emerald-500 ${
                        liveSnapshot.scrape_in_progress ? "animate-pulse" : ""
                      }`}
                    />
                    ML ao vivo
                  </span>
                  <span className="text-[#666666]">
                    {(() => {
                      const capturedAt = new Date(liveSnapshot.captured_at);
                      const diffSec = Math.max(
                        0,
                        Math.floor((Date.now() - capturedAt.getTime()) / 1000)
                      );
                      const diffMin = Math.floor(diffSec / 60);
                      if (diffSec < 30) return "atualizado agora";
                      if (diffSec < 60) return `atualizado há ${diffSec}s`;
                      if (diffMin === 1) return "atualizado há 1 min";
                      if (diffMin < 60) return `atualizado há ${diffMin} min`;
                      return `atualizado há ${Math.floor(diffMin / 60)}h ${diffMin % 60}min`;
                    })()}
                  </span>
                  <span className="text-[#888] text-[11px]">
                    · atualizações a cada 30s
                  </span>
                </>
              ) : liveSnapshotLoading ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 font-medium text-blue-700 ring-1 ring-inset ring-blue-200">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                  Carregando dados do ML…
                </span>
              ) : liveSnapshotError ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Fallback local (ML offline)
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void refreshLiveSnapshot({ force: true });
                }}
                disabled={liveSnapshotLoading}
                className="ml-auto inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-[12px] font-medium text-[#3483fa] ring-1 ring-inset ring-[#e6e6e6] transition hover:bg-[#eef4ff] disabled:cursor-not-allowed disabled:opacity-50"
                title="Forçar scrape fresh do ML Seller Center (demora ~90s)"
              >
                ↻ Atualizar agora
              </button>
            </div>
          )}

          {/* Chips de bucket + Etiquetas imprimíveis */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {SHIPMENT_FILTERS.map((filterOption) => {
                const active = shipmentFilter === filterOption.key;
                const count = shipmentCounts[filterOption.key];
                return (
                  <button
                    key={filterOption.key}
                    type="button"
                    onClick={() => handleShipmentBucketSelect(filterOption.key)}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[15px] font-semibold transition-colors ${
                      active
                        ? "bg-white text-[#333333] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                        : "text-[#666666] hover:bg-white/70"
                    } ${chipMeta.stale ? "opacity-70" : ""}`}
                    title={
                      chipMeta.source === "live_snapshot"
                        ? "Fonte: live snapshot ML (1:1 com Seller Center)"
                        : chipMeta.source === "ml_ui"
                          ? chipMeta.stale
                            ? `Fonte: chip ML (cache stale, ${chipMeta.ageSeconds ?? "?"}s) — atualizando em background`
                            : "Fonte: chip ML (Seller Center)"
                          : chipMeta.source === "ml_live"
                            ? "Fonte: API ML (classifier local)"
                            : "Fonte: classifier local (pode divergir do ML)"
                    }
                  >
                    <span>{filterOption.label}</span>
                    <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[#3483fa] px-1.5 py-0.5 text-xs font-bold text-white">
                      {count ?? 0}
                    </span>
                  </button>
                );
              })}
              {chipMeta.source === "local" && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  ⚠ Chip ML indisponível — contagem local
                </span>
              )}
              {chipMeta.source === "ml_ui" && chipMeta.stale && (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  ↻ Sincronizando ML{chipMeta.ageSeconds != null ? ` (${chipMeta.ageSeconds}s)` : ""}
                </span>
              )}
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#e6e6e6] bg-white px-4 py-2 text-[15px] text-[#5a6d92] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <span className="font-medium">Etiquetas imprimíveis</span>
              <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[#3483fa] px-1.5 py-0.5 text-xs font-bold text-white">
                {readyOrders.length}
              </span>
            </div>
          </div>

          {/* Campo de pesquisa — busca em sale_number, order_id, SKU,
              buyer_name, buyer_nickname e item_title (matchesSearch em
              mercadoLivreHelpers.ts:530). Filtra a lista da aba ativa. */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[280px] max-w-[560px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0a6]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por número da venda, SKU, comprador ou produto..."
                className="h-10 w-full rounded-full border border-[#e6e6e6] bg-white pl-10 pr-10 text-[14px] text-[#333333] placeholder:text-[#9aa0a6] shadow-[0_1px_2px_rgba(0,0,0,0.04)] focus:border-[#3483fa] focus:outline-none focus:ring-2 focus:ring-[#3483fa]/20"
                aria-label="Buscar pedidos"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-semibold text-[#5a6d92] hover:text-[#333333]"
                  aria-label="Limpar busca"
                >
                  ✕
                </button>
              )}
            </div>
            {searchQuery.trim() && (
              <span className="text-[13px] text-[#5a6d92]">
                {filteredOperationalOrders.length} resultado(s)
              </span>
            )}
          </div>

          {/* SUB-CLASSIFICAÇÃO AO VIVO (ML) — pills DESATIVADAS no painel
              principal (brief 2026-04-27). Os mesmos sub-status agora
              vivem dentro dos cards do MLClassificationsGrid abaixo,
              clicáveis pra filtrar a lista. As pills permanecem no
              componente caso seja util reativar via flag em pagina de
              diagnostico no futuro. */}

          {/* Cards por (deposito × section × data × sub-status), 1:1 com
              ML Seller Center. Titulos variam por deposito:
              - Ourinhos today:  "PROGRAMADA Coleta"
              - Full today:      "Full"
              - Ourinhos upcoming: "Coleta | Amanhã", "Coleta | A partir
                                   de 24 de abril"
              - Qualquer bucket: "Devoluções", "Para retirar", "Encerradas"...
              Agrupamento controlado por deposit (derivado do filtro do topo)
              e pickupDate (upcoming). Atende "os outros dias" pedido pelo
              usuario no chat. */}
          <MLClassificationsGrid
            orders={filteredOperationalOrders}
            bucket={shipmentFilter}
            deposit={liveSnapshotScope}
            selectedSubStatus={selectedSubStatus}
            onSelectSubStatus={setSelectedSubStatus}
            selectedPickupGroup={selectedPickupGroup}
            onSelectPickupGroup={setSelectedPickupGroup}
            cardsByTab={scopedLiveSnapshot?.cards_by_tab ?? null}
          />
        </div>

        {/* ColetasPanel removido conforme pedido (remover.png). Toolbar de
            filtros (periodo/ordenar/status/Buscar/Limpar) realocada abaixo
            em uma linha propria pra nao perder funcionalidade. */}
        <div className="rounded-[18px] border border-[#e6e6e6] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={datePreset}
              onValueChange={(value) => {
                const preset = value as DatePreset;
                setDatePreset(preset);
                const range = getDatePresetRange(preset);
                setDraftQuickFilters((current) => {
                  const next = {
                    ...current,
                    dateFrom: range.from,
                    dateTo: range.to,
                  };
                  setAppliedQuickFilters(next);
                  return next;
                });
              }}
            >
              <SelectTrigger className="h-9 rounded-md border-[#e5e5e5] text-[13px] w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(DATE_PRESET_LABELS) as DatePreset[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {DATE_PRESET_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={draftFilters.sort}
              onValueChange={(value) =>
                setDraftFilters((current) => {
                  const next = {
                    ...current,
                    sort: value as MercadoLivreFilters["sort"],
                  };
                  setAppliedFilters(cloneFilters(next));
                  return next;
                })
              }
            >
              <SelectTrigger className="h-9 rounded-md border-[#e5e5e5] text-[13px] w-[180px]">
                <SelectValue placeholder="Ordenar" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(SORT_LABELS) as MercadoLivreFilters["sort"][]).map((s) => (
                  <SelectItem key={s} value={s}>
                    Ordenar: {SORT_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={draftQuickFilters.status}
              onValueChange={(value) =>
                setDraftQuickFilters((current) => {
                  const next = {
                    ...current,
                    status: value as QuickSalesStatusFilter,
                  };
                  setAppliedQuickFilters(next);
                  return next;
                })
              }
            >
              <SelectTrigger className="h-9 rounded-md border-[#e5e5e5] text-[13px] w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUICK_SALES_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              size="sm"
              className="h-9 rounded-md bg-[#3483fa] px-4 text-[13px] font-semibold text-white hover:bg-[#2968c8]"
              onClick={() => {
                setAppliedQuickFilters({ ...draftQuickFilters });
                setAppliedFilters(cloneFilters(draftFilters));
              }}
            >
              Buscar
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-md border-[#e5e5e5] px-4 text-[13px] font-semibold"
              onClick={() => {
                setDraftQuickFilters(DEFAULT_QUICK_SALES_FILTERS);
                setAppliedQuickFilters(DEFAULT_QUICK_SALES_FILTERS);
                setDraftFilters(createDefaultFilters());
                setAppliedFilters(createDefaultFilters());
                setDatePreset("all");
              }}
            >
              Limpar
            </Button>
          </div>
        </div>

        {quickFiltersSummaryText && (
          <div className="text-xs text-[#666666] px-1">{quickFiltersSummaryText}</div>
        )}

        <div className="space-y-6 pt-2">




        <div className="rounded-2xl border border-[#e6e6e6] bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.08)] sm:px-4 sm:py-3">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between lg:gap-3">
            <div className="flex items-center gap-2.5">
              {(() => {
                // Selecionar TODOS os pedidos visíveis (readyOrders + invoicePending).
                // Assim o "Gerar NF-e" fica ativo quando há pedidos que precisam de NF-e,
                // e o "Imprimir etiqueta" fica ativo com os que já estão prontos.
                // Usa displayedOperationalOrders para respeitar o filtro de etiqueta impressa:
                // ao filtrar "Sem etiqueta", o checkbox seleciona apenas os pendentes.
                const allVisible = displayedOperationalOrders;
                const hasOrders = allVisible.length > 0;
                const allSelected =
                  hasOrders &&
                  allVisible.every((o) => selectedOrderIds.has(o.id));
                const someSelected =
                  !allSelected &&
                  allVisible.some((o) => selectedOrderIds.has(o.id));
                return (
                  <button
                    type="button"
                    disabled={!hasOrders}
                    onClick={() => {
                      if (!hasOrders) return;
                      setSelectedOrderIds((current) => {
                        const next = new Set(current);
                        if (allSelected) {
                          for (const o of allVisible) next.delete(o.id);
                        } else {
                          for (const o of allVisible) next.add(o.id);
                        }
                        return next;
                      });
                    }}
                    title={
                      !hasOrders
                        ? "Nenhum pedido neste bucket"
                        : allSelected
                          ? "Desmarcar todos"
                          : `Selecionar todos ${allVisible.length} pedidos`
                    }
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${
                      !hasOrders
                        ? "cursor-not-allowed border border-[#e5e5e5] bg-[#f5f5f5] text-transparent"
                        : allSelected || someSelected
                          ? "bg-[#3483fa] text-white hover:bg-[#2968c8]"
                          : "border border-[#c8d3e0] bg-white text-transparent hover:border-[#3483fa]"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                );
              })()}
              <div className="min-w-0 text-[13px] text-[#333333]">
                <span className="font-semibold">
                  Etiquetas disponíveis para impressão
                </span>
                {displayedOperationalOrders.length > 0 ? (
                  <span className="ml-1.5 text-[13px] text-[#666666]">
                    ({displayedOperationalOrders.filter((o) => selectedOrderIds.has(o.id)).length}/{displayedOperationalOrders.length} selecionadas)
                    {selectedInvoicePendingCount > 0 && (
                      <span className="ml-1 text-[#ff6d1b] font-semibold">
                        · {selectedInvoicePendingCount} NF-e pendente{selectedInvoicePendingCount > 1 ? "s" : ""}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="ml-1.5 text-[13px] text-[#999999]">
                    {labelPrintFilter === "not_printed"
                      ? "(nenhum pedido sem etiqueta neste bucket)"
                      : labelPrintFilter === "printed"
                        ? "(nenhum pedido com etiqueta impressa neste bucket)"
                        : "(0 neste bucket)"}
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-center lg:gap-2.5">
              {/* Marcar/Desmarcar etiqueta impressa — migrados do bloco
                  de filtros removido pra ficarem juntos com as outras
                  acoes em lote, conforme mockup do usuario. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 w-full rounded-lg border-[#d9e7ff] px-3 text-[13px] text-[#2968c8] hover:bg-[#eef4ff] disabled:opacity-60 lg:w-auto"
                disabled={selectedReadyCount === 0 || markingLabelsPrinted}
                onClick={() => handleMarkSelectedLabels(selectedReadyOrders, "printed")}
                title="Marcar etiquetas dos pedidos selecionados como impressas"
              >
                {markingLabelsPrinted ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                )}
                Marcar Impressas{selectedReadyCount > 0 ? ` (${selectedReadyCount})` : ""}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 w-full rounded-lg border-[#ffe0c7] px-3 text-[13px] text-[#ff6d1b] hover:bg-[#fff4ec] disabled:opacity-60 lg:w-auto"
                disabled={selectedReadyCount === 0 || markingLabelsPrinted}
                onClick={() => handleMarkSelectedLabels(selectedReadyOrders, "unprinted")}
                title="Devolver pedidos selecionados para fila 'Sem etiqueta impressa'"
              >
                {markingLabelsPrinted ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                )}
                Desmarcar
              </Button>
              <Button
                className="h-10 w-full rounded-lg bg-[#ff6d1b] px-3.5 text-[13px] font-semibold text-white shadow-[0_1px_3px_rgba(255,109,27,0.28)] transition hover:bg-[#e65c10] hover:shadow-[0_2px_6px_rgba(255,109,27,0.4)] disabled:cursor-not-allowed disabled:bg-[#f1f1f1] disabled:text-[#a0a0a0] disabled:shadow-none sm:text-[13px] lg:w-auto lg:px-4"
                disabled={selectedInvoicePendingCount === 0 || bulkGeneratingNFe}
                onClick={() => handleGenerateNFeBulk(selectedInvoicePendingOrders)}
                title={
                  selectedInvoicePendingCount > 0
                    ? "Emitir NF-e dos pedidos selecionados que estao pendentes"
                    : "Selecione pedidos com NF-e pendente para habilitar"
                }
              >
                {bulkGeneratingNFe ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Receipt className="mr-1.5 h-4 w-4" />
                )}
                <span className="truncate">
                  Gerar NF-e
                  {selectedInvoicePendingCount > 0 ? ` (${selectedInvoicePendingCount})` : ""}
                </span>
              </Button>
              <Button
                className="h-10 w-full rounded-lg bg-[#fff159] px-3.5 text-[13px] font-semibold text-[#333333] shadow-[0_1px_3px_rgba(255,241,89,0.6)] transition hover:bg-[#ffe924] hover:shadow-[0_2px_6px_rgba(255,241,89,0.8)] disabled:opacity-60 disabled:shadow-none sm:text-[13px] lg:w-auto lg:px-4"
                disabled={selectedMlPrintableCount === 0 || !isOperationalListFullyLoaded || bulkPrintingMl}
                onClick={() => handlePrintMlLabelsAndNFeBulk(selectedMlPrintableOrders)}
                title={
                  selectedMlPrintableCount === 0
                    ? "Nenhum pedido cross-docking selecionado com etiqueta ML disponivel (pedidos Full nao tem etiqueta publica)"
                    : `Imprimir ${selectedMlPrintableCount} etiqueta(s) ML + DANFe`
                }
              >
                {bulkPrintingMl ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="mr-1.5 h-4 w-4" />
                )}
                <span className="truncate">
                  Imprimir etiqueta ML + DANFe
                  {selectedMlPrintableCount > 0 ? ` (${selectedMlPrintableCount})` : ""}
                </span>
              </Button>
              <Button
                className="h-10 w-full rounded-lg bg-[#22c55e] px-3.5 text-[13px] font-semibold text-white shadow-[0_1px_3px_rgba(34,197,94,0.28)] transition hover:bg-[#16a34a] hover:shadow-[0_2px_6px_rgba(34,197,94,0.4)] disabled:opacity-60 disabled:shadow-none sm:text-[13px] lg:w-auto lg:px-4"
                disabled={!canGenerateBatchLabels}
                onClick={() => handleGenerateLabels(selectedEcoferroOrders)}
              >
                <Tag className="mr-1.5 h-4 w-4" />
                <span className="truncate">
                  {isOperationalListFullyLoaded
                    ? `Etiquetas Ecoferro${selectedEcoferroCount > 0 ? ` (${selectedEcoferroCount})` : ""}`
                    : `Carregando base completa${selectedEcoferroCount > 0 ? ` (${selectedEcoferroCount})` : ""}`}
                </span>
              </Button>
              <Button
                className="h-10 w-full rounded-lg bg-[#3483fa] px-3.5 text-[13px] font-semibold text-white shadow-[0_1px_3px_rgba(52,131,250,0.28)] transition hover:bg-[#2968c8] hover:shadow-[0_2px_6px_rgba(52,131,250,0.4)] disabled:opacity-60 disabled:shadow-none sm:text-[13px] lg:w-auto lg:px-4"
                disabled={selectedEcoferroCount === 0 || generatingSeparation}
                onClick={() => handleGenerateSeparationReport(selectedEcoferroOrders)}
                title="Gerar relatorio de separacao agrupado por produto/SKU para o estoque"
              >
                {generatingSeparation ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <ClipboardList className="mr-1.5 h-4 w-4" />
                )}
                <span className="truncate">
                  Separacao{selectedReadyCount > 0 ? ` (${selectedReadyCount})` : ""}
                </span>
              </Button>
            </div>
          </div>

          {!isOperationalListFullyLoaded && (
            <div className="mt-3 rounded-xl border border-[#f0e1b2] bg-[#fff9e6] px-4 py-3 text-sm text-[#7a5c12]">
              A geração em lote fica liberada assim que a listagem operacional terminar de carregar,
              evitando imprimir etiquetas com base parcial.
            </div>
          )}
        </div>

        {permittedOrders.length === 0 && isOperationalListIncomplete ? (
          <div className="rounded-[20px] border border-[#e6e6e6] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
            <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-[#3483fa]" />
            <p className="text-[16px] font-semibold text-[#333333]">
              Carregando a base operacional completa deste usuário.
            </p>
            <p className="mt-1 text-[15px] text-[#666666]">
              As próximas páginas continuam chegando em segundo plano para evitar travamento da
              tela.
            </p>
          </div>
        ) : permittedOrders.length === 0 ? (
          <div className="rounded-[20px] border border-[#e6e6e6] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
            <CircleAlert className="mx-auto mb-3 h-8 w-8 text-[#bdbdbd]" />
            <p className="text-[16px] font-semibold text-[#333333]">
              {hasOperationalSummaryWithoutVisibleOrders
                ? "O resumo operacional carregou, mas a listagem detalhada não retornou pedidos."
                : "Nenhum pedido visível para os locais liberados neste usuário."}
            </p>
            <p className="mt-1 text-[15px] text-[#666666]">
              {hasOperationalSummaryWithoutVisibleOrders
                ? "Isso normalmente acontece quando a consulta detalhada demora mais que o resumo ou ainda está estabilizando a sessão. Recarregue a listagem para tentar novamente."
                : "Revise as permissões de local na tela de usuários para liberar outros pedidos."}
            </p>
            {hasOperationalSummaryWithoutVisibleOrders && (
              <div className="mt-5 flex justify-center">
                <Button variant="outline" onClick={handleRetryLoad}>
                  Recarregar listagem
                </Button>
              </div>
            )}
          </div>
        ) : shouldShowProgressiveEmptyState ? (
          <div className="rounded-[20px] border border-[#e6e6e6] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
            <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-[#3483fa]" />
            <p className="text-[16px] font-semibold text-[#333333]">
              Carregando mais pedidos para completar este bucket operacional.
            </p>
            <p className="mt-1 text-[15px] text-[#666666]">
              O grid já abriu rápido e continua recebendo as próximas páginas em segundo plano.
            </p>
          </div>
        ) : displayedOperationalOrders.length === 0 ? (
          <div className="rounded-[20px] border border-[#e6e6e6] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
            {/* Caso especial: chip do ML mostra pedidos mas a lista local
                esta vazia. Significa que o ML retorna IDs que ainda nao
                foram sincronizados no banco local. Mostra um aviso claro
                + botao "Sincronizar agora" pra forcar a sync. */}
            {selectedBucketTotalCount > 0 && bucketOrders.length === 0 ? (
              <>
                <CircleAlert className="mx-auto mb-3 h-8 w-8 text-[#ff6d1b]" />
                <p className="text-[16px] font-semibold text-[#333333]">
                  ML mostra <strong>{selectedBucketTotalCount}</strong> pedido(s),
                  mas o app não tem nenhum sincronizado ainda.
                </p>
                <p className="mt-1 text-[15px] text-[#666666]">
                  Isso acontece quando vendas novas ainda nao foram puxadas pro banco local.
                  Clica em "Sincronizar agora" pra resolver.
                </p>
                <div className="mt-5 flex justify-center">
                  <Button
                    onClick={handleRetryLoad}
                    className="bg-[#ff6d1b] text-white hover:bg-[#e65c10]"
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Sincronizar agora
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Search className="mx-auto mb-3 h-8 w-8 text-[#bdbdbd]" />
                <p className="text-[16px] font-semibold text-[#333333]">
                  {labelPrintFilter === "not_printed"
                    ? "Nenhum pedido sem etiqueta impressa."
                    : labelPrintFilter === "printed"
                      ? "Nenhum pedido com etiqueta impressa."
                      : "Nenhum pedido encontrado para os filtros aplicados."}
                </p>
            <p className="mt-1 text-[15px] text-[#666666]">
              {labelPrintFilter !== "all"
                ? "Troque o filtro de etiqueta para 'Todas' ou ajuste os outros filtros."
                : isOperationalListIncomplete
                  ? `A base ainda está carregando (${ordersPagination.loaded} de ${ordersPagination.total}). Se for um pedido recente, aguarde a próxima página ou clique em "Carregar mais agora".`
                  : "Ajuste a busca, remova filtros ativos ou troque o bucket operacional."}
            </p>
            {isOperationalListIncomplete && ordersPagination.has_more && (
              <Button
                type="button"
                variant="outline"
                className="mt-4 h-9 rounded-full border-[#c8dafc] bg-white text-[#2968c8] hover:bg-[#eef4ff]"
                onClick={() => void loadMoreOrders()}
                disabled={ordersPagination.loading_more}
              >
                {ordersPagination.loading_more ? "Carregando..." : "Carregar mais agora"}
              </Button>
            )}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Toolbar flutuante de selecao removido — as mesmas acoes
                (Etiquetas Ecoferro, Imprimir etiqueta ML + DANFe) ja estao
                disponiveis no banner fixo "Etiquetas Disponivel para
                impressao" logo acima, entao esse toolbar duplicado so
                poluia a tela. O contador de pedidos selecionados tambem
                aparece no proprio banner como sufixo dos botoes. */}
            <VirtualizedOrderList
              orders={displayedOperationalOrders}
              onOpenDocuments={handleOpenDocumentsDialog}
              selectedOrderIds={selectedOrderIds}
              onToggleSelect={handleToggleSelectOrder}
              onPrintInternalLabel={handlePrintInternalLabelEcoferro}
              onGenerateNFe={handleGenerateSingleOrderNFe}
              onPrintMlLabel={handlePrintSingleOrderMlLabel}
              generatingNFeForOrderId={generatingNFeForOrderId}
              printingLabelForOrderId={printingLabelForOrderId}
            />

            {ordersPagination.has_more && (
              <div className="flex justify-center pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-full border-[#d9e7ff] px-5 text-[#2968c8] hover:bg-[#eef4ff]"
                  onClick={() => void loadMoreOrders()}
                  disabled={ordersPagination.loading_more}
                >
                  {ordersPagination.loading_more ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Carregando mais pedidos
                    </>
                  ) : (
                    `Carregar mais pedidos (${Math.max(
                      0,
                      ordersPagination.total - ordersPagination.loaded
                    )} restantes)`
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
        </div>
      </div>
      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="sm:max-w-[720px] max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Filtrar e ordenar</DialogTitle>
            <DialogDescription>
              Aplicar filtros atualiza a listagem operacional atual. Os chips removem filtros
              individualmente e a geração continua restrita ao que realmente pode imprimir.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl border border-[#e6e6e6] bg-[#fafafa] p-4 text-sm text-[#666666]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-[#333333]">Contexto atual:</span>
              {contextFilterChips.map((chip) => (
                <span
                  key={chip.key}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 ${
                    chip.tone === "primary"
                      ? "border-[#d9e7ff] bg-[#eef4ff] text-[#3483fa]"
                      : "border-[#ececec] bg-white text-[#666666]"
                  }`}
                >
                  {chip.label}
                </span>
              ))}
              {activeFilterChips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex items-center gap-2 rounded-full border border-[#d9e7ff] bg-[#eef4ff] px-3 py-1 text-[#3483fa]"
                >
                  {chip.label}
                </span>
              ))}
              {activeFilterChips.length === 0 && (
                <span className="text-[#8a8a8a]">Nenhum filtro adicional aplicado.</span>
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto pr-1 space-y-4">
            <section className="space-y-3 rounded-2xl border border-border/60 p-4">
              <Label className="text-sm font-semibold">Ordenar por</Label>
              <Select
                value={draftFilters.sort}
                onValueChange={(value) =>
                  setDraftFilters((current) => ({
                    ...current,
                    sort: value as MercadoLivreFilters["sort"],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sale_date_desc">Vendas mais recentes</SelectItem>
                  <SelectItem value="sale_date_asc">Vendas mais antigas</SelectItem>
                  <SelectItem value="amount_desc">Maior valor</SelectItem>
                  <SelectItem value="amount_asc">Menor valor</SelectItem>
                </SelectContent>
              </Select>
            </section>
            <section className="space-y-3 rounded-2xl border border-dashed border-border/60 bg-secondary/20 p-4">
              <Label className="text-sm font-semibold">Canal de venda</Label>
              <div className="rounded-xl border border-border/60 bg-white px-3 py-3 text-sm text-muted-foreground">
                Mercado Livre. Este canal é fixo nesta tela e não gera filtro adicional.
              </div>
            </section>
            <section className="space-y-3 rounded-2xl border border-border/60 p-4">
              <Label className="text-sm font-semibold">Tipo de comprador</Label>
              <div className="space-y-3">
                {BUYER_TYPE_FILTER_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-3 text-sm">
                    <Checkbox
                      checked={draftFilters.buyerTypes.includes(option.value)}
                      onCheckedChange={() =>
                        setDraftFilters((current) => ({
                          ...current,
                          buyerTypes: toggleMultiFilter(current.buyerTypes, option.value),
                        }))
                      }
                    />
                    <div className="flex flex-1 items-center justify-between gap-2"><span>{option.label}</span><FilterOriginBadge option={option} /></div>
                  </label>
                ))}
              </div>
            </section>
            <section className="space-y-3 rounded-2xl border border-border/60 p-4">
              <Label className="text-sm font-semibold">Status</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                {STATUS_FILTER_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-3 text-sm">
                    <Checkbox
                      checked={draftFilters.statuses.includes(option.value)}
                      onCheckedChange={() =>
                        setDraftFilters((current) => ({
                          ...current,
                          statuses: toggleMultiFilter(current.statuses, option.value),
                        }))
                      }
                    />
                    <div className="flex flex-1 items-center justify-between gap-2"><span>{option.label}</span><FilterOriginBadge option={option} /></div>
                  </label>
                ))}
              </div>
            </section>
            <section className="space-y-3 rounded-2xl border border-border/60 p-4">
              <Label className="text-sm font-semibold">Formas de entrega</Label>
              <div className="space-y-3">
                {DELIVERY_FILTER_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-3 text-sm">
                    <Checkbox
                      checked={draftFilters.deliveryForms.includes(option.value)}
                      onCheckedChange={() =>
                        setDraftFilters((current) => ({
                          ...current,
                          deliveryForms: toggleMultiFilter(current.deliveryForms, option.value),
                        }))
                      }
                    />
                    <div className="flex flex-1 items-center justify-between gap-2"><span>{option.label}</span><FilterOriginBadge option={option} /></div>
                  </label>
                ))}
              </div>
            </section>
            <section className="space-y-3 rounded-2xl border border-border/60 p-4">
              <Label className="text-sm font-semibold">Notas fiscais</Label>
              <div className="space-y-3">
                {INVOICE_FILTER_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-3 text-sm">
                    <Checkbox
                      checked={draftFilters.invoiceStates.includes(option.value)}
                      onCheckedChange={() =>
                        setDraftFilters((current) => ({
                          ...current,
                          invoiceStates: toggleMultiFilter(current.invoiceStates, option.value),
                        }))
                      }
                    />
                    <div className="flex flex-1 items-center justify-between gap-2"><span>{option.label}</span><FilterOriginBadge option={option} /></div>
                  </label>
                ))}
              </div>
            </section>
          </div>
          <DialogFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between pt-3 border-t border-border/40">
            <Button variant="ghost" onClick={() => setDraftFilters(createDefaultFilters())}>
              Limpar filtros
            </Button>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setFiltersOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={() => {
                  setAppliedFilters(cloneFilters(draftFilters));
                  setFiltersOpen(false);
                }}
              >
                Aplicar
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <OrderOperationalDocumentsDialog
        open={documentsDialogOpen}
        onOpenChange={setDocumentsDialogOpen}
        order={documentsOrder}
        documents={orderDocuments}
        loading={orderDocumentsLoading}
        error={orderDocumentsError}
        onRefresh={handleRefreshDocuments}
        onOpenInternalLabel={handleOpenInternalLabelFlow}
        nfeResponse={orderNFe}
        nfeLoading={orderNFeLoading}
        nfeError={orderNFeError}
        onRefreshNFe={handleRefreshOrderNFe}
        onGenerateNFe={handleGenerateOrderNFe}
        onSyncNFe={handleSyncOrderNFe}
      />
    </AppLayout>
  );
}



