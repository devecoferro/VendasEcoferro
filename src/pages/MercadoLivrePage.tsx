import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { useCallback } from "react";
import { useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { OrderOperationalDocumentsDialog } from "@/components/OrderOperationalDocumentsDialog";
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
import {
  Check,
  ChevronDown,
  ChevronUp,
  ChevronsRight,
  CircleAlert,
  FileText,
  Info,
  Link2,
  Loader2,
  Search,
  Send,
  ShoppingCart,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  generateMLNFe,
  getMLPrivateSellerCenterComparison,
  getMLNFeDocument,
  getMLOrderDocuments,
  mapMLOrdersToProcessingResults,
  type MLDashboardDeposit,
  type MLNFeResponse,
  type MLOrderDocumentsResponse,
  type MLPrivateSellerCenterComparisonResponse,
  type MLOrder,
  syncMLNFeWithMercadoLivre,
  startMLOAuth,
} from "@/services/mercadoLivreService";
import {
  BUYER_TYPE_FILTER_OPTIONS,
  DELIVERY_FILTER_OPTIONS,
  DEFAULT_ML_FILTERS,
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
  getOrderImageFallback,
  parseDate,
  sortDashboardDepositsForDisplay,
  getSelectedDepositLabel,
  getShipmentPresentation,
  isOrderForCollection,
  isOrderInvoicePending,
  isOrderReadyToPrintLabel,
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

function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }

  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatCountDelta(value: number): string {
  if (value === 0) {
    return "0";
  }

  return value > 0 ? `+${value}` : String(value);
}

function getDeltaTone(value: number): string {
  if (value === 0) {
    return "text-[#2e7d32]";
  }

  return value > 0 ? "text-[#c62828]" : "text-[#1565c0]";
}

function getDisplayOrderItems(order: MLOrder): MLOrder["items"] {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items;
  }

  return [
    {
      item_title: order.item_title,
      sku: order.sku,
      quantity: order.quantity,
      amount: order.amount,
      item_id: order.item_id,
      product_image_url: order.product_image_url,
    },
  ];
}

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
  };
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

  if (parts.length === 1) {
    return `Você está visualizando o bucket ${parts[0]} com resumo operacional interno no topo e detalhamento operacional separado nos cards abaixo.`;
  }

  return `Você está visualizando apenas filtros que combinam com ${parts.join(" e ")}, usando o resumo operacional interno no topo e regras operacionais derivadas para a distribuição abaixo.`;
}

