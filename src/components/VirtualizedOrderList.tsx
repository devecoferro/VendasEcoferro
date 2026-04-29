// Lista virtualizada de pedidos ML — renderiza apenas ~5-8 cards visíveis.
// Extraído de MercadoLivrePage.tsx (sprint 2 P2) pra reduzir o tamanho
// do arquivo principal de 3148 linhas.

import { memo, useEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SaleCardPreview } from "@/components/SaleCardPreview";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  FileText,
  Flame,
  Loader2,
  MessageSquare,
  Printer,
  Receipt,
  Tag,
} from "lucide-react";
import {
  mapMLOrderToSaleData,
  type MLOrder,
} from "@/services/mercadoLivreService";
import {
  canPrintMLShippingLabel,
  formatSaleMoment,
  getBuyerType,
  getDepositInfo,
  getMLTrackingUrl,
  getShipmentPresentation,
  isOrderForCollection,
  isOrderFulfillment,
  isOrderInvoicePending,
  isOrderUnderReview,
  orderHasClaimOrMediation,
  orderPriority,
} from "@/services/mercadoLivreHelpers";
import { orderHasUnreadMessages } from "@/services/mlSubStatusClassifier";

export interface VirtualizedOrderListProps {
  orders: MLOrder[];
  onOpenDocuments: (order: MLOrder) => void;
  selectedOrderIds: Set<string>;
  onToggleSelect: (orderId: string) => void;
  onPrintInternalLabel: (order: MLOrder) => void;
  onGenerateNFe: (order: MLOrder) => void;
  onPrintMlLabel: (order: MLOrder) => void;
  generatingNFeForOrderId: string | null;
  printingLabelForOrderId: string | null;
  /** Brief 2026-04-29: brand-aware preview na listagem. Default "ecoferro". */
  brand?: "ecoferro" | "fantom";
}

// P8: row memoizada — skip re-render quando o order, seleção e estados de
// loading não mudaram. Virtualizer só renderiza ~5-8 rows visíveis, mas
// scroll/resize dispara re-render do pai inteiro. Com memo, só as rows
// cujos props realmente mudaram ganham novo render.
interface OrderCardProps {
  order: MLOrder;
  isSelected: boolean;
  isGeneratingNFe: boolean;
  isPrintingLabel: boolean;
  onToggleSelect: (orderId: string) => void;
  onOpenDocuments: (order: MLOrder) => void;
  onPrintInternalLabel: (order: MLOrder) => void;
  onGenerateNFe: (order: MLOrder) => void;
  onPrintMlLabel: (order: MLOrder) => void;
  brand: "ecoferro" | "fantom";
}

