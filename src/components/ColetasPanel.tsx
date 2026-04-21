import { useMemo, useState } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Calendar, FileText, Printer, PackageCheck, Truck, ChevronDown, ChevronUp } from "lucide-react";
import { getOrderStoreKey, type MLStoreKey } from "@/services/mlSubStatusClassifier";
import { hasEmittedInvoice } from "@/services/mercadoLivreHelpers";
import type { MLOrder } from "@/services/mercadoLivreService";
import type {
  MLLiveSnapshotResponse,
  MLLiveSnapshotOrder,
} from "@/services/mlLiveSnapshotService";

// ─── Filtros de vendas (dropdown do topo direito da imagem) ──────────
type StoreFilter = "all" | "without_deposit" | "ourinhos" | "full";

// ─── Estados do pipeline (linhas da grid) ────────────────────────────
type PipelineState = "sem_gerar_lo" | "nf_gerada" | "etiqueta_impressa";

interface PipelineStateConfig {
  value: PipelineState;
  label: string;
  description: string;
  icon: typeof FileText;
  tone: string;
}

const PIPELINE_STATES: PipelineStateConfig[] = [
  {
    value: "sem_gerar_lo",
    label: "NFs SEM GERAR LO",
    description: "Vendas que ainda não tiveram a Nota Fiscal gerada (local de origem — LO).",
    icon: FileText,
    tone: "border-amber-300/70 bg-amber-50 text-amber-900 hover:bg-amber-100",
  },
  {
    value: "nf_gerada",
    label: "NFs GERADAS",
    description: "NF gerada. Imprimir etiqueta move pra \"Etiquetas Impressas\".",
    icon: Printer,
    tone: "border-blue-300/70 bg-blue-50 text-blue-900 hover:bg-blue-100",
  },
  {
    value: "etiqueta_impressa",
    label: "NFs e ETIQUETAS IMPRESSAS",
    description: "NF gerada e etiquetas impressas — prontas pra coleta.",
    icon: PackageCheck,
    tone: "border-emerald-300/70 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────

// Parseia "coleta do dia DD de mês" → "DD de mês" (chave canônica)
const PICKUP_DATE_RE = /coleta do dia (\d+ de \w+)/i;

function extractPickupDateLabel(snapOrder: MLLiveSnapshotOrder): string | null {
  const text = snapOrder.status_text || "";
  const match = text.match(PICKUP_DATE_RE);
  return match ? match[1].toLowerCase() : null;
}

function matchesStoreFilter(
  localOrder: MLOrder | undefined,
  snapOrder: MLLiveSnapshotOrder,
  filter: StoreFilter
): boolean {
  if (filter === "all") return true;

  // Primeiro tenta classificar via order local
  if (localOrder) {
    const key: MLStoreKey = getOrderStoreKey(localOrder);
    if (filter === "full") return key === "full";
    if (filter === "ourinhos") return key === "ourinhos" || key === "outros";
    if (filter === "without_deposit") return key === "unknown";
  }

  // Fallback: usa store_label do snapshot (ex "OURINHOS RUA DARIO ALONSO" ou "FULL")
  const snapLabel = (snapOrder.store_label || "").toLowerCase();
  if (filter === "full") return snapLabel.includes("full");
  if (filter === "ourinhos") return snapLabel.includes("ourinhos");
  if (filter === "without_deposit") return snapLabel.trim() === "";
  return false;
}

function getPipelineState(localOrder: MLOrder | undefined): PipelineState {
  if (!localOrder) return "sem_gerar_lo"; // no DB ainda → assume não gerou
  if (localOrder.label_printed_at) return "etiqueta_impressa";
  if (hasEmittedInvoice(localOrder)) return "nf_gerada";
  return "sem_gerar_lo";
}

// ─── Componente ──────────────────────────────────────────────────────

interface ColetasPanelProps {
  /** Orders locais do DB (fonte da verdade pra estados NF/etiqueta). */
  orders: MLOrder[];
  /** Snapshot ao-vivo do ML Seller Center (fonte das datas de coleta). */
  liveSnapshot: MLLiveSnapshotResponse | null;
  /** Inicia expandido? Default: true. */
  defaultExpanded?: boolean;
}

export function ColetasPanel({
  orders,
  liveSnapshot,
  defaultExpanded = true,
}: ColetasPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [storeFilter, setStoreFilter] = useState<StoreFilter>("all");
  const [selectedCell, setSelectedCell] = useState<{
    pickupDate: string;
    state: PipelineState;
  } | null>(null);

  // Index de orders locais por order_id + pack_id pra lookup rápido
  const localByOrderId = useMemo(() => {
    const map = new Map<string, MLOrder>();
    for (const o of orders) {
      if (o.order_id) map.set(String(o.order_id), o);
    }
    return map;
  }, [orders]);

  // Extrai data de coleta de cada order "upcoming" do snapshot
  const { pickupDates, byDate } = useMemo(() => {
    const byDate = new Map<
      string,
      Record<PipelineState, Array<{ snap: MLLiveSnapshotOrder; local: MLOrder | undefined }>>
    >();
    const upcoming = liveSnapshot?.orders?.upcoming ?? [];

    for (const snap of upcoming) {
      const dateLabel = extractPickupDateLabel(snap);
      if (!dateLabel) continue;

      const local = localByOrderId.get(String(snap.order_id));
      if (!matchesStoreFilter(local, snap, storeFilter)) continue;

      const state = getPipelineState(local);

      if (!byDate.has(dateLabel)) {
        byDate.set(dateLabel, {
          sem_gerar_lo: [],
          nf_gerada: [],
          etiqueta_impressa: [],
        });
      }
      byDate.get(dateLabel)![state].push({ snap, local });
    }

    // Ordena por dia → extrai o número dos "DD de mês"
    const pickupDates = Array.from(byDate.keys()).sort((a, b) => {
      const da = parseInt(a.split(" ")[0], 10) || 0;
      const dbb = parseInt(b.split(" ")[0], 10) || 0;
      return da - dbb;
    });
    return { pickupDates, byDate };
  }, [liveSnapshot, localByOrderId, storeFilter]);

  const effectiveSelection =
    selectedCell && byDate.has(selectedCell.pickupDate) ? selectedCell : null;

  const selectedEntries = effectiveSelection
    ? byDate.get(effectiveSelection.pickupDate)![effectiveSelection.state]
    : [];

  // Labels curtos tipo "22/04" a partir de "22 de abril"
  const MONTHS_PT: Record<string, string> = {
    janeiro: "01", fevereiro: "02", marco: "03", abril: "04",
    maio: "05", junho: "06", julho: "07", agosto: "08",
    setembro: "09", outubro: "10", novembro: "11", dezembro: "12",
  };
  const formatShort = (label: string): string => {
    const parts = label.split(" de ");
    if (parts.length !== 2) return label;
    const day = parts[0].padStart(2, "0");
    const monthKey = parts[1].toLowerCase().replace("ç", "c");
    const month = MONTHS_PT[monthKey] || "??";
    return `${day}/${month}`;
  };

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 py-3 px-4">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
        >
          <Truck className="h-5 w-5" />
          <CardTitle className="text-base font-semibold">Coletas por Data</CardTitle>
          <Badge variant="secondary" className="ml-1">
            {pickupDates.length} data{pickupDates.length === 1 ? "" : "s"}
          </Badge>
          {expanded ? (
            <ChevronUp className="h-4 w-4 ml-1 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 ml-1 text-muted-foreground" />
          )}
        </button>

        {expanded && (
          <Select value={storeFilter} onValueChange={(v) => setStoreFilter(v as StoreFilter)}>
            <SelectTrigger className="w-[240px] h-9">
              <SelectValue placeholder="Filtro de Vendas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as vendas</SelectItem>
              <SelectItem value="without_deposit">Vendas sem depósito</SelectItem>
              <SelectGroup>
                <SelectLabel>Por depósito</SelectLabel>
                <SelectItem value="ourinhos">Ourinhos Rua Dario Alonso</SelectItem>
                <SelectItem value="full">Full</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          {pickupDates.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {liveSnapshot
                ? "Nenhuma coleta agendada no filtro atual."
                : "Aguardando snapshot do ML Seller Center..."}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                Coletas: {pickupDates.map(formatShort).join("  |  ")}
              </div>

              <div
                className="grid gap-3"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}
              >
                {pickupDates.slice(0, 6).map((date) => {
                  const cells = byDate.get(date)!;
                  return (
                    <div key={date} className="rounded-md border bg-muted/20 overflow-hidden">
                      <div className="bg-muted/60 py-2 px-3 text-sm font-semibold">
                        Coleta {formatShort(date)}
                      </div>
                      <div className="p-2 space-y-2">
                        {PIPELINE_STATES.map((state) => {
                          const count = cells[state.value].length;
                          const Icon = state.icon;
                          const isSelected =
                            effectiveSelection?.pickupDate === date &&
                            effectiveSelection?.state === state.value;
                          return (
                            <button
                              key={state.value}
                              type="button"
                              onClick={() =>
                                setSelectedCell(
                                  isSelected
                                    ? null
                                    : { pickupDate: date, state: state.value }
                                )
                              }
                              className={cn(
                                "w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors",
                                state.tone,
                                isSelected && "ring-2 ring-primary ring-offset-1"
                              )}
                            >
                              <span className="flex items-center gap-2">
                                <Icon className="h-4 w-4" />
                                {state.label}
                              </span>
                              <Badge variant="secondary">{count}</Badge>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {effectiveSelection && (
                <div className="rounded-md border bg-background">
                  <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
                    <div className="text-sm font-medium">
                      {PIPELINE_STATES.find((s) => s.value === effectiveSelection.state)?.label} —
                      Coleta {formatShort(effectiveSelection.pickupDate)}
                      <Badge variant="secondary" className="ml-2">
                        {selectedEntries.length} pedido{selectedEntries.length === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedCell(null)}
                      className="h-7"
                    >
                      Fechar
                    </Button>
                  </div>
                  {selectedEntries.length === 0 ? (
                    <div className="py-4 text-center text-sm text-muted-foreground">
                      Nenhum pedido nesta célula.
                    </div>
                  ) : (
                    <div className="divide-y max-h-72 overflow-y-auto">
                      {selectedEntries.map((entry) => (
                        <div
                          key={entry.snap.row_id || entry.snap.order_id}
                          className="flex items-center gap-3 px-4 py-2 text-sm"
                        >
                          <span className="font-mono text-xs text-muted-foreground shrink-0">
                            #{entry.snap.order_id}
                          </span>
                          <span className="truncate flex-1">
                            {entry.local?.item_title ||
                              entry.snap.status_text ||
                              "(sem título)"}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {entry.snap.buyer_name || "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}
