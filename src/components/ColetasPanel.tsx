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
    tone: "border-amber-300/60 bg-amber-50 text-amber-900 hover:bg-amber-100",
  },
  {
    value: "nf_gerada",
    label: "NFs GERADAS",
    description: "Vendas com NF gerada. Imprimir etiqueta move pra \"Etiquetas Impressas\".",
    icon: Printer,
    tone: "border-blue-300/60 bg-blue-50 text-blue-900 hover:bg-blue-100",
  },
  {
    value: "etiqueta_impressa",
    label: "NFs e ETIQUETAS IMPRESSAS",
    description: "Vendas com NF gerada e etiquetas impressas — prontas pra coleta.",
    icon: PackageCheck,
    tone: "border-emerald-300/60 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────

function matchesStoreFilter(order: MLOrder, filter: StoreFilter): boolean {
  if (filter === "all") return true;
  const key: MLStoreKey = getOrderStoreKey(order);
  if (filter === "full") return key === "full";
  if (filter === "ourinhos") return key === "ourinhos" || key === "outros";
  if (filter === "without_deposit") return key === "unknown";
  return false;
}

function getPipelineState(order: MLOrder): PipelineState {
  if (order.label_printed_at) return "etiqueta_impressa";
  if (hasEmittedInvoice(order)) return "nf_gerada";
  return "sem_gerar_lo";
}

interface RawShipment {
  estimated_delivery_limit?: { date?: string } | string | null;
}

function getPickupDateKey(order: MLOrder): string | null {
  const raw = (order.raw_data ?? {}) as Record<string, unknown>;
  const shipment =
    ((raw?.shipment_snapshot ?? raw?.shipping) as RawShipment | undefined) ?? {};
  const dateRaw =
    typeof shipment?.estimated_delivery_limit === "object"
      ? shipment?.estimated_delivery_limit?.date
      : shipment?.estimated_delivery_limit;
  if (!dateRaw || typeof dateRaw !== "string") return null;
  const match = dateRaw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function formatPickupDateBR(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split("-");
  return `${dd}/${mm}/${yyyy}`;
}

function formatPickupShort(isoDate: string): string {
  const [, mm, dd] = isoDate.split("-");
  return `${dd}/${mm}`;
}

// ─── Componente ──────────────────────────────────────────────────────

interface ColetasPanelProps {
  orders: MLOrder[];
  /** Permite fechar/abrir o painel. Default: aberto. */
  defaultExpanded?: boolean;
}

export function ColetasPanel({ orders, defaultExpanded = true }: ColetasPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [storeFilter, setStoreFilter] = useState<StoreFilter>("all");
  const [selectedCell, setSelectedCell] = useState<{
    pickupDate: string;
    state: PipelineState;
  } | null>(null);

  const storeFilteredOrders = useMemo(
    () => orders.filter((o) => matchesStoreFilter(o, storeFilter)),
    [orders, storeFilter]
  );

  const { pickupDates, byDate } = useMemo(() => {
    const byDate = new Map<string, Record<PipelineState, MLOrder[]>>();
    for (const order of storeFilteredOrders) {
      const date = getPickupDateKey(order);
      if (!date) continue;
      if (!byDate.has(date)) {
        byDate.set(date, {
          sem_gerar_lo: [],
          nf_gerada: [],
          etiqueta_impressa: [],
        });
      }
      const state = getPipelineState(order);
      byDate.get(date)![state].push(order);
    }
    const pickupDates = Array.from(byDate.keys()).sort();
    return { pickupDates, byDate };
  }, [storeFilteredOrders]);

  const effectiveSelection =
    selectedCell && byDate.has(selectedCell.pickupDate) ? selectedCell : null;

  const selectedOrders = effectiveSelection
    ? byDate.get(effectiveSelection.pickupDate)![effectiveSelection.state]
    : [];

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 py-3 px-4">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
        >
          <Truck className="h-5 w-5" />
          <CardTitle className="text-base font-semibold">
            Coletas por Data
          </CardTitle>
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
              Nenhum pedido com data de coleta definida no filtro atual.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                Coletas: {pickupDates.map(formatPickupDateBR).join("  |  ")}
              </div>

              <div
                className="grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`,
                }}
              >
                {pickupDates.slice(0, 6).map((date) => {
                  const cells = byDate.get(date)!;
                  return (
                    <div key={date} className="rounded-md border bg-muted/20 overflow-hidden">
                      <div className="bg-muted/50 py-2 px-3 text-sm font-semibold">
                        Coleta {formatPickupShort(date)}
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
                      Coleta {formatPickupDateBR(effectiveSelection.pickupDate)}
                      <Badge variant="secondary" className="ml-2">
                        {selectedOrders.length} pedido{selectedOrders.length === 1 ? "" : "s"}
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
                  {selectedOrders.length === 0 ? (
                    <div className="py-4 text-center text-sm text-muted-foreground">
                      Nenhum pedido nesta célula.
                    </div>
                  ) : (
                    <div className="divide-y max-h-72 overflow-y-auto">
                      {selectedOrders.map((order) => (
                        <div
                          key={order.id}
                          className="flex items-center gap-3 px-4 py-2 text-sm"
                        >
                          <span className="font-mono text-xs text-muted-foreground shrink-0">
                            #{order.order_id}
                          </span>
                          <span className="truncate flex-1">
                            {order.item_title || "(sem título)"}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {order.buyer_name || "—"}
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