const OrderCard = memo(function OrderCard({
  order,
  isSelected,
  isGeneratingNFe,
  isPrintingLabel,
  onToggleSelect,
  onOpenDocuments,
  onPrintInternalLabel,
  onGenerateNFe,
  onPrintMlLabel,
  brand,
}: OrderCardProps) {
  const deposit = getDepositInfo(order);
  const shipment = getShipmentPresentation(order);
  const buyerType = getBuyerType(order);
  const nfeEligible = isOrderInvoicePending(order);
  const labelEligible = canPrintMLShippingLabel(order);
  const hasClaim = orderHasClaimOrMediation(order);
  const hasUnreadMsgs = orderHasUnreadMessages(order);
  const isHighPriority = orderPriority(order) === "high";
  const trackingUrl = getMLTrackingUrl(order);

  return (
    <article className="mb-3 overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] sm:mb-4">
      <div className="border-b border-[#ededed] px-3 py-3 sm:px-5 sm:py-4">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#666666] sm:gap-3 sm:text-[14px]">
          <Checkbox
            checked={isSelected}
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
              {nfeEligible ? "Pronta para emitir NF-e" : shipment.title}
            </p>
            <p className="mt-2 text-[13px] text-[#666666] sm:mt-3 sm:text-[15px]">
              {nfeEligible
                ? "Pagamento aprovado e expedição liberada para gerar etiqueta."
                : shipment.description}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5 sm:mt-4 sm:gap-2">
              <Badge variant="outline">
                {buyerType === "business" ? "Negócio" : "Pessoa"}
              </Badge>
              {nfeEligible && <Badge variant="secondary">NF-e sem emitir</Badge>}
              {isOrderUnderReview(order) && <Badge variant="destructive">Em revisão</Badge>}
              {isOrderForCollection(order) && <Badge variant="outline">Para coleta</Badge>}
              {isHighPriority && (
                <Badge
                  variant="destructive"
                  className="border-[#f87171] bg-[#fef2f2] text-[#b91c1c]"
                  title="Pedido marcado como alta prioridade pelo ML"
                >
                  <Flame className="mr-1 h-3 w-3" />
                  Prioridade alta
                </Badge>
              )}
              {hasClaim && (
                <Badge
                  variant="destructive"
                  title="Pedido com reclamação ou mediação aberta no ML"
                >
                  <AlertTriangle className="mr-1 h-3 w-3" />
                  Reclamação / Mediação
                </Badge>
              )}
              {hasUnreadMsgs && (
                <Badge
                  variant="outline"
                  className="border-[#60a5fa] bg-[#eff6ff] text-[#1d4ed8]"
                  title="Comprador enviou mensagem não lida"
                >
                  <MessageSquare className="mr-1 h-3 w-3" />
                  Msg. não lidas
                </Badge>
              )}
              {order.label_printed_at ? (
                <Badge
                  variant="outline"
                  className="border-[#22c55e] bg-[#f0fdf4] text-[#15803d]"
                  title={`Etiqueta impressa em ${new Date(order.label_printed_at).toLocaleString("pt-BR")}`}
                >
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  Etiqueta impressa
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-[#ffa07a] bg-[#fff4ec] text-[#c2410c]"
                  title="Etiqueta ainda nao foi impressa"
                >
                  <Printer className="mr-1 h-3 w-3" />
                  Sem etiqueta
                </Badge>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-2 lg:flex-nowrap lg:justify-end lg:gap-2.5">
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
            <Button
              disabled={!labelEligible || isPrintingLabel}
              className="h-11 w-full rounded-lg bg-[#fff159] px-4 text-[14px] font-semibold text-[#333333] shadow-[0_1px_3px_rgba(255,241,89,0.6)] transition hover:bg-[#ffe924] hover:shadow-[0_2px_6px_rgba(255,241,89,0.8)] disabled:cursor-not-allowed disabled:bg-[#f1f1f1] disabled:text-[#a0a0a0] disabled:shadow-none sm:w-auto sm:text-sm"
              onClick={() => onPrintMlLabel(order)}
              title={
                labelEligible
                  ? "Imprimir etiqueta ML + DANFe"
                  : isOrderFulfillment(order)
                    ? "Pedido Full — etiqueta ML gerada internamente pelo centro de distribuicao"
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
            <Button
              className="h-11 w-full rounded-lg bg-[#22c55e] px-4 text-[14px] font-semibold text-white shadow-[0_1px_3px_rgba(34,197,94,0.28)] transition hover:bg-[#16a34a] hover:shadow-[0_2px_6px_rgba(34,197,94,0.4)] disabled:cursor-not-allowed disabled:bg-[#f1f1f1] disabled:text-[#a0a0a0] disabled:shadow-none sm:w-auto sm:text-sm"
              onClick={() => onPrintInternalLabel(order)}
              title={
                brand === "fantom"
                  ? "Etiqueta interna com logo Fantom"
                  : "Etiqueta interna com logo Ecoferro"
              }
            >
              <Tag className="mr-1.5 h-4 w-4 sm:mr-2" />
              {brand === "fantom" ? "Etiqueta Fantom" : "Etiqueta Ecoferro"}
            </Button>
            <Button
              variant="outline"
              className="h-11 w-full rounded-lg border-[#d9e7ff] bg-white px-4 text-[13px] font-semibold text-[#2968c8] hover:bg-[#eef4ff] sm:w-auto sm:text-sm"
              onClick={() => onOpenDocuments(order)}
            >
              <FileText className="mr-1.5 h-4 w-4 sm:mr-2" />
              Documentos
            </Button>
            <Button
              variant="outline"
              className="h-11 w-full rounded-lg border-[#d9e7ff] bg-white px-4 text-[13px] font-semibold text-[#2968c8] hover:bg-[#eef4ff] sm:w-auto sm:text-sm"
              onClick={() => window.open(trackingUrl, "_blank", "noopener,noreferrer")}
              title="Abre acompanhamento no ML Seller Center (nova aba)"
            >
              <ExternalLink className="mr-1.5 h-4 w-4 sm:mr-2" />
              Acompanhar
            </Button>
          </div>
        </div>
      </div>

      <div className="px-2 pb-3 sm:px-5 sm:pb-5">
        <SaleCardPreview sale={mapMLOrderToSaleData(order)} mode="embedded" brand={brand} />
      </div>
    </article>
  );
});

export function VirtualizedOrderList({
  orders,
  onOpenDocuments,
  selectedOrderIds,
  onToggleSelect,
  onPrintInternalLabel,
  onGenerateNFe,
  onPrintMlLabel,
  generatingNFeForOrderId,
  printingLabelForOrderId,
  brand = "ecoferro",
}: VirtualizedOrderListProps) {
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
              <OrderCard
                order={order}
                isSelected={selectedOrderIds.has(order.id)}
                isGeneratingNFe={generatingNFeForOrderId === order.order_id}
                isPrintingLabel={printingLabelForOrderId === order.order_id}
                onToggleSelect={onToggleSelect}
                onOpenDocuments={onOpenDocuments}
                onPrintInternalLabel={onPrintInternalLabel}
                onGenerateNFe={onGenerateNFe}
                onPrintMlLabel={onPrintMlLabel}
                brand={brand}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
