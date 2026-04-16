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
  CircleAlert,
  FileText,
  Info,
  Link2,
  Loader2,
  Receipt,
  Search,
  Send,
  ShoppingCart,
  SlidersHorizontal,
  Tag,
  Printer,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  generateMLNFe,
  getMLNFeDocument,
  getMLOrderDocuments,
  mapMLOrdersToProcessingResults,
  mapMLOrderToSaleData,
  type MLDashboardDeposit,
  type MLNFeResponse,
  type MLOrderDocumentsResponse,
  type MLOrder,
  syncMLNFeWithMercadoLivre,
  startMLOAuth,
} from "@/services/mercadoLivreService";
import { exportSalePdf } from "@/services/pdfExportService";
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

// ─── Lista Virtualizada ───────────────────────────────────────────
// Renderiza apenas os cards visíveis na tela (~5-8 de cada vez) ao invés
// de todos os 300+. Reduz drasticamente o uso de memória e DOM nodes.
function VirtualizedOrderList({
  orders,
  onOpenDocuments,
  selectedOrderIds,
  onToggleSelect,
  onPrintInternalLabel,
  onGenerateNFe,
  onPrintMlLabel,
  generatingNFeForOrderId,
  printingLabelForOrderId,
}: {
  orders: MLOrder[];
  onOpenDocuments: (order: MLOrder) => void;
  selectedOrderIds: Set<string>;
  onToggleSelect: (orderId: string) => void;
  onPrintInternalLabel: (order: MLOrder) => void;
  onGenerateNFe: (order: MLOrder) => void;
  onPrintMlLabel: (order: MLOrder) => void;
  generatingNFeForOrderId: string | null;
  printingLabelForOrderId: string | null;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  // Offset do container em relacao ao topo do documento — o windowVirtualizer
  // usa pra calcular o inicio da area virtualizada, ja que o scroll agora e
  // do proprio body (nao de um div interno). Observa mudancas no layout
  // (filtros abrem/fecham) pra recalcular sem gap visual.
  const [scrollMargin, setScrollMargin] = useState(0);

  useEffect(() => {
    if (!parentRef.current) return;
    const measure = () => {
      if (parentRef.current) {
        setScrollMargin(parentRef.current.getBoundingClientRect().top + window.scrollY);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: orders.length,
    // Preview da etiqueta fica sempre visivel — altura estimada inclui o
    // cabecalho + secao NF-e + SaleCardPreview (~280px p/ 1 item, +140px
    // por item extra). measureElement corrige qualquer divergencia real.
    estimateSize: (index) => {
      const order = orders[index];
      const itemCount = Math.max(1, order?.items?.length || 1);
      const previewHeight = 280 + Math.max(0, itemCount - 1) * 140;
      return 320 + previewHeight;
    },
    overscan: 3,
    scrollMargin,
  });

  return (
    <div ref={parentRef}>
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const order = orders[virtualRow.index];
          const deposit = getDepositInfo(order);
          const shipment = getShipmentPresentation(order);
          const buyerType = getBuyerType(order);

          return (
            <div
              key={order.id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              }}
            >
              <article className="mb-3 overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] sm:mb-4">
                <div className="border-b border-[#ededed] px-3 py-3 sm:px-5 sm:py-4">
                  <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#666666] sm:gap-3 sm:text-[14px]">
                    <Checkbox
                      checked={selectedOrderIds.has(order.id)}
                      onCheckedChange={() => onToggleSelect(order.id)}
                      aria-label={`Selecionar pedido ${order.sale_number}`}
                    />
                    <span className="inline-flex h-6 items-center rounded-full bg-[#fff159] px-2 text-[12px] font-semibold text-[#333333] sm:h-7 sm:px-2.5 sm:text-[13px]">
                      ML
                    </span>
                    {deposit.hasDeposit && (
                      <span className="inline-flex items-center rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.02em] text-[#7a7a7a] sm:px-3 sm:py-1 sm:text-[12px]">
                        {deposit.displayLabel}
                      </span>
                    )}
                    <span className="text-[14px] font-semibold text-[#6a6a6a] sm:text-[15px]">
                      #{order.sale_number}
                    </span>
                    <span className="hidden sm:inline">|</span>
                    <span className="w-full sm:w-auto">{formatSaleMoment(order.sale_date)}</span>
                  </div>
                </div>

                <div className="px-3 py-4 sm:px-5 sm:py-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-5">
                    <div className="min-w-0 flex-1">
                      <p className="text-[20px] font-semibold leading-tight text-[#ff6d1b] sm:text-[24px] lg:text-[28px] lg:leading-none">
                        {isOrderInvoicePending(order)
                          ? "Pronta para emitir NF-e"
                          : shipment.title}
                      </p>
                      <p className="mt-2 text-[13px] text-[#666666] sm:mt-3 sm:text-[15px]">
                        {isOrderInvoicePending(order)
                          ? "Pagamento aprovado e expedição liberada para gerar etiqueta."
                          : shipment.description}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5 sm:mt-4 sm:gap-2">
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
                    {(() => {
                      const nfeEligible = isOrderInvoicePending(order);
                      const labelEligible = isOrderReadyToPrintLabel(order);
                      const isGeneratingNFe = generatingNFeForOrderId === order.order_id;
                      const isPrintingLabel = printingLabelForOrderId === order.order_id;

                      // Sequencia de botoes (esquerda -> direita) na mesma
                      // ordem do banner de acoes em lote no topo da pagina:
                      //   [Gerar NF-e laranja] [Etiqueta ML + DANFe amarelo]
                      //   [Etiqueta Ecoferro verde] [Documentos azul outline]
                      // Todos no mesmo grupo horizontal pra manter a leitura
                      // continua — o operador repete o mesmo fluxo visual
                      // seja no banner em lote, seja no card individual.
                      return (
                        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2 lg:flex-nowrap lg:justify-end lg:gap-2.5">
                          {/* Gerar NF-e: so clicavel quando o pedido esta aguardando emissao da NF-e. */}
                          <Button
                            disabled={!nfeEligible || isGeneratingNFe}
                            className="h-11 w-full rounded-lg bg-[#ff6d1b] px-4 text-[14px] font-semibold text-white shadow-[0_1px_3px_rgba(255,109,27,0.28)] transition hover:bg-[#e65c10] hover:shadow-[0_2px_6px_rgba(255,109,27,0.4)] disabled:cursor-not-allowed disabled:bg-[#f1f1f1] disabled:text-[#a0a0a0] disabled:shadow-none sm:w-auto sm:text-sm"
                            onClick={() => onGenerateNFe(order)}
                            title={
                              nfeEligible
                                ? "Solicitar emissao da NF-e de venda"
                                : "NF-e ja emitida ou pedido ainda nao elegivel"
                            }
                          >
                            {isGeneratingNFe ? (
                              <Loader2 className="mr-1.5 h-4 w-4 animate-spin sm:mr-2" />
                            ) : (
                              <Receipt className="mr-1.5 h-4 w-4 sm:mr-2" />
                            )}
                            Gerar NF-e
                          </Button>
                          {/* Imprimir etiqueta ML + DANFe: so clicavel quando o pedido esta pronto para impressao. */}
                          <Button
                            disabled={!labelEligible || isPrintingLabel}
                            className="h-11 w-full rounded-lg bg-[#fff159] px-4 text-[14px] font-semibold text-[#333333] shadow-[0_1px_3px_rgba(255,241,89,0.6)] transition hover:bg-[#ffe924] hover:shadow-[0_2px_6px_rgba(255,241,89,0.8)] disabled:cursor-not-allowed disabled:bg-[#f1f1f1] disabled:text-[#a0a0a0] disabled:shadow-none sm:w-auto sm:text-sm"
                            onClick={() => onPrintMlLabel(order)}
                            title={
                              labelEligible
                                ? "Imprimir etiqueta ML + DANFe"
                                : "Aguardando emissao da NF-e para liberar a impressao"
                            }
                          >
                            {isPrintingLabel ? (
                              <Loader2 className="mr-1.5 h-4 w-4 animate-spin sm:mr-2" />
                            ) : (
                              <Printer className="mr-1.5 h-4 w-4 sm:mr-2" />
                            )}
                            <span className="truncate">Etiqueta ML + DANFe</span>
                          </Button>
                          {/* Etiqueta Ecoferro: mesma paleta verde do botao em lote do
                              banner (cor/shadow/peso), reforcando que e' a mesma acao
                              (etiqueta interna com logo Ecoferro) aplicada a um pedido. */}
                          <Button
                            className="h-11 w-full rounded-lg bg-[#22c55e] px-4 text-[14px] font-semibold text-white shadow-[0_1px_3px_rgba(34,197,94,0.28)] transition hover:bg-[#16a34a] hover:shadow-[0_2px_6px_rgba(34,197,94,0.4)] disabled:cursor-not-allowed disabled:bg-[#f1f1f1] disabled:text-[#a0a0a0] disabled:shadow-none sm:w-auto sm:text-sm"
                            onClick={() => onPrintInternalLabel(order)}
                            title="Etiqueta interna com logo Ecoferro"
                          >
                            <Tag className="mr-1.5 h-4 w-4 sm:mr-2" />
                            Etiqueta Ecoferro
                          </Button>
                          {/* Documentos: acao secundaria (outline) — apenas visualiza
                              documentos do pedido, nao gera nada novo. Fica ao lado
                              dos botoes de geracao pra acesso rapido sem competir
                              visualmente com eles. */}
                          <Button
                            variant="outline"
                            className="h-11 w-full rounded-lg border-[#d9e7ff] bg-white px-4 text-[13px] font-semibold text-[#2968c8] hover:bg-[#eef4ff] sm:w-auto sm:text-sm"
                            onClick={() => onOpenDocuments(order)}
                          >
                            <FileText className="mr-1.5 h-4 w-4 sm:mr-2" />
                            Documentos
                          </Button>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                <div className="px-2 pb-3 sm:px-5 sm:pb-5">
                  <SaleCardPreview sale={mapMLOrderToSaleData(order)} mode="embedded" />
                </div>
              </article>
            </div>
          );
        })}
      </div>
    </div>
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
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [bulkPrintingMl, setBulkPrintingMl] = useState(false);
  const [bulkGeneratingNFe, setBulkGeneratingNFe] = useState(false);
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
      await refresh();
    } catch {
      // O hook já controla e expõe o estado de erro.
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

  const handlePrintInternalLabelEcoferro = useCallback(async (order: MLOrder) => {
    try {
      await exportSalePdf(mapMLOrderToSaleData(order));
    } catch (caughtError) {
      toast.error(
        caughtError instanceof Error
          ? caughtError.message
          : "Falha ao gerar a etiqueta interna Ecoferro."
      );
    }
  }, []);

  const handlePrintMlLabelsAndNFeBulk = useCallback(
    async (ordersToPrint: MLOrder[]) => {
      if (ordersToPrint.length === 0) {
        toast.info("Selecione pelo menos um pedido.");
        return;
      }
      setBulkPrintingMl(true);
      const labelSources: MergeSource[] = [];
      let missingDocs = 0;
      try {
        // Coleta etiqueta ML + DANFe separadas quando possivel (1 pagina de
        // cada, evita a "Identificacao Produto" e outras paginas intermediarias
        // que aparecem no PDF unificado do ML). Fallback: 2 primeiras paginas
        // da etiqueta unificada.
        for (const order of ordersToPrint) {
          try {
            const docs = await getMLOrderDocuments(order.order_id);

            const shippingUrl =
              docs?.shipping_label_external?.print_url ||
              docs?.shipping_label_external?.download_url ||
              docs?.shipping_label_external?.view_url ||
              null;

            const danfeUrl =
              docs?.invoice_nfe_document?.danfe_print_url ||
              docs?.invoice_nfe_document?.danfe_download_url ||
              docs?.invoice_nfe_document?.danfe_view_url ||
              null;

            if (shippingUrl && danfeUrl) {
              // Ideal: 1 pagina de cada fonte separada.
              labelSources.push({ url: shippingUrl, maxPages: 1 });
              labelSources.push({ url: danfeUrl, maxPages: 1 });
            } else if (shippingUrl) {
              // Fallback: etiqueta unificada (ate 2 paginas).
              labelSources.push({ url: shippingUrl, maxPages: 2 });
            } else if (danfeUrl) {
              labelSources.push({ url: danfeUrl, maxPages: 1 });
            } else {
              missingDocs += 1;
            }
          } catch {
            missingDocs += 1;
          }
        }

        if (labelSources.length === 0) {
          toast.warning("Nenhum pedido tem etiqueta/DANFe disponivel para impressao.");
          return;
        }

        // Baixa cada PDF, respeita o limite por fonte (1 pagina quando etiqueta
        // e DANFe vem em URLs separadas; 2 paginas no fallback unificado).
        const result = await mergeLabelPdfs(labelSources);

        if (result.includedSources === 0) {
          toast.error("Falha ao ler os PDFs das etiquetas.");
          return;
        }

        openPdfBlobForPrint(
          result.mergedPdf,
          `etiquetas-ml-${new Date().toISOString().slice(0, 10)}.pdf`
        );

        const ordersPrinted = ordersToPrint.length - missingDocs;
        toast.success(
          `${ordersPrinted} pedido(s) com etiqueta + DANFe unidos em um unico arquivo.`
        );

        if (result.errors.length > 0) {
          toast.warning(
            `${result.errors.length} PDF(s) nao foram processados (problemas de rede ou formato).`
          );
        }
        if (missingDocs > 0) {
          toast.warning(
            `${missingDocs} pedido(s) sem etiqueta/DANFe disponivel.`
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
    const baseOptions =
      orderOptions.length > 0
        ? orderOptions
        : accessibleDashboardDeposits.map((deposit) => ({
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

    // Se temos contagens LIVE do ML (pack-deduplicated), usar DIRETO.
    // Todos os chips vêm do ML — zero cálculo local.
    const liveCounts = dashboard?.ml_live_chip_counts;
    if (liveCounts && typeof liveCounts.today === "number") {
      return {
        today: liveCounts.today,
        upcoming: liveCounts.upcoming,
        in_transit: liveCounts.in_transit,
        finalized: liveCounts.finalized,
        cancelled: 0, // não exibido na UI mas mantém compatibilidade de tipo
      };
    }

    return localCounts;
  }, [selectedDashboardDeposits, dashboard]);

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

    if (Array.isArray(liveIds) && liveIds.length > 0) {
      const ids = new Set<string>(liveIds);
      // Se houver filtro de depósito ativo, restringimos aos pedidos que
      // também estão no escopo local desse depósito.
      if (selectedDepositFilters.length > 0) {
        const scope = new Set<string>();
        for (const deposit of selectedDashboardDeposits) {
          for (const id of getDashboardBucketOrderIds(deposit, shipmentFilter)) {
            scope.add(id);
          }
        }
        return new Set<string>([...ids].filter((id) => scope.has(id)));
      }
      return ids;
    }

    // Fallback: soma dos IDs locais classificados por depósito
    const ids = new Set<string>();
    for (const deposit of selectedDashboardDeposits) {
      const bucketIds = getDashboardBucketOrderIds(deposit, shipmentFilter);
      for (const id of bucketIds) ids.add(id);
    }
    return ids;
  }, [dashboard, selectedDashboardDeposits, selectedDepositFilters, shipmentFilter]);

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
  // Pedidos que ainda precisam ter NF-e emitida — alimentam o botao
  // "Gerar NF-e" em lote no banner.
  const invoicePendingOrders = useMemo(
    () => filteredOperationalOrders.filter(isOrderInvoicePending),
    [filteredOperationalOrders]
  );
  // Pedidos elegiveis que o usuario marcou — fonte de verdade dos botoes
  // do banner. Os botoes so agem sobre o que esta selecionado (nao sobre
  // "todos elegiveis automaticamente"), evitando disparos acidentais.
  const selectedReadyOrders = useMemo(
    () => readyOrders.filter((order) => selectedOrderIds.has(order.id)),
    [readyOrders, selectedOrderIds]
  );
  const selectedReadyCount = selectedReadyOrders.length;
  const selectedInvoicePendingOrders = useMemo(
    () => invoicePendingOrders.filter((order) => selectedOrderIds.has(order.id)),
    [invoicePendingOrders, selectedOrderIds]
  );
  const selectedInvoicePendingCount = selectedInvoicePendingOrders.length;

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
    selectedReadyCount > 0 && isOperationalListFullyLoaded;

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

        <div className="rounded-[18px] border border-[#e5e5e5] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:px-5 sm:py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#3483fa]/70 bg-white text-[#3483fa] sm:h-11 sm:w-11">
                <Send className="h-5 w-5 sm:h-[22px] sm:w-[22px]" />
              </div>
              <h2 className="truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-[#333333] sm:text-[17px]">
                Operação Mercado Livre sincronizada
              </h2>
            </div>

            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#dfe7f6] bg-white px-3 py-1.5 text-[12px] text-[#333333] shadow-[0_1px_2px_rgba(0,0,0,0.03)] sm:text-[13px]">
              <Info className="h-3.5 w-3.5 text-[#3483fa]" />
              <span>
                Atualizado às <span className="font-semibold">{lastUpdateLabel}</span>
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-6 pt-2">
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
            // Indicador discreto: o auto-load contínuo cuida do resto sem
            // poluir a UI com banner grande de progresso.
            <div className="mt-2 inline-flex items-center gap-2 text-xs text-[#8a8a8a]">
              <Loader2 className="h-3 w-3 animate-spin text-[#3483fa]" />
              <span>Atualizando base ({ordersPagination.loaded}/{ordersPagination.total})</span>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[#e6e6e6] bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.08)] sm:px-4 sm:py-3">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between lg:gap-3">
            <div className="flex items-center gap-2.5">
              {(() => {
                // Selecionar TODOS os pedidos visíveis (readyOrders + invoicePending).
                // Assim o "Gerar NF-e" fica ativo quando há pedidos que precisam de NF-e,
                // e o "Imprimir etiqueta" fica ativo com os que já estão prontos.
                const allVisible = filteredOperationalOrders;
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
                {filteredOperationalOrders.length > 0 ? (
                  <span className="ml-1.5 text-[13px] text-[#666666]">
                    ({filteredOperationalOrders.filter((o) => selectedOrderIds.has(o.id)).length}/{filteredOperationalOrders.length} selecionadas)
                    {selectedInvoicePendingCount > 0 && (
                      <span className="ml-1 text-[#ff6d1b] font-semibold">
                        · {selectedInvoicePendingCount} NF-e pendente{selectedInvoicePendingCount > 1 ? "s" : ""}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="ml-1.5 text-[13px] text-[#999999]">
                    (0 neste bucket)
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:flex lg:flex-wrap lg:items-center lg:gap-2.5">
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
                disabled={!canGenerateBatchLabels || bulkPrintingMl}
                onClick={() => handlePrintMlLabelsAndNFeBulk(selectedReadyOrders)}
              >
                {bulkPrintingMl ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Printer className="mr-1.5 h-4 w-4" />
                )}
                <span className="truncate">
                  Imprimir etiqueta ML + DANFe
                  {selectedReadyCount > 0 ? ` (${selectedReadyCount})` : ""}
                </span>
              </Button>
              <Button
                className="h-10 w-full rounded-lg bg-[#22c55e] px-3.5 text-[13px] font-semibold text-white shadow-[0_1px_3px_rgba(34,197,94,0.28)] transition hover:bg-[#16a34a] hover:shadow-[0_2px_6px_rgba(34,197,94,0.4)] disabled:opacity-60 disabled:shadow-none sm:text-[13px] lg:w-auto lg:px-4"
                disabled={!canGenerateBatchLabels}
                onClick={() => handleGenerateLabels(selectedReadyOrders)}
              >
                <Tag className="mr-1.5 h-4 w-4" />
                <span className="truncate">
                  {isOperationalListFullyLoaded
                    ? `Etiquetas Ecoferro${selectedReadyCount > 0 ? ` (${selectedReadyCount})` : ""}`
                    : `Carregando base completa${selectedReadyCount > 0 ? ` (${selectedReadyCount})` : ""}`}
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
        ) : filteredOperationalOrders.length === 0 ? (
          <div className="rounded-[20px] border border-[#e6e6e6] bg-white px-6 py-12 text-center shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
            <Search className="mx-auto mb-3 h-8 w-8 text-[#bdbdbd]" />
            <p className="text-[16px] font-semibold text-[#333333]">
              Nenhum pedido encontrado para os filtros aplicados.
            </p>
            <p className="mt-1 text-[15px] text-[#666666]">
              {isOperationalListIncomplete
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
              orders={filteredOperationalOrders}
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



