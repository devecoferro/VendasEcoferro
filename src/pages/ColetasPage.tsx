import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useMercadoLivreData } from "@/hooks/useMercadoLivreData";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Calendar, FileText, Printer, PackageCheck, Truck, RefreshCw } from "lucide-react";
import {
  getOrderStoreKey,
  type MLStoreKey,
} from "@/services/mlSubStatusClassifier";
import { hasEmittedInvoice } from "@/services/mercadoLivreHelpers";
import type { MLOrder } from "@/services/mercadoLivreService";

// ─── Filtros de vendas (topo direito, imagem) ────────────────────────
type StoreFilter = "all" | "without_deposit" | "ourinhos" | "full";

const STORE_OPTIONS: Array<{ value: StoreFilter; label: string; group?: string }> = [
  { value: "all", label: "Todas as vendas" },
  { value: "without_deposit", label: "Vendas sem depósito" },
  { value: "ourinhos", label: "Ourinhos Rua Dario Alonso", group: "Por depósito" },
  { value: "full", label: "Full", group: "Por depósito" },
];

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
    description: "Vendas que já tiveram a NF gerada. Clique em imprimir para mover pra \"Etiquetas Impressas\".",
    icon: Printer,
    tone: "border-blue-300/60 bg-blue-50 text-blue-900 hover:bg-blue-100",
  },
  {
    value: "etiqueta_impressa",
    label: "NFs e ETIQUETAS IMPRESSAS",
    description: "Vendas que já tiveram a NF gerada e as etiquetas impressas.",
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
  // Formato YYYY-MM-DD (sem horário) — facilita agrupamento
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

// ─── Página ──────────────────────────────────────────────────────────

export default function ColetasPage() {
  const [storeFilter, setStoreFilter] = useState<StoreFilter>("all");
  const [selectedCell, setSelectedCell] = useState<{
    pickupDate: string;
    state: PipelineState;
  } | null>(null);

  const {
    orders,
    loading,
    refresh,
  } = useMercadoLivreData();

  // Filtra pedidos por depósito
  const storeFilteredOrders = useMemo(
    () => orders.filter((o) => matchesStoreFilter(o, storeFilter)),
    [orders, storeFilter]
  );

  // Agrupa por data de coleta × estado
  const { pickupDates, byDate } = useMemo(() => {
    const byDate = new Map<string, Record<PipelineState, MLOrder[]>>();
    for (const order of storeFilteredOrders) {
      const date = getPickupDateKey(order);
      if (!date) continue; // sem data = não entra no relatório de coleta
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

  // Reset célula selecionada quando troca filtro de loja
  // (o pedido pode não existir mais no novo filtro)
  const effectiveSelection =
    selectedCell && byDate.has(selectedCell.pickupDate) ? selectedCell : null;

  const selectedOrders = effectiveSelection
    ? byDate.get(effectiveSelection.pickupDate)![effectiveSelection.state]
    : [];

  return (
    <AppLayout>
      <div className="space-y-6 px-6 py-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Truck className="h-7 w-7" />
              Vendas — Coletas por Data
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Relatório operacional agrupado por data de coleta e estado do pipeline (NF + etiqueta).
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refresh?.()}
              disabled={loading}
            >
              <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
              Atualizar
            </Button>

            {/* Filtro de Vendas (topo direito — imagem) */}
            <Select value={storeFilter} onValueChange={(v) => setStoreFilter(v as StoreFilter)}>
              <SelectTrigger className="w-[240px]">
                <SelectValue />
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
          </div>
        </div>

        {/* Grid de coletas */}
        {pickupDates.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              {loading
                ? "Carregando pedidos..."
                : "Nenhum pedido com data de coleta definida no filtro atual."}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Calendar className="h-4 w-4" />
              Coletas: {pickupDates.map(formatPickupDateBR).join("  |  ")}
            </div>

            <div
              className="grid gap-4"
              style={{
                gridTemplateColumns: `repeat(${Math.min(pickupDates.length, 4)}, minmax(240px, 1fr))`,
              }}
            >
              {pickupDates.slice(0, 4).map((date) => {
                const cells = byDate.get(date)!;
                return (
                  <Card key={date} className="overflow-hidden">
                    <CardHeader className="bg-muted/40 py-3 px-4">
                      <CardTitle className="text-sm font-semibold">
                        Coleta {formatPickupShort(date)}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-2 space-y-2">
                      {PIPELINE_STATES.map((state) => {
                        const count = cells[state.value].length;
                        const Icon = state.icon;
                        const isSelected =
                          effectiveSelection?.pickupDate === date &&
                          effectiveSelection?.state === state.value;
                        return (
                          <button
                            key={state.value}
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
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Descrições dos estados (blocos 3/4/5 da imagem) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sobre os estados</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3 text-sm">
            {PIPELINE_STATES.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.value} className="flex items-start gap-2">
                  <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-medium">{s.label}</div>
                    <div className="text-muted-foreground text-xs">{s.description}</div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Lista da célula selecionada */}
        {effectiveSelection && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {PIPELINE_STATES.find((s) => s.value === effectiveSelection.state)?.label} —
                Coleta {formatPickupDateBR(effectiveSelection.pickupDate)}
                <Badge variant="secondary" className="ml-2">
                  {selectedOrders.length} pedido{selectedOrders.length === 1 ? "" : "s"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {selectedOrders.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Nenhum pedido nesta célula.
                </div>
              ) : (
                <div className="divide-y">
                  {selectedOrders.map((order) => (
                    <div key={order.id} className="flex items-center gap-3 px-4 py-2 text-sm">
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
            </CardContent>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
