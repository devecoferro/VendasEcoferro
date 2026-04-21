/**
 * LiveSubCardsStrip — resumo compacto dos sub_cards do ML ao vivo.
 *
 * Mostra os sub-counters do bucket ativo (today/upcoming/in_transit/
 * finalized) vindos diretamente do /api/ml/live-snapshot. Os números
 * são 1:1 com o ML Seller Center.
 *
 * Cada pill é CLICÁVEL — ao clicar, dispara onSelectFilter com uma
 * estrutura { type, value } que a MercadoLivrePage usa pra filtrar a
 * lista abaixo pelos pedidos daquele status. Clicar de novo no mesmo
 * pill desativa (toggle).
 *
 * Renderiza nada se o snapshot não estiver disponível ou o bucket
 * não tiver dados.
 */
import { useMemo } from "react";
import type { MLLiveSnapshotSubCards } from "@/services/mlLiveSnapshotService";
import type { ShipmentBucket } from "@/services/mercadoLivreHelpers";
import {
  Package,
  Truck,
  Clock,
  CheckCircle2,
  AlertCircle,
  Calendar,
} from "lucide-react";

/**
 * Define como filtrar o status_text dos pedidos do snapshot quando o
 * usuário clica num pill.
 *
 * - "exact": status_text === value (ex: "A caminho")
 * - "includes": status_text.includes(value) (ex: "Etiqueta pronta")
 * - "pickup_date": status_text matches "coleta do dia X" (ex: "22 de abril")
 */
export interface LiveStatusFilter {
  type: "exact" | "includes" | "pickup_date";
  value: string;
  /** Rótulo humano pra mostrar na UI ativa (ex: "Coleta 23 de abril") */
  label: string;
}

export function matchesLiveStatusFilter(
  statusText: string | null | undefined,
  filter: LiveStatusFilter
): boolean {
  if (!statusText) return false;
  const s = statusText.toLowerCase();
  if (filter.type === "exact") return statusText === filter.value;
  if (filter.type === "includes") return s.includes(filter.value.toLowerCase());
  if (filter.type === "pickup_date") {
    return s.includes(`coleta do dia ${filter.value.toLowerCase()}`);
  }
  return false;
}

interface LiveSubCardsStripProps {
  subCards: MLLiveSnapshotSubCards | null | undefined;
  bucket: ShipmentBucket;
  selectedFilter: LiveStatusFilter | null;
  onSelectFilter: (filter: LiveStatusFilter | null) => void;
}

interface SubCardItem {
  label: string;
  count: number;
  tone: "default" | "warning" | "success" | "danger";
  icon?: React.ReactNode;
  filter: LiveStatusFilter;
}

