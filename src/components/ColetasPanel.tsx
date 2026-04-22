import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Calendar, FileText, Printer, PackageCheck } from "lucide-react";
import { hasEmittedInvoice } from "@/services/mercadoLivreHelpers";
import type { MLOrder } from "@/services/mercadoLivreService";
import type { MLLiveSnapshotResponse } from "@/services/mlLiveSnapshotService";

// ─── Estados do pipeline (linhas da grid) ────────────────────────────
type PipelineState = "sem_gerar_lo" | "nf_gerada" | "etiqueta_impressa";

interface PipelineStateConfig {
  value: PipelineState;
  label: string;
  icon: typeof FileText;
  tone: string;
}

const PIPELINE_STATES: PipelineStateConfig[] = [
  {
    value: "sem_gerar_lo",
    label: "NFs SEM GERAR LO",
    icon: FileText,
    tone: "border-amber-300/70 bg-amber-50 text-amber-900",
  },
  {
    value: "nf_gerada",
    label: "NFs GERADAS",
    icon: Printer,
    tone: "border-blue-300/70 bg-blue-50 text-blue-900",
  },
  {
    value: "etiqueta_impressa",
    label: "NFs e ETIQUETAS IMPRESSAS",
    icon: PackageCheck,
    tone: "border-emerald-300/70 bg-emerald-50 text-emerald-900",
  },
];

// ─── Helpers de data ─────────────────────────────────────────────────

const MONTHS_PT_LABELS = [
  "janeiro", "fevereiro", "março", "abril",
  "maio", "junho", "julho", "agosto",
  "setembro", "outubro", "novembro", "dezembro",
];

