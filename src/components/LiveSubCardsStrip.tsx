/**
 * LiveSubCardsStrip — resumo compacto dos sub_cards do ML ao vivo.
 *
 * Mostra os sub-counters do bucket ativo (today/upcoming/in_transit/
 * finalized) vindos diretamente do /api/ml/live-snapshot. Os números
 * são 1:1 com o ML Seller Center.
 *
 * Renderiza nada se o snapshot não estiver disponível ou o bucket
 * não tiver dados.
 */
import { useMemo } from "react";
import type { MLLiveSnapshotSubCards } from "@/services/mlLiveSnapshotService";
import type { ShipmentBucket } from "@/services/mercadoLivreHelpers";
import { Package, Truck, Clock, CheckCircle2, AlertCircle, Calendar } from "lucide-react";

interface LiveSubCardsStripProps {
  subCards: MLLiveSnapshotSubCards | null | undefined;
  bucket: ShipmentBucket;
}

interface SubCardItem {
  label: string;
  count: number;
  tone: "default" | "warning" | "success" | "danger";
  icon?: React.ReactNode;
}

function Pill({ item }: { item: SubCardItem }) {
  const palette = {
    default: "bg-[#eef4ff] text-[#1d4ed8] ring-[#bfdbfe]",
    warning: "bg-amber-50 text-amber-700 ring-amber-200",
    success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    danger: "bg-red-50 text-red-700 ring-red-200",
  }[item.tone];

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ring-1 ring-inset ${palette}`}
    >
      {item.icon}
      <span>{item.label}</span>
      <span className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-white/70 px-1.5 py-0.5 text-[11px] font-bold">
        {item.count}
      </span>
    </div>
  );
}

export function LiveSubCardsStrip({
  subCards,
  bucket,
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
        });
      }
      if (t.ready_for_pickup > 0) {
        list.push({
          label: "Pronto pra coleta",
          count: t.ready_for_pickup,
          tone: "success",
          icon: <CheckCircle2 className="h-3 w-3" />,
        });
      }
      if (t.with_unread_messages > 0) {
        list.push({
          label: "Msg. não lidas",
          count: t.with_unread_messages,
          tone: "danger",
          icon: <AlertCircle className="h-3 w-3" />,
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
          list.push({
            label: status.length > 35 ? status.slice(0, 32) + "…" : status,
            count,
            tone: status.toLowerCase().includes("cancel") ? "danger" : "default",
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
        });
      }
      if (u.scheduled_pickup > 0) {
        list.push({
          label: "Para coleta agendada",
          count: u.scheduled_pickup,
          tone: "default",
          icon: <Calendar className="h-3 w-3" />,
        });
      }
      // Expande por pickup_date: "Coleta 22 abr: 2", etc
      const pickups = Object.entries(u.by_pickup_date || {})
        .filter(([, count]) => count > 0)
        .sort(([a], [b]) => {
          const parseDate = (s: string) => {
            // "22 de abril" -> 22
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
        });
      }
      if (f.cancelled_seller > 0) {
        list.push({
          label: "Cancel. pelo vendedor",
          count: f.cancelled_seller,
          tone: "danger",
          icon: <AlertCircle className="h-3 w-3" />,
        });
      }
      if (f.cancelled_buyer > 0) {
        list.push({
          label: "Cancel. pelo comprador",
          count: f.cancelled_buyer,
          tone: "warning",
          icon: <AlertCircle className="h-3 w-3" />,
        });
      }
      if (f.with_claims > 0) {
        list.push({
          label: "Com reclamação",
          count: f.with_claims,
          tone: "danger",
          icon: <AlertCircle className="h-3 w-3" />,
        });
      }
      return list;
    }

    return [];
  }, [subCards, bucket]);

  if (!subCards || items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-[#e6e6e6] bg-gradient-to-br from-[#eef4ff] to-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
          <Clock className="h-2.5 w-2.5" />
          Sub-classificação ao vivo (ML)
        </span>
        <span className="text-[11px] text-[#666]">
          números 1:1 com o Seller Center
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {items.map((item, idx) => (
          <Pill key={`${item.label}-${idx}`} item={item} />
        ))}
      </div>
    </div>
  );
}