function getActiveFilterCount(filters: MercadoLivreFilters): number {
  let count = filters.buyerTypes.length + filters.statuses.length + filters.deliveryForms.length;
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

  if (filters.sort === "sale_date_asc") {
    chips.push({
      key: "sort:sale_date_asc",
      label: "Vendas mais antigas",
      remove: () =>
        setFilters((current) => ({
          ...current,
          sort: "sale_date_desc",
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

function DepositFilterMenu({
  selectedLabel,
  selectedValues,
  onToggle,
  onReset,
  options,
}: {
  selectedLabel: string;
  selectedValues: string[];
  onToggle: (value: string) => void;
  onReset: () => void;
  options: DepositOptionPresentation[];
}) {
  const withoutDeposit = options.find((option) => option.kind === "without-deposit");
  const depositOptions = options.filter((option) => option.kind === "deposit");
  const allSelected = selectedValues.length === 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex w-full items-center justify-between gap-2 rounded-full border border-[#dfe3ea] bg-white px-5 py-3 text-[16px] font-medium text-[#333333] shadow-[0_1px_2px_rgba(0,0,0,0.05)] sm:w-auto sm:justify-start sm:text-[17px]"
        >
          <span>{selectedLabel}</span>
          <ChevronDown className="h-4 w-4 text-[#666666]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] max-w-[calc(100vw-2rem)] rounded-2xl p-0">
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={onReset}
            className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-[16px] ${
              allSelected
                ? "bg-[#f4f8ff] font-semibold text-[#3483fa]"
                : "text-[#333333] hover:bg-[#f8f8f8]"
            }`}
          >
            <span>Todas as vendas</span>
            {allSelected && <Check className="h-4 w-4" />}
          </button>

          {withoutDeposit && (
            <button
              type="button"
              onClick={() => onToggle(withoutDeposit.key)}
              className={`mt-1 flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-[16px] ${
                selectedValues.includes(withoutDeposit.key)
                  ? "bg-[#f4f8ff] font-semibold text-[#3483fa]"
                  : "text-[#333333] hover:bg-[#f8f8f8]"
              }`}
            >
              <span>{withoutDeposit.displayLabel}</span>
              {selectedValues.includes(withoutDeposit.key) && <Check className="h-4 w-4" />}
            </button>
          )}
        </div>

        {depositOptions.length > 0 && (
          <div className="border-t border-[#efefef] px-4 py-3">
            <div className="px-3 pb-2 text-[13px] font-medium text-[#8a8a8a]">Por depósito</div>
            <div className="space-y-1">
              {depositOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => onToggle(option.key)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-[16px] ${
                    selectedValues.includes(option.key)
                      ? "bg-[#f4f8ff] font-semibold text-[#3483fa]"
                      : "text-[#333333] hover:bg-[#f8f8f8]"
                  }`}
                >
                  <span>{option.displayLabel}</span>
                  {selectedValues.includes(option.key) && <Check className="h-4 w-4" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

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
    loadMoreOrders,
  } = useMercadoLivreData({
    autoSync: true,
    autoSyncIntervalMs: 120000,
    ordersScope: "operational",
    ordersLimit: 300,
    ordersView: "dashboard",
    autoLoadAllPages: false,
  });

  const [connecting, setConnecting] = useState(false);
  const [shipmentFilter, setShipmentFilter] = useState<ShipmentBucket>("today");
  const [selectedDepositFilters, setSelectedDepositFilters] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState<MercadoLivreFilters>(createDefaultFilters());
  const [draftFilters, setDraftFilters] = useState<MercadoLivreFilters>(createDefaultFilters());
  const [draftQuickFilters, setDraftQuickFilters] = useState<QuickSalesFilters>(
    DEFAULT_QUICK_SALES_FILTERS
  );
  const [appliedQuickFilters, setAppliedQuickFilters] = useState<QuickSalesFilters>(
    DEFAULT_QUICK_SALES_FILTERS
  );
  const [operationalFocus, setOperationalFocus] = useState<OperationalSummaryFilter | null>(null);
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});
  const [privateComparison, setPrivateComparison] =
    useState<MLPrivateSellerCenterComparisonResponse | null>(null);
  const [privateComparisonLoading, setPrivateComparisonLoading] = useState(false);
  const [privateComparisonError, setPrivateComparisonError] = useState<string | null>(null);
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
      await refresh();
    } catch {
      // O hook já controla e expõe o estado de erro.
    }
  };

  const handleApplyQuickStatusFilter = useCallback((status: QuickSalesStatusFilter) => {
    setDraftQuickFilters((current) => ({ ...current, status }));
    setAppliedQuickFilters((current) => ({ ...current, status }));
  }, []);

  const handleGenerateLabels = useCallback((ordersToReview: MLOrder[]) => {
    if (ordersToReview.length === 0) {
      toast.info("Nenhum pedido disponível para gerar etiqueta.");
      return;
    }

    setResults(mapMLOrdersToProcessingResults(ordersToReview));
    toast.success(`${ordersToReview.length} pedido(s) enviados para conferência.`);
    navigate("/review");
  }, [navigate, setResults]);

  const handleToggleExpandedOrder = (orderId: string) => {
    setExpandedOrders((current) => ({
      ...current,
      [orderId]: !(current[orderId] ?? true),
    }));
  };

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

  const loadPrivateComparison = useCallback(async () => {
    setPrivateComparisonLoading(true);
    setPrivateComparisonError(null);

    try {
      const comparison = await getMLPrivateSellerCenterComparison();
      setPrivateComparison(comparison);
    } catch (caughtError) {
      setPrivateComparisonError(
        caughtError instanceof Error
          ? caughtError.message
          : "Falha ao carregar a auditoria técnica do Seller Center."
      );
    } finally {
      setPrivateComparisonLoading(false);
    }
  }, []);

  const handleDepositToggle = (value: string) => {
    setSelectedDepositFilters((current) =>
      current.includes(value)
        ? current.filter((entry) => entry !== value)
        : [...current, value]
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
    if (orderOptions.length > 0) {
      return orderOptions;
    }

    return accessibleDashboardDeposits.map((deposit) => ({
      key: deposit.key,
      label: deposit.label,
      displayLabel:
        deposit.key === "without-deposit"
          ? "Vendas sem depósito"
          : deposit.logistic_type === "fulfillment"
            ? "Full"
            : deposit.label,
      isFulfillment: deposit.logistic_type === "fulfillment",
      kind: deposit.key === "without-deposit" ? ("without-deposit" as const) : ("deposit" as const),
    }));
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

  const shipmentCounts = useMemo(
    () =>
      SHIPMENT_FILTERS.reduce<Record<ShipmentBucket, number>>(
        (accumulator, currentFilter) => {
          accumulator[currentFilter.key] = selectedDashboardDeposits.reduce(
            (total, deposit) => total + getDashboardBucketCount(deposit, currentFilter.key),
            0
          );
          return accumulator;
        },
        { today: 0, upcoming: 0, in_transit: 0, finalized: 0 }
      ),
    [selectedDashboardDeposits]
  );

  const operationalOrderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const deposit of selectedDashboardDeposits) {
      const bucketIds = getDashboardBucketOrderIds(deposit, shipmentFilter);
      for (const id of bucketIds) ids.add(id);
    }
    return ids;
  }, [selectedDashboardDeposits, shipmentFilter]);

  const bucketOrders = useMemo(() => {
    if (operationalOrderIds.size === 0) return [];

    const depositScopedOrders =
      selectedDepositFilters.length === 0
        ? permittedOrders
        : permittedOrders.filter((order) =>
            selectedDepositFilters.includes(getDepositInfo(order).key)
          );

    return depositScopedOrders.filter((order) => operationalOrderIds.has(order.id));
  }, [operationalOrderIds, permittedOrders, selectedDepositFilters]);

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

  const readyOrders = useMemo(
    () => filteredOperationalOrders.filter(isOrderReadyToPrintLabel),
    [filteredOperationalOrders]
  );

  const isOperationalListIncomplete =
    ordersPagination.loading_more ||
    ordersPagination.has_more ||
    ordersPagination.loaded < ordersPagination.total;
  const isOperationalListFullyLoaded = ordersPagination.fully_loaded;
  const shouldShowProgressiveEmptyState =
    filteredOperationalOrders.length === 0 &&
    permittedOrders.length > 0 &&
    isOperationalListIncomplete;
  const canGenerateBatchLabels = readyOrders.length > 0 && isOperationalListFullyLoaded;

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
  const hasClientSideOperationalFilters =
    Boolean(searchQuery.trim()) ||
    hasQuickSalesFilters(appliedQuickFilters) ||
    getActiveFilterCount(appliedFilters) > 0 ||
    Boolean(operationalFocus);
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
  const sellerCenterMirrorStatusLabel =
    dashboard?.seller_center_mirror?.status === "ready" ? "Completo" : "Parcial";
  const sellerCenterMirrorNote =
    dashboard?.seller_center_mirror?.note ||
    "Espelhamento Seller Center ainda parcial.";
  const operationalQueues = dashboard?.operational_queues || null;
  const postSaleOverview = dashboard?.post_sale_overview || null;
  const privatePostSaleAudit = postSaleOverview?.private_audit || null;
  const operationalQueueCards = [
    {
      key: "ready_to_print",
      label: operationalQueues?.ready_to_print?.label || "Prontas para imprimir",
      count: operationalQueues?.ready_to_print?.count || 0,
      note: operationalQueues?.ready_to_print?.note || "",
      actionLabel: "Filtrar impressões",
      apply: () => handleApplyQuickStatusFilter("ready"),
    },
    {
      key: "invoice_pending",
      label: operationalQueues?.invoice_pending?.label || "NF-e pendente",
      count: operationalQueues?.invoice_pending?.count || 0,
      note: operationalQueues?.invoice_pending?.note || "",
      actionLabel: "Filtrar NF-e",
      apply: () => handleApplyQuickStatusFilter("invoice_pending"),
    },
    {
      key: "under_review",
      label: operationalQueues?.under_review?.label || "Em revisão",
      count: operationalQueues?.under_review?.count || 0,
      note: operationalQueues?.under_review?.note || "",
      actionLabel: "Filtrar revisão",
      apply: () => handleApplyQuickStatusFilter("under_review"),
    },
    {
      key: "collection_ready",
      label: operationalQueues?.collection_ready?.label || "Para coleta",
      count: operationalQueues?.collection_ready?.count || 0,
      note: operationalQueues?.collection_ready?.note || "",
      actionLabel: "Filtrar coleta",
      apply: () => handleApplyQuickStatusFilter("collection"),
    },
    {
      key: "nfe_sync_pending",
      label: operationalQueues?.nfe_sync_pending?.label || "NF-e com sync pendente",
      count: operationalQueues?.nfe_sync_pending?.count || 0,
      note: operationalQueues?.nfe_sync_pending?.note || "",
      actionLabel: null,
      apply: null,
    },
    {
      key: "nfe_attention",
      label: operationalQueues?.nfe_attention?.label || "NF-e com bloqueio ou erro",
      count: operationalQueues?.nfe_attention?.count || 0,
      note: operationalQueues?.nfe_attention?.note || "",
      actionLabel: null,
      apply: null,
    },
    {
      key: "post_sale_ui_attention",
      label: operationalQueues?.post_sale_ui_attention?.label || "Pós-venda auditado",
      count: operationalQueues?.post_sale_ui_attention?.count || 0,
      note: operationalQueues?.post_sale_ui_attention?.note || "",
      actionLabel: null,
      apply: null,
    },
  ];
  const privateComparisonViews = [...(privateComparison?.views || [])].sort((left, right) => {
    const leftKey = `${left.store || ""}::${left.selected_tab || ""}::${left.captured_at || ""}`;
    const rightKey = `${right.store || ""}::${right.selected_tab || ""}::${right.captured_at || ""}`;
    return leftKey.localeCompare(rightKey);
  });
  const privateSnapshotStatusLabel =
    privateComparison?.snapshot_status?.status === "available" ? "Capturado" : "Sem captura";
  const latestPrivateCaptureLabel = privateComparison?.snapshot_status?.last_captured_at
    ? formatSaleMoment(privateComparison.snapshot_status.last_captured_at)
    : "Nenhuma captura registrada";
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

        <div className="rounded-[28px] border border-[#e5e5e5] bg-white px-4 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)] sm:px-6 sm:py-7 lg:px-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-4 lg:gap-5">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] border-2 border-[#3483fa] bg-white text-[#3483fa] sm:h-16 sm:w-16 sm:rounded-[22px]">
                <Send className="h-7 w-7 sm:h-8 sm:w-8" />
              </div>
              <div className="max-w-[460px]">
                <h2 className="text-[24px] font-semibold leading-[1.15] tracking-[-0.02em] text-[#333333] sm:text-[31px] lg:text-[36px]">
                  Operação Mercado Livre sincronizada
                </h2>
              </div>
            </div>

            <div className="inline-flex items-center gap-2 self-start rounded-full border border-[#dfe7f6] bg-white px-4 py-3 text-[15px] text-[#333333] shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:text-[17px]">
              <Info className="h-4 w-4 text-[#3483fa]" />
              <span>
                Atualizado às <span className="font-semibold">{lastUpdateLabel}</span>
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-6 pt-6 lg:pt-20">
        <div className="rounded-[22px] border border-[#e6e6e6] bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="grid flex-1 gap-3 md:grid-cols-2 xl:grid-cols-[180px_180px_180px_auto_auto]">
              <Input
                type="date"
                value={draftQuickFilters.dateFrom}
                onChange={(event) =>
                  setDraftQuickFilters((current) => ({
                    ...current,
                    dateFrom: event.target.value,
                  }))
                }
                className="h-12 rounded-full border-[#e5e5e5] bg-white text-[15px] text-[#333333] focus-visible:ring-[#3483fa]"
              />

              <Input
                type="date"
                value={draftQuickFilters.dateTo}
                onChange={(event) =>
                  setDraftQuickFilters((current) => ({
                    ...current,
                    dateTo: event.target.value,
                  }))
                }
                className="h-12 rounded-full border-[#e5e5e5] bg-white text-[15px] text-[#333333] focus-visible:ring-[#3483fa]"
              />

              <Select
                value={draftQuickFilters.status}
                onValueChange={(value) =>
                  setDraftQuickFilters((current) => ({
                    ...current,
                    status: value as QuickSalesStatusFilter,
                  }))
                }
              >
                <SelectTrigger className="h-12 rounded-full border-[#e5e5e5] text-[15px]">
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
                className="h-12 rounded-full bg-[#3483fa] px-5 text-sm font-semibold text-white hover:bg-[#2968c8]"
                onClick={() => setAppliedQuickFilters({ ...draftQuickFilters })}
              >
                Buscar
              </Button>

              <Button
                type="button"
                variant="outline"
                className="h-12 rounded-full border-[#e5e5e5] px-5 text-sm font-semibold"
                onClick={() => {
                  setDraftQuickFilters(DEFAULT_QUICK_SALES_FILTERS);
                  setAppliedQuickFilters(DEFAULT_QUICK_SALES_FILTERS);
                }}
              >
                Limpar
              </Button>
            </div>
          </div>

          {quickFiltersSummaryText && (
            <div className="mt-3 text-sm text-[#666666]">{quickFiltersSummaryText}</div>
          )}
        </div>

        <div className="rounded-[22px] border border-[#dfe7f6] bg-[#f8fbff] px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="rounded-full border-[#bfd5ff] bg-white px-3 py-1 text-[#2d5fb7]">
                  Resumo operacional interno
                </Badge>
                <Badge variant="outline" className="rounded-full border-[#e7d8a2] bg-[#fff9e8] px-3 py-1 text-[#8b6b00]">
                  Seller Center: {sellerCenterMirrorStatusLabel}
                </Badge>
              </div>
              <p className="text-sm leading-6 text-[#52637f]">
                Os chips e cards abaixo usam a camada operacional interna já estabilizada. O
                Seller Center mirror continua {sellerCenterMirrorStatusLabel.toLowerCase()} e
                agora funciona como aproximação pública ancorada na operação interna. O pós-venda
                segue separado entre API pública e auditoria privada da UI.
              </p>
            </div>
            <div className="inline-flex items-start gap-2 rounded-[16px] border border-[#e6edf9] bg-white px-4 py-3 text-sm text-[#5d6c85]">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#3483fa]" />
              <span>{sellerCenterMirrorNote}</span>
            </div>
          </div>
        </div>

        <div className="rounded-[22px] border border-[#e7ecf3] bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-full border-[#dfe7f6] bg-[#f8fbff] px-3 py-1 text-[#2d5fb7]">
                    Filas operacionais
                  </Badge>
                  <Badge variant="outline" className="rounded-full border-[#e5e7eb] bg-white px-3 py-1 text-[#52637f]">
                    Pós-venda persistido: {postSaleOverview?.total_open || 0}
                  </Badge>
                </div>
                <p className="text-sm leading-6 text-[#5d6c85]">
                  Esta camada organiza o trabalho operacional do dia a dia sem trocar a origem dos
                  chips. Ela usa o resumo interno, a base fiscal local e o pós-venda persistido.
                </p>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              {operationalQueueCards.map((queue) => (
                <div
                  key={queue.key}
                  className="rounded-[18px] border border-[#edf1f6] bg-[#fbfcfe] px-4 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[#22304a]">{queue.label}</div>
                      <div className="mt-1 text-xs text-[#6b7a90]">{queue.note || "Sem detalhe adicional."}</div>
                    </div>
                    <div className="rounded-full bg-[#3483fa] px-3 py-1 text-sm font-semibold text-white">
                      {queue.count}
                    </div>
                  </div>

                  {queue.apply && queue.actionLabel && (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-4 rounded-full border-[#d9e4f6] bg-white text-[#2d5fb7] hover:bg-[#f4f8ff]"
                      onClick={queue.apply}
                    >
                      {queue.actionLabel}
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {postSaleOverview && (
              <div className="rounded-[18px] border border-[#efe7cf] bg-[#fffdf7] px-4 py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-[#7a5a00]">Pós-venda operacional</div>
                    <div className="mt-1 text-sm text-[#6f6239]">
                      Claims, returns e packs persistidos via API pública para acompanhamento do time.
                    </div>
                  </div>
                  <div className="rounded-full bg-white px-3 py-1 text-sm font-medium text-[#7a5a00]">
                    API pública: {postSaleOverview.total_open}
                  </div>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-3">
                  {(["claims", "returns", "packs"] as const).map((entityKey) => {
                    const entity = postSaleOverview.entities[entityKey];
                    return (
                      <div
                        key={entityKey}
                        className="rounded-[16px] border border-[#f0e5bf] bg-white px-4 py-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-semibold text-[#5f5124]">{entity.label}</span>
                          <span className="text-sm font-semibold text-[#7a5a00]">{entity.count}</span>
                        </div>
                        <div className="mt-1 text-xs text-[#8b7c4d]">
                          Sync: {entity.implementation_status} • última atualização{" "}
                          {entity.last_synced_at ? formatSaleMoment(entity.last_synced_at) : "não sincronizada"}
                        </div>
                        {entity.status_breakdown && entity.status_breakdown.length > 0 && (
                          <div className="mt-3 space-y-2 text-sm text-[#5f5124]">
                            {entity.status_breakdown.slice(0, 4).map((item) => (
                              <div
                                key={`${entityKey}-${item.raw_status}`}
                                className="flex items-center justify-between gap-3"
                              >
                                <span>{item.raw_status}</span>
                                <span className="font-medium">{item.count}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {privatePostSaleAudit?.status === "available" && (
                  <div className="mt-4 rounded-[16px] border border-[#f0e5bf] bg-white px-4 py-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-[#5f5124]">
                          Auditoria privada de pós-venda
                        </div>
                        <div className="mt-1 text-sm text-[#7d6d3d]">
                          Usa cards e subtarefas da UI privada do Seller Center para mostrar
                          devoluções e itens que exigem ação. Não substitui claims e returns da
                          API pública.
                        </div>
                      </div>
                      <div className="rounded-full bg-[#fff7de] px-3 py-1 text-sm font-medium text-[#8b6b00]">
                        Ação requerida: {privatePostSaleAudit.totals.action_required}
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-4">
                      {[
                        {
                          key: "returns_in_progress",
                          label: "Devoluções em andamento",
                          count: privatePostSaleAudit.totals.returns_in_progress,
                        },
                        {
                          key: "in_review",
                          label: "Em revisão",
                          count: privatePostSaleAudit.totals.in_review,
                        },
                        {
                          key: "completed",
                          label: "Concluídas",
                          count: privatePostSaleAudit.totals.completed,
                        },
                        {
                          key: "not_completed",
                          label: "Não concluídas",
                          count: privatePostSaleAudit.totals.not_completed,
                        },
                      ].map((item) => (
                        <div
                          key={item.key}
                          className="rounded-[14px] border border-[#f0e5bf] bg-[#fffdf7] px-4 py-3"
                        >
                          <div className="text-xs uppercase tracking-[0.04em] text-[#8b7c4d]">
                            {item.label}
                          </div>
                          <div className="mt-2 text-[20px] font-semibold text-[#5f5124]">
                            {item.count}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 grid gap-3 xl:grid-cols-3">
                      {privatePostSaleAudit.views.slice(0, 6).map((view) => (
                        <div
                          key={`${view.store}-${view.selected_tab}-${view.captured_at}`}
                          className="rounded-[14px] border border-[#f3ead1] bg-[#fffef9] px-4 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold text-[#5f5124]">
                              {view.view_label}
                            </span>
                            <span className="text-sm font-semibold text-[#8b6b00]">
                              {view.operational_count}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-[#8b7c4d]">
                            {view.selected_tab_label} • fonte {view.source === "cards_tasks" ? "cards" : view.source === "button" ? "botão" : "n/d"}
                          </div>
                          <div className="mt-3 space-y-2 text-sm text-[#5f5124]">
                            <div className="flex items-center justify-between gap-3">
                              <span>Em revisão</span>
                              <span className="font-medium">{view.in_review}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span>Não concluídas</span>
                              <span className="font-medium">{view.not_completed}</span>
                            </div>
                            <div className="flex items-center justify-between gap-3">
                              <span>Botão bruto</span>
                              <span className="font-medium">{view.raw_button_count}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[22px] border border-[#eadfbe] bg-[#fffdf7] px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className="rounded-full border-[#ecd9a2] bg-white px-3 py-1 text-[#8b6b00]"
                  >
                    Auditoria Seller Center
                  </Badge>
                  <Badge
                    variant="outline"
                    className="rounded-full border-[#dfe3ea] bg-white px-3 py-1 text-[#52637f]"
                  >
                    Snapshot privado: {privateSnapshotStatusLabel}
                  </Badge>
                </div>
                <p className="text-sm leading-6 text-[#5d6c85]">
                  Esta seção compara a captura privada autenticada do Seller Center com a camada
                  operacional interna e com o espelhamento local atual. Ela não substitui a
                  integração pública do Mercado Livre.
                </p>
              </div>

              <div className="flex flex-col items-start gap-3 lg:items-end">
                <div className="inline-flex items-start gap-2 rounded-[16px] border border-[#efe7cf] bg-white px-4 py-3 text-sm text-[#6b5b1a]">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#b18500]" />
                  <span>Última captura: {latestPrivateCaptureLabel}</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full border-[#e5d6a0] bg-white text-[#6b5b1a] hover:bg-[#fff7de]"
                  onClick={() => void loadPrivateComparison()}
                  disabled={privateComparisonLoading}
                >
                  {privateComparisonLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Atualizando auditoria
                    </>
                  ) : (
                    "Atualizar auditoria"
                  )}
                </Button>
              </div>
            </div>

            {privateComparisonError && (
              <div className="rounded-[16px] border border-[#f3d4d4] bg-[#fff7f7] px-4 py-3 text-sm text-[#9b3b3b]">
                {privateComparisonError}
              </div>
            )}

            {!privateComparisonLoading && privateComparisonViews.length === 0 && !privateComparisonError && (
              <div className="rounded-[18px] border border-dashed border-[#e5d6a0] bg-white px-5 py-5 text-sm text-[#6f6f6f]">
                Nenhum snapshot privado do Seller Center foi persistido ainda. A captura técnica
                pode ser enviada depois via Playwright para comparar a UI autenticada com o banco
                local por visão.
              </div>
            )}

            {privateComparisonViews.length > 0 && (
              <div className="space-y-4">
                {privateComparisonViews.map((view) => (
                  <div
                    key={`${view.store}-${view.selected_tab || "tab"}-${view.captured_at}`}
                    className="rounded-[18px] border border-[#efe7cf] bg-white px-4 py-4"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[16px] font-semibold text-[#333333]">
                            {view.view_label || view.store}
                          </span>
                          <Badge variant="outline" className="rounded-full border-[#e6e6e6] bg-white px-3 py-1 text-[#666666]">
                            {view.selected_tab_label || view.selected_tab || "Sem tab"}
                          </Badge>
                        </div>
                        <div className="text-sm text-[#6f6f6f]">
                          Capturado em {formatSaleMoment(view.captured_at)}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 text-xs">
                        <Badge variant="outline" className="rounded-full border-[#dfe3ea] bg-[#f8fafc] text-[#52637f]">
                          Pedidos locais: {view.persisted_entities.orders}
                        </Badge>
                        <Badge variant="outline" className="rounded-full border-[#dfe3ea] bg-[#f8fafc] text-[#52637f]">
                          Packs: {view.persisted_entities.packs}
                        </Badge>
                        <Badge variant="outline" className="rounded-full border-[#dfe3ea] bg-[#f8fafc] text-[#52637f]">
                          Claims: {view.persisted_entities.claims}
                        </Badge>
                        <Badge variant="outline" className="rounded-full border-[#dfe3ea] bg-[#f8fafc] text-[#52637f]">
                          Returns: {view.persisted_entities.returns}
                        </Badge>
                        <Badge variant="outline" className="rounded-full border-[#dfe3ea] bg-[#f8fafc] text-[#52637f]">
                          Pós-venda auditado: {view.private_snapshot.post_sale_count}
                        </Badge>
                        <Badge variant="outline" className="rounded-full border-[#dfe3ea] bg-[#f8fafc] text-[#52637f]">
                          Botão bruto: {view.private_snapshot.post_sale_button_count_raw || 0}
                        </Badge>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-3">
                      <div className="rounded-[16px] border border-[#ececec] bg-[#fbfbfb] px-4 py-4">
                        <div className="text-sm font-semibold text-[#333333]">UI privada</div>
                        <div className="mt-3 space-y-2 text-sm text-[#555555]">
                          {SHIPMENT_FILTERS.map((filterOption) => (
                            <div key={`private-${view.store}-${filterOption.key}`} className="flex items-center justify-between gap-3">
                              <span>{filterOption.label}</span>
                              <span className="font-semibold text-[#333333]">
                                {view.private_snapshot.counts[filterOption.key]}
                              </span>
                            </div>
                          ))}
                          <div className="border-t border-[#ececec] pt-2 text-xs text-[#6f6f6f]">
                            Pós-venda por {view.private_snapshot.post_sale_source === "cards_tasks" ? "cards e subtarefas" : view.private_snapshot.post_sale_source === "button" ? "botão" : "sem sinal confiável"}.
                          </div>
                        </div>
                      </div>

                      <div className="rounded-[16px] border border-[#dfe7f6] bg-[#f8fbff] px-4 py-4">
                        <div className="text-sm font-semibold text-[#2d5fb7]">
                          Resumo operacional interno
                        </div>
                        <div className="mt-3 space-y-2 text-sm text-[#4f6488]">
                          {SHIPMENT_FILTERS.map((filterOption) => (
                            <div key={`internal-${view.store}-${filterOption.key}`} className="flex items-center justify-between gap-3">
                              <span>{filterOption.label}</span>
                              <div className="text-right">
                                <div className="font-semibold text-[#2d5fb7]">
                                  {view.internal_operational.counts[filterOption.key]}
                                </div>
                                <div className={`text-xs ${getDeltaTone(view.differences.internal_minus_private[filterOption.key])}`}>
                                  Δ {formatCountDelta(view.differences.internal_minus_private[filterOption.key])}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-[16px] border border-[#efe2b4] bg-[#fff9e8] px-4 py-4">
                        <div className="text-sm font-semibold text-[#8b6b00]">
                          Seller Center mirror local
                        </div>
                        <div className="mt-3 space-y-2 text-sm text-[#6f5a19]">
                          {SHIPMENT_FILTERS.map((filterOption) => (
                            <div key={`mirror-${view.store}-${filterOption.key}`} className="flex items-center justify-between gap-3">
                              <span>{filterOption.label}</span>
                              <div className="text-right">
                                <div className="font-semibold text-[#8b6b00]">
                                  {view.seller_center_mirror.counts[filterOption.key]}
                                </div>
                                <div className={`text-xs ${getDeltaTone(view.differences.mirror_minus_private[filterOption.key])}`}>
                                  Δ {formatCountDelta(view.differences.mirror_minus_private[filterOption.key])}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {view.private_snapshot.cards.length > 0 && (
                      <div className="mt-4 rounded-[16px] border border-[#efefef] bg-[#fafafa] px-4 py-4">
                        <div className="mb-3 text-sm font-semibold text-[#333333]">
                          Cards observados na UI privada
                        </div>
                        <div className="grid gap-3 xl:grid-cols-3">
                          {view.private_snapshot.cards.slice(0, 6).map((card) => (
                            <div
                              key={`${view.store}-${card.key}`}
                              className="rounded-[14px] border border-[#ececec] bg-white px-4 py-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-semibold text-[#333333]">
                                  {card.label}
                                </span>
                                <span className="text-sm font-semibold text-[#333333]">
                                  {card.count}
                                </span>
                              </div>
                              {card.tag && (
                                <div className="mt-1 text-xs uppercase tracking-[0.04em] text-[#8a8a8a]">
                                  {card.tag}
                                </div>
                              )}
                              {card.tasks.length > 0 && (
                                <div className="mt-3 space-y-2 text-sm text-[#666666]">
                                  {card.tasks.slice(0, 4).map((task) => (
                                    <div
                                      key={`${card.key}-${task.key}`}
                                      className="flex items-center justify-between gap-3"
                                    >
                                      <span>{task.label}</span>
                                      <span className="font-medium text-[#333333]">{task.count}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-[22px] border border-[#e6e6e6] bg-[#f3f3f3] px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              {SHIPMENT_FILTERS.map((filterOption) => {
                const active = shipmentFilter === filterOption.key;
                const count = shipmentCounts[filterOption.key];

                return (
                  <button
                    key={filterOption.key}
                    type="button"
                    onClick={() => handleShipmentBucketSelect(filterOption.key)}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-[17px] font-semibold transition-colors ${
                      active
                        ? "bg-white text-[#333333] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                        : "text-[#666666] hover:bg-white/70"
                    }`}
                  >
                    <span>{filterOption.label}</span>
                    <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[#3483fa] px-1.5 py-0.5 text-xs font-bold text-white">
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="inline-flex items-center gap-2 rounded-full border border-[#e6e6e6] bg-white px-4 py-2 text-[17px] text-[#5a6d92] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
              <span className="font-medium">Etiquetas imprimíveis</span>
              <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-[#3483fa] px-1.5 py-0.5 text-xs font-bold text-white">
                {readyOrders.length}
              </span>
            </div>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-4">
            {operationalCards.map(({ deposit, presentation }) => (
              <div
                key={deposit.key}
                className="rounded-[18px] border border-[#e4e4e4] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-[#666666]">
                      {presentation.lane}
                    </div>
                    <div className="mt-2 text-[18px] font-semibold leading-6 text-[#333333]">
                      {presentation.headline}
                    </div>
                  </div>
                  <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-[#f1f1f1] px-2 py-1 text-xs font-semibold text-[#666666]">
                    {presentation.totalCount}
                  </span>
                </div>

                <div className="mt-5 space-y-3">
                  {presentation.summaryRows.map((row) => (
                    <button
                      key={`${deposit.key}-${row.key}`}
                      type="button"
                      disabled={row.count === 0}
                      onClick={() =>
                        handleOperationalSummarySelect(
                          deposit.key,
                          row.key as OperationalSummaryKey
                        )
                      }
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1 text-left transition-colors ${
                        operationalFocus?.depositKey === deposit.key &&
                        operationalFocus?.summaryKey === row.key
                          ? "bg-[#dbe8ff]"
                          : row.key === "ready"
                            ? "bg-[#fff159] hover:bg-[#ffef8a]"
                            : "bg-transparent hover:bg-[#f5f8ff]"
                      } ${row.count === 0 ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      <span className="text-[15px] text-[#666666]">{row.label}</span>
                      <span className="text-[15px] font-medium text-[#555555]">{row.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {Array.from({ length: placeholderCardCount }).map((_, index) => (
              <div
                key={`placeholder-${index}`}
                className="rounded-[18px] border border-[#e4e4e4] bg-[#efefef]"
              />
            ))}
          </div>
        </div>

        <div className="rounded-[22px] border border-[#e6e6e6] bg-white px-5 py-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-1 flex-wrap items-center gap-3">
              <div className="relative w-full max-w-[340px]">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#999999]" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Buscar"
                  className="h-12 rounded-full border-[#e5e5e5] bg-white pl-11 text-[15px] text-[#333333] placeholder:text-[#999999] focus-visible:ring-[#3483fa]"
                />
              </div>

              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-full border-[#e5e5e5] px-4"
                onClick={() => {
                  setDraftFilters(cloneFilters(appliedFilters));
                  setFiltersOpen(true);
                }}
              >
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                Filtrar e ordenar
                {activeFilterCount > 0 && (
                  <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-[#3483fa] px-1.5 py-0.5 text-xs font-semibold text-white">
                    {activeFilterCount}
                  </span>
                )}
              </Button>

              {hasToolbarFilters && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 rounded-full px-4 text-[#3483fa] hover:bg-[#eef4ff] hover:text-[#2968c8]"
                  onClick={clearToolbarFilters}
                >
                  Desmarcar filtros
                </Button>
              )}
            </div>

            <div className="text-[15px] font-semibold text-[#666666]">
              {headlineOrdersCount} venda{headlineOrdersCount === 1 ? "" : "s"}
              {shouldShowPartialBucketProgress && (
                <span className="ml-2 text-xs font-medium text-[#8a6d1f]">
                  {visibleBucketOrderCount} já carregada
                  {visibleBucketOrderCount === 1 ? "" : "s"} na lista
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[15px]">
            {contextFilterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.remove}
                disabled={!chip.removable}
                className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 ${
                  chip.tone === "primary"
                    ? "border-[#d9e7ff] bg-[#eef4ff] text-[#3483fa]"
                    : "border-[#ececec] bg-[#f8f8f8] text-[#666666]"
                } ${chip.removable ? "transition-colors hover:border-[#c5d8ff] hover:bg-[#f4f8ff]" : ""}`}
              >
                <span>{chip.label}</span>
                {chip.removable && <X className="h-3.5 w-3.5" />}
              </button>
            ))}
            {activeFilterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.remove}
                className="inline-flex items-center gap-2 rounded-full border border-[#d9e7ff] bg-[#eef4ff] px-3 py-1.5 text-sm text-[#3483fa]"
              >
                <span>{chip.label}</span>
                <X className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>

          <div className="mt-3 text-sm text-[#666666]">
            {shouldShowPartialBucketProgress
              ? `O resumo operacional deste bucket mostra ${selectedBucketTotalCount} pedido(s). ${visibleBucketOrderCount} já foram carregados na lista; o restante entra progressivamente para preservar a performance.`
              : searchQuery.trim()
                ? `A listagem foi atualizada com busca por "${searchQuery.trim()}" e filtros aplicados em tempo real sobre o dataset operacional.`
                : quickFiltersSummaryText || filtersSummaryText}
          </div>

          {isOperationalListIncomplete && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-[#d9e7ff] bg-[#f4f8ff] px-4 py-3 text-sm text-[#4f658e]">
              <Loader2 className="h-4 w-4 animate-spin text-[#3483fa]" />
              <span>
                Carregando o restante da base operacional em páginas leves para manter o grid
                responsivo.{" "}
                {shouldShowPartialBucketProgress
                  ? `${visibleBucketOrderCount} de ${selectedBucketTotalCount} pedido(s) do bucket atual já foram carregados.`
                  : `${ordersPagination.loaded} de ${ordersPagination.total} pedido(s) operacional(is) já foram carregados.`}
              </span>
              {ordersPagination.has_more && (
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-full border-[#c8dafc] bg-white text-[#2968c8] hover:bg-[#eef4ff]"
                  onClick={() => void loadMoreOrders()}
                  disabled={ordersPagination.loading_more}
                >
                  Carregar mais agora
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="rounded-[18px] border border-[#e6e6e6] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#3483fa] text-white">
                <Check className="h-4 w-4" />
              </span>
              <div className="text-[15px] text-[#333333]">
                <span className="font-semibold">{readyOrders.length} elegível(is)</span>
                <span className="ml-2 text-[#666666]">para impressão real de etiquetas</span>
              </div>
            </div>

            <Button
              className="h-11 rounded-lg bg-[#3483fa] px-5 text-sm font-semibold text-white hover:bg-[#2968c8]"
              disabled={!canGenerateBatchLabels}
              onClick={() => handleGenerateLabels(readyOrders)}
            >
              {isOperationalListFullyLoaded
                ? `Gerar Etiquetas (${readyOrders.length})`
                : `Carregando base completa (${readyOrders.length})`}
            </Button>
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
        ) : filteredOperationalOrders.length === 0 ? (
          <div className="rounded-[20px] border border-[#e6e6e6] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
            <Search className="mx-auto mb-3 h-8 w-8 text-[#bdbdbd]" />
            <p className="text-[16px] font-semibold text-[#333333]">
              Nenhum pedido encontrado para os filtros aplicados.
            </p>
            <p className="mt-1 text-[15px] text-[#666666]">
              Ajuste a busca, remova filtros ativos ou troque o bucket operacional.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {filteredOperationalOrders.map((order) => {
              const deposit = getDepositInfo(order);
              const shipment = getShipmentPresentation(order);
              const buyerName =
                order.buyer_name || order.buyer_nickname || "Comprador não identificado";
              const buyerType = getBuyerType(order);
              const eligibleForLabel = isOrderReadyToPrintLabel(order);
              const orderItems = getDisplayOrderItems(order);
              const packageProductsCount = orderItems.length;
              const totalUnits = orderItems.reduce(
                (total, item) => total + Math.max(0, item.quantity || 0),
                0
              );
              const packageAmount = orderItems.reduce(
                (total, item) => total + (item.amount ?? 0),
                0
              );
              const isExpanded = expandedOrders[order.id] ?? true;

              return (
                <article
                  key={order.id}
                  className="overflow-hidden rounded-[18px] border border-[#e5e5e5] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                >
                  <div className="border-b border-[#ededed] px-5 py-4">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                      <div className="flex flex-wrap items-center gap-3 text-[14px] text-[#666666]">
                        <span className="inline-flex h-7 items-center rounded-full bg-[#fff159] px-2.5 text-[13px] font-semibold text-[#333333]">
                          ML
                        </span>
                        {deposit.hasDeposit && (
                          <span className="inline-flex items-center rounded-full bg-[#f0f0f0] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.02em] text-[#7a7a7a]">
                            {deposit.displayLabel}
                          </span>
                        )}
                        <span className="text-[15px] font-semibold text-[#6a6a6a]">
                          #{order.sale_number}
                        </span>
                        <span>|</span>
                        <span>{formatSaleMoment(order.sale_date)}</span>
                      </div>

                      <div className="flex flex-col gap-1 text-left xl:items-end xl:text-right">
                        <div className="text-[15px] font-medium text-[#666666]">{buyerName}</div>
                        {order.buyer_nickname && (
                          <div className="text-[13px] text-[#8a8a8a]">{order.buyer_nickname}</div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="px-5 py-6">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-[29px] font-semibold leading-none text-[#ff6d1b]">
                          {isOrderInvoicePending(order)
                            ? "Pronta para emitir NF-e de venda"
                            : shipment.title}
                        </p>
                        <p className="mt-3 text-[15px] text-[#666666]">
                          {isOrderInvoicePending(order)
                            ? "Logo poderá imprimir a etiqueta de envio"
                            : shipment.description}
                        </p>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <Badge variant="outline">
                            {buyerType === "business" ? "Negócio" : "Pessoa"}
                          </Badge>
                          {isOrderInvoicePending(order) && (
                            <Badge variant="secondary">NF-e sem emitir</Badge>
                          )}
                          {isOrderUnderReview(order) && (
                            <Badge variant="destructive">Em revisão</Badge>
                          )}
                          {isOrderForCollection(order) && (
                            <Badge variant="outline">Para coleta</Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          variant="outline"
                          className="h-10 rounded-lg border-[#d9e7ff] text-[#2968c8] hover:bg-[#eef4ff]"
                          onClick={() => handleOpenDocumentsDialog(order)}
                        >
                          <FileText className="mr-2 h-4 w-4" />
                          Documentos
                        </Button>
                        <Button
                          variant={eligibleForLabel ? "default" : "outline"}
                          className={`h-10 rounded-lg px-5 ${
                            eligibleForLabel
                              ? "bg-[#3483fa] text-white hover:bg-[#2968c8]"
                              : "border-[#d8d8d8] text-[#8a8a8a]"
                          }`}
                          disabled={!eligibleForLabel}
                          onClick={() => handleGenerateLabels([order])}
                        >
                          {eligibleForLabel ? "Gerar etiqueta" : "Não elegível"}
                          <ChevronsRight className="ml-2 h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 pb-5">
                    <div className="overflow-hidden rounded-[14px] bg-[#f7f7f7]">
                      <div className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-4 px-5 py-5 text-[15px] text-[#666666]">
                        <button
                          type="button"
                          onClick={() => handleToggleExpandedOrder(order.id)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#3483fa] transition hover:bg-white"
                          aria-label={isExpanded ? "Recolher pacote" : "Expandir pacote"}
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-5 w-5" />
                          ) : (
                            <ChevronDown className="h-5 w-5" />
                          )}
                        </button>
                        <div className="font-medium text-[#666666]">
                          Pacote de {packageProductsCount} produto
                          {packageProductsCount > 1 ? "s" : ""}
                        </div>
                        <div className="text-right">{formatCurrency(packageAmount)}</div>
                        <div className="text-right">
                          {totalUnits} unidade{totalUnits > 1 ? "s" : ""}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="border-t border-[#ebebeb] bg-[#fafafa]">
                          {orderItems.map((item, index) => {
                            const itemImageUrl = item.product_image_url || order.product_image_url;
                            const itemTitle = item.item_title || "Produto sem título";

                            return (
                              <div
                                key={`${order.id}-${item.item_id || item.sku || index}`}
                                className={`grid grid-cols-[auto_1fr_auto_auto_auto] items-center gap-4 px-5 py-5 ${
                                  index > 0 ? "border-t border-[#ededed]" : ""
                                }`}
                              >
                                <div className="flex h-[58px] w-[58px] items-center justify-center overflow-hidden rounded-full border border-[#ededed] bg-white">
                                  {itemImageUrl ? (
                                    <img
                                      src={itemImageUrl}
                                      alt={itemTitle}
                                      className="h-full w-full object-cover"
                                    />
                                  ) : (
                                    <span className="px-2 text-center text-[10px] font-semibold text-[#999999]">
                                      {item.sku || getOrderImageFallback(order)}
                                    </span>
                                  )}
                                </div>

                                <div className="min-w-0">
                                  <div className="truncate text-[16px] text-[#666666]">
                                    {itemTitle}
                                  </div>
                                </div>

                                <div className="text-right text-[16px] text-[#666666]">
                                  {formatCurrency(item.amount)}
                                </div>
                                <div className="text-right text-[16px] text-[#666666]">
                                  {item.quantity} unidade{item.quantity > 1 ? "s" : ""}
                                </div>
                                <div className="text-right text-[16px] text-[#8a8a8a]">
                                  {item.sku ? `SKU: ${item.sku}` : "Sem SKU"}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}

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
        <DialogContent className="sm:max-w-[920px]">
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
          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-3 rounded-2xl border border-border/60 p-4">
              <Label className="text-sm font-semibold">Ordenação</Label>
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
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3 rounded-2xl border border-dashed border-border/60 bg-secondary/20 p-4">
              <Label className="text-sm font-semibold">Canal fixo do painel</Label>
              <div className="rounded-xl border border-border/60 bg-white px-3 py-3 text-sm text-muted-foreground">
                Mercado Livre. Este canal é informativo nesta tela e não gera filtro adicional.
              </div>
            </div>
            <div className="space-y-3 rounded-2xl border border-border/60 p-4">
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
            </div>
            <div className="space-y-3 rounded-2xl border border-border/60 p-4">
              <Label className="text-sm font-semibold">Status</Label>
              <div className="space-y-3">
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
            </div>
            <div className="space-y-3 rounded-2xl border border-border/60 p-4">
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
            </div>
            <div className="space-y-3 rounded-2xl border border-dashed border-border/60 bg-secondary/20 p-4 text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">Filtros nativos x operacionais</p>
              <p>
                NF-e sem emitir usa shipment.substatus e é tratado como filtro nativo da API.
                Pessoa/Negócio, Em revisão e Para coleta continuam disponíveis, mas aparecem como
                classificação operacional porque dependem da combinação local de status,
                pagamentos, tags, flows, logistic_type e shipping_option.
              </p>
            </div>
          </div>
          <DialogFooter className="flex flex-col gap-3 sm:flex-row sm:justify-between">
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