// Chave canônica YYYY-MM-DD (timezone São Paulo) pra agrupar sem ambiguidade
function toDateKey(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  // Usa toLocaleDateString com timezone SP pra evitar drift UTC
  return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function todayKey(): string {
  return toDateKey(new Date());
}

function addDaysKey(dateKey: string, offsetDays: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return toDateKey(base);
}

function formatShortBR(dateKey: string): string {
  const [, mm, dd] = dateKey.split("-");
  return `${dd}/${mm}`;
}

function formatLongBR(dateKey: string): string {
  const [, mm, dd] = dateKey.split("-");
  const monthIdx = Number(mm) - 1;
  return `${Number(dd)} de ${MONTHS_PT_LABELS[monthIdx] ?? mm}`;
}

// ─── Classificação do pipeline ───────────────────────────────────────

function getPipelineState(order: MLOrder): PipelineState {
  if (order.label_printed_at) return "etiqueta_impressa";
  if (hasEmittedInvoice(order)) return "nf_gerada";
  return "sem_gerar_lo";
}

// Mesmos signals do ML Seller Center, lidos direto do shipment_snapshot
// (mais robusto que depender de hasEmittedInvoice, que só é true quando
// nosso sistema emitiu a NF).
function getPipelineStateFromSnapshot(order: MLOrder): PipelineState {
  if (order.label_printed_at) return "etiqueta_impressa";

  const raw = (order.raw_data ?? {}) as Record<string, unknown>;
  const snap = (raw?.shipment_snapshot ?? {}) as Record<string, unknown>;
  const substatus = String(snap?.substatus || "").toLowerCase();
  const status = String(snap?.status || "").toLowerCase();

  // NF-e para gerenciar: substatus específico
  if (substatus === "invoice_pending") return "sem_gerar_lo";

  // Pronto pra coleta / etiqueta pronta / em processamento = NF já emitida
  // (ML só move pra esses sub-status depois da NF)
  if (
    status === "ready_to_ship" &&
    ["ready_for_pickup", "printed", "ready_to_print", "in_packing_list", "packed", "in_hub", "in_warehouse"].includes(substatus)
  ) {
    // Se o operador já imprimiu no EcoFerro, vira "etiqueta_impressa"
    // (label_printed_at já checado no topo — não chegou aqui)
    return "nf_gerada";
  }

  // Fallback: usa hasEmittedInvoice (cobre cases locais)
  if (hasEmittedInvoice(order)) return "nf_gerada";

  return "sem_gerar_lo";
}

// ─── Classificação da coluna (data de coleta) ────────────────────────

type ColumnKey = string;

interface ColumnDef {
  key: ColumnKey;
  title: string;
}

function getColumnForOrder(order: MLOrder): ColumnKey | null {
  const iso = order.pickup_scheduled_date;
  if (!iso) return null;
  return toDateKey(iso);
}

// Agrupa colunas no estilo ML: "Hoje" / "Amanhã" / datas específicas.
// Se há muitas datas futuras (>3), consolida em "A partir de [X]".
function buildColumnList(dateKeys: Set<string>): ColumnDef[] {
  const today = todayKey();
  const tomorrow = addDaysKey(today, 1);
  const sorted = Array.from(dateKeys).sort();

  return sorted.map((key) => {
    if (key === today) return { key, title: "Coleta Hoje" };
    if (key === tomorrow) return { key, title: "Coleta Amanhã" };
    return { key, title: `Coleta ${formatLongBR(key)}` };
  });
}

// ─── Componente ──────────────────────────────────────────────────────

interface ColetasPanelProps {
  orders: MLOrder[];
  /** Snapshot usado apenas como sanity check (counters.upcoming do ML
   * vs total local). Não é mais fonte primária dos dados. */
  scopedLiveSnapshot: MLLiveSnapshotResponse | null;
  toolbar?: React.ReactNode;
  /** Callback disparado quando user clica numa célula da grid.
   * Passa { orderIds } com os IDs dos pedidos daquela data × estado, ou
   * null quando a mesma célula é clicada de novo (toggle off).
   * MercadoLivrePage usa pra filtrar a lista principal de pedidos abaixo. */
  onSelectCell?: (selection: {
    orderIds: string[];
    dateKey: string;
    state: "sem_gerar_lo" | "nf_gerada" | "etiqueta_impressa";
  } | null) => void;
}

export function ColetasPanel({
  orders,
  scopedLiveSnapshot,
  toolbar,
  onSelectCell,
}: ColetasPanelProps) {
  const [selectedCell, setSelectedCell] = useState<{
    dateKey: string;
    state: PipelineState;
  } | null>(null);
  // ─── Filtro operacional: só pedidos que estão em "Proximos dias" ─
  // (equivalente ao chip "Próximos dias" do ML Seller Center).
  // Heurística mínima: tem pickup_scheduled_date futuro OU é
  // ready_to_ship com substatus pre-coleta. Sem isso, o painel
  // encheria de histórico.
  const upcomingOrders = useMemo(() => {
    const today = todayKey();
    return orders.filter((o) => {
      // Primeiro sinal: pickup agendado pra hoje ou depois
      const pickup = o.pickup_scheduled_date
        ? toDateKey(o.pickup_scheduled_date)
        : null;
      if (pickup && pickup >= today) return true;

      // Fallback: status/substatus pre-coleta mesmo sem pickup agendado
      const raw = (o.raw_data ?? {}) as Record<string, unknown>;
      const snap = (raw?.shipment_snapshot ?? {}) as Record<string, unknown>;
      const status = String(snap?.status || "").toLowerCase();
      const substatus = String(snap?.substatus || "").toLowerCase();
      if (
        status === "ready_to_ship" &&
        [
          "invoice_pending",
          "ready_to_print",
          "in_packing_list",
          "packed",
          "ready_for_pickup",
          "printed",
          "in_hub",
          "in_warehouse",
        ].includes(substatus)
      ) {
        return true;
      }
      return false;
    });
  }, [orders]);

  // ─── Agrupamento: column (data) × row (estado) ───────────────────
  const { columns, byCol, withoutDate } = useMemo(() => {
    const byCol = new Map<ColumnKey, Record<PipelineState, MLOrder[]>>();
    let withoutDate = 0;

    for (const order of upcomingOrders) {
      const col = getColumnForOrder(order);
      if (!col) {
        withoutDate++;
        continue;
      }
      if (!byCol.has(col)) {
        byCol.set(col, {
          sem_gerar_lo: [],
          nf_gerada: [],
          etiqueta_impressa: [],
        });
      }
      const state = getPipelineStateFromSnapshot(order);
      byCol.get(col)![state].push(order);
    }

    const columns = buildColumnList(new Set(byCol.keys()));
    return { columns, byCol, withoutDate };
  }, [upcomingOrders]);

  // ─── Dispara callback quando seleção muda ────────────────────────
  // Passa os order_ids da célula selecionada pra MercadoLivrePage
  // filtrar a lista principal de pedidos abaixo do painel.
  useEffect(() => {
    if (!onSelectCell) return;
    if (!selectedCell) {
      onSelectCell(null);
      return;
    }
    const cells = byCol.get(selectedCell.dateKey);
    if (!cells) {
      onSelectCell(null);
      return;
    }
    const list = cells[selectedCell.state];
    const orderIds = list.map((o) => String(o.order_id));
    onSelectCell({
      orderIds,
      dateKey: selectedCell.dateKey,
      state: selectedCell.state,
    });
  }, [selectedCell, byCol, onSelectCell]);

  // ─── Validação cruzada com counters.upcoming do snapshot ─────────
  const mlTotalUpcoming = scopedLiveSnapshot?.counters?.upcoming ?? null;
  const localTotalUpcoming = upcomingOrders.length;
  const syncDrift =
    mlTotalUpcoming != null && mlTotalUpcoming > 0
      ? Math.abs(mlTotalUpcoming - localTotalUpcoming) / mlTotalUpcoming
      : 0;
  const hasDrift = syncDrift > 0.05; // >5% de divergência

  return (
    <Card className="overflow-hidden">
      {toolbar && (
        <CardHeader className="flex flex-col gap-3 space-y-0 py-3 px-4 2xl:flex-row 2xl:items-center 2xl:justify-end">
          <div className="flex flex-wrap items-center gap-2 min-w-0">{toolbar}</div>
        </CardHeader>
      )}

      <CardContent className={cn("space-y-4", toolbar ? "pt-0" : "pt-4")}>
        {columns.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {localTotalUpcoming === 0
              ? "Nenhum pedido em \"Próximos dias\" no filtro atual."
              : "Nenhum pedido com data de coleta agendada no filtro atual."}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                Coletas: {columns.map((c) => formatShortBR(c.key)).join("  |  ")}
              </div>
              <div className="flex items-center gap-3 text-muted-foreground">
                {hasDrift && mlTotalUpcoming != null && (
                  <span
                    title={`ML Seller Center mostra ${mlTotalUpcoming} em Próximos dias, mas nosso DB tem ${localTotalUpcoming}. Pode ser sync lag — aguarde o próximo ciclo.`}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 px-2 py-0.5 font-medium"
                  >
                    sync drift: ML {mlTotalUpcoming} / local {localTotalUpcoming}
                  </span>
                )}
                {withoutDate > 0 && (
                  <span title="Pedidos em ready_to_ship mas ainda sem coleta agendada pelo ML">
                    (+{withoutDate} sem coleta agendada)
                  </span>
                )}
              </div>
            </div>

            <div
              className="grid gap-3"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}
            >
              {columns.slice(0, 6).map((col) => {
                const cells = byCol.get(col.key)!;
                return (
                  <div key={col.key} className="rounded-md border bg-muted/20 overflow-hidden">
                    <div className="bg-muted/60 py-2 px-3 text-sm font-semibold">
                      {col.title}
                    </div>
                    <div className="p-2 space-y-2">
                      {PIPELINE_STATES.map((state) => {
                        const cellOrders = cells[state.value];
                        const count = cellOrders.length;
                        const Icon = state.icon;
                        const isSelected =
                          selectedCell?.dateKey === col.key &&
                          selectedCell?.state === state.value;
                        return (
                          <button
                            key={state.value}
                            type="button"
                            disabled={count === 0}
                            onClick={() => {
                              const next = isSelected
                                ? null
                                : { dateKey: col.key, state: state.value };
                              setSelectedCell(next);
                            }}
                            className={cn(
                              "w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors",
                              state.tone,
                              isSelected && "ring-2 ring-primary ring-offset-1",
                              count === 0 &&
                                "opacity-60 cursor-not-allowed hover:opacity-60"
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