function Pill({
  item,
  isActive,
  onClick,
}: {
  item: SubCardItem;
  isActive: boolean;
  onClick: () => void;
}) {
  const palette = {
    default: "bg-[#eef4ff] text-[#1d4ed8] ring-[#bfdbfe] hover:bg-[#dbeafe]",
    warning: "bg-amber-50 text-amber-700 ring-amber-200 hover:bg-amber-100",
    success: "bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100",
    danger: "bg-red-50 text-red-700 ring-red-200 hover:bg-red-100",
  }[item.tone];

  const activeRing = {
    default: "ring-2 ring-[#3483fa] shadow-sm",
    warning: "ring-2 ring-amber-500 shadow-sm",
    success: "ring-2 ring-emerald-500 shadow-sm",
    danger: "ring-2 ring-red-500 shadow-sm",
  }[item.tone];

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset transition ${palette} ${
        isActive ? `font-semibold ${activeRing}` : ""
      }`}
      title={isActive ? "Clique pra remover filtro" : `Filtrar por: ${item.label}`}
    >
      {item.icon}
      <span>{item.label}</span>
      <span
        className={`inline-flex min-w-[20px] items-center justify-center rounded-full bg-white/70 px-1.5 py-0.5 text-[11px] font-bold ${
          isActive ? "bg-white" : ""
        }`}
      >
        {item.count}
      </span>
    </button>
  );
}

export function LiveSubCardsStrip({
  subCards,
  bucket,
  selectedFilter,
  onSelectFilter,
}: LiveSubCardsStripProps) {
  const items = useMemo<SubCardItem[]>(() => {
    if (!subCards) return [];

    if (bucket === "today") {
      const t = subCards.today;
      const list: SubCardItem[] = [];
      if (t.label_ready_to_print > 0) {
        list.push({
          label: "Etiqueta pronta",
          count: t.label_ready_to_print,
          tone: "warning",
          icon: <Package className="h-3 w-3" />,
          filter: {
            type: "includes",
            value: "Etiqueta pronta",
            label: "Etiqueta pronta",
          },
        });
      }
      if (t.ready_for_pickup > 0) {
        list.push({
          label: "Pronto pra coleta",
          count: t.ready_for_pickup,
          tone: "success",
          icon: <CheckCircle2 className="h-3 w-3" />,
          filter: {
            type: "includes",
            value: "Pronto para coleta",
            label: "Pronto pra coleta",
          },
        });
      }
      if (t.with_unread_messages > 0) {
        list.push({
          label: "Msg. não lidas",
          count: t.with_unread_messages,
          tone: "danger",
          icon: <AlertCircle className="h-3 w-3" />,
          filter: {
            type: "includes",
            value: "mensagem",
            label: "Com mensagens",
          },
        });
      }
      // fallback: outros status do by_status que não foram capturados
      // nos agregados (ex: "Processando CD", "Vamos enviar dia X")
      const knownStatuses = new Set([
        "Etiqueta pronta para impressão",
        "Pronto para coleta",
      ]);
      for (const [status, count] of Object.entries(t.by_status || {})) {
        if (knownStatuses.has(status)) continue;
        if (count > 0) {
          const truncated = status.length > 35 ? status.slice(0, 32) + "…" : status;
          list.push({
            label: truncated,
            count,
            tone: status.toLowerCase().includes("cancel")
              ? "danger"
              : "default",
            filter: {
              type: "exact",
              value: status,
              label: truncated,
            },
          });
        }
      }
      return list;
    }

    if (bucket === "upcoming") {
      const u = subCards.upcoming;
      const list: SubCardItem[] = [];
      if (u.label_ready_to_print > 0) {
        list.push({
          label: "Etiqueta pronta",
          count: u.label_ready_to_print,
          tone: "warning",
          icon: <Package className="h-3 w-3" />,
          filter: {
            type: "includes",
            value: "Etiqueta pronta",
            label: "Etiqueta pronta",
          },
        });
      }
      if (u.scheduled_pickup > 0) {
        list.push({
          label: "Para coleta agendada",
          count: u.scheduled_pickup,
          tone: "default",
          icon: <Calendar className="h-3 w-3" />,
          filter: {
            type: "includes",
            value: "Para entregar na coleta",
            label: "Para coleta agendada",
          },
        });
      }
      // Expande por pickup_date: "Coleta 22 abr: 2", etc
      const pickups = Object.entries(u.by_pickup_date || {})
        .filter(([, count]) => count > 0)
        .sort(([a], [b]) => {
          const parseDate = (s: string) => {
            const m = s.match(/^(\d+)/);
            return m ? parseInt(m[1], 10) : 99;
          };
          return parseDate(a) - parseDate(b);
        });
      for (const [date, count] of pickups) {
        list.push({
          label: `Coleta ${date}`,
          count,
          tone: "default",
          icon: <Calendar className="h-3 w-3" />,
          filter: {
            type: "pickup_date",
            value: date,
            label: `Coleta ${date}`,
          },
        });
      }
      return list;
    }

    if (bucket === "in_transit") {
      const i = subCards.in_transit;
      const list: SubCardItem[] = [];
      for (const [status, count] of Object.entries(i.by_status || {})) {
        if (count > 0) {
          list.push({
            label: status,
            count,
            tone: status.toLowerCase().includes("caminho")
              ? "default"
              : status.toLowerCase().includes("ponto")
                ? "success"
                : "default",
            icon: <Truck className="h-3 w-3" />,
            filter: {
              type: "exact",
              value: status,
              label: status,
            },
          });
        }
      }
      return list;
    }

    if (bucket === "finalized") {
      const f = subCards.finalized;
      const list: SubCardItem[] = [];
      if (f.delivered > 0) {
        list.push({
          label: "Entregue",
          count: f.delivered,
          tone: "success",
          icon: <CheckCircle2 className="h-3 w-3" />,
          filter: { type: "exact", value: "Entregue", label: "Entregue" },
        });
      }
      if (f.cancelled_seller > 0) {
        list.push({
          label: "Cancel. pelo vendedor",
          count: f.cancelled_seller,
          tone: "danger",
          icon: <AlertCircle className="h-3 w-3" />,
          filter: {
            type: "includes",
            value: "Não envie",
            label: "Cancel. pelo vendedor",
          },
        });
      }
      if (f.cancelled_buyer > 0) {
        list.push({
          label: "Cancel. pelo comprador",
          count: f.cancelled_buyer,
          tone: "warning",
          icon: <AlertCircle className="h-3 w-3" />,
          filter: {
            type: "includes",
            value: "Cancelada pelo comprador",
            label: "Cancel. pelo comprador",
          },
        });
      }
      if (f.with_claims > 0) {
        list.push({
          label: "Com reclamação",
          count: f.with_claims,
          tone: "danger",
          icon: <AlertCircle className="h-3 w-3" />,
          filter: {
            type: "includes",
            value: "reclamação",
            label: "Com reclamação",
          },
        });
      }
      return list;
    }

    return [];
  }, [subCards, bucket]);

  if (!subCards || items.length === 0) return null;

  const isFilterActive = (item: SubCardItem): boolean => {
    if (!selectedFilter) return false;
    return (
      selectedFilter.type === item.filter.type &&
      selectedFilter.value === item.filter.value
    );
  };

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[#e6e6e6] bg-gradient-to-br from-[#eef4ff] to-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
          <Clock className="h-2.5 w-2.5" />
          Sub-classificação ao vivo (ML)
        </span>
        <span className="text-[11px] text-[#666]">
          {selectedFilter
            ? `filtrando por "${selectedFilter.label}"`
            : "clique num pill pra filtrar a lista abaixo"}
        </span>
        {selectedFilter && (
          <button
            type="button"
            onClick={() => onSelectFilter(null)}
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#666] ring-1 ring-inset ring-[#e6e6e6] transition hover:bg-[#f3f3f3]"
          >
            ✕ Limpar filtro
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item, idx) => {
          const active = isFilterActive(item);
          return (
            <Pill
              key={`${item.label}-${idx}`}
              item={item}
              isActive={active}
              onClick={() => {
                if (active) {
                  onSelectFilter(null); // toggle off
                } else {
                  onSelectFilter(item.filter);
                }
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
