import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Calendar, FileText, Printer, PackageCheck, Truck, Info, Warehouse } from "lucide-react";
import {
  hasEmittedInvoice,
  isOrderInvoicePending,
  getShipmentSnapshot,
} from "@/services/mercadoLivreHelpers";
import { getOrderPrimaryBucket } from "@/services/mlSubStatusClassifier";
import type { MLOrder } from "@/services/mercadoLivreService";

// ─── Estados do pipeline (linhas da grid) ────────────────────────────
type PipelineState = "sem_gerar_lo" | "nf_gerada" | "etiqueta_impressa";

interface PipelineStateConfig {
  value: PipelineState;
  label: string;
  icon: typeof FileText;
  tone: string;
}

interface PipelineStateConfigExt extends PipelineStateConfig {
  description: string;
  flowNote: string;
}

const PIPELINE_STATES: PipelineStateConfigExt[] = [
  {
    value: "sem_gerar_lo",
    label: "NFs SEM GERAR LO",
    icon: FileText,
    tone: "border-amber-300/70 bg-amber-50 text-amber-900 hover:bg-amber-100",
    description:
      "Visualiza todas as vendas que ainda não tiveram a Nota Fiscal gerada (local de origem — LO).",
    flowNote:
      "Esse filtro apresenta as vendas elegíveis para serem geradas as NFs e Etiquetas de envio. Após gerar, migram para “NFs GERADAS”.",
  },
  {
    value: "nf_gerada",
    label: "NFs GERADAS",
    icon: Printer,
    tone: "border-blue-300/70 bg-blue-50 text-blue-900 hover:bg-blue-100",
    description:
      "Exibe as vendas que já tiveram a Nota Fiscal gerada. O número indica a quantidade de NFs geradas.",
    flowNote:
      "Apresenta as NFs e Etiquetas Geradas. Se o usuário selecionar e clicar em imprimir, as vendas passam a fazer parte do filtro “NFs e ETIQUETAS IMPRESSAS”.",
  },
  {
    value: "etiqueta_impressa",
    label: "NFs e ETIQUETAS IMPRESSAS",
    icon: PackageCheck,
    tone: "border-emerald-300/70 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
    description:
      "Exibe as vendas que já tiveram a NF gerada e as etiquetas impressas. O número indica a quantidade.",
    flowNote:
      "Apresenta todas as vendas com NFs e Etiquetas Geradas e Impressas. Prontas para a coleta.",
  },
];

// ─── Extração da data de coleta do MLOrder local ─────────────────────
//
// Antes: regex em snap.status_text ("coleta do dia 23 de abril") +
// amostra de 50 pedidos do scraper. Isso subestimava 3-4x o total.
//
// Agora: lê direto os campos estruturados do raw_data, sem regex:
//   1. order.pickup_scheduled_date (campo enriquecido pela sync,
//      vem de lead_time.estimated_schedule_limit.date do ML)
//   2. shipment_snapshot.pickup_date
//   3. shipment_snapshot.estimated_delivery_limit.date
//
// Retorna a data como objeto Date, ou null se nenhum candidato
// parseou com sucesso. Null = "Sem data definida" no painel.

function parsePickupDate(order: MLOrder): Date | null {
  const ship = getShipmentSnapshot(order);
  const edl = ship.estimated_delivery_limit as
    | { date?: string }
    | string
    | undefined;
  const candidates: Array<string | undefined> = [
    order.pickup_scheduled_date ?? undefined,
    typeof ship.pickup_date === "string" ? ship.pickup_date : undefined,
    typeof edl === "object" && edl ? edl.date : typeof edl === "string" ? edl : undefined,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(c);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

// Formata Date em DD/MM/YYYY usando fuso local America/Sao_Paulo.
// O mockup do usuario usa esse formato exato ("Coleta 22/04/2026").
function formatPickupDateLabel(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

// Comparador de labels DD/MM/YYYY pra ordenar colunas da grid.
function sortDateLabels(a: string, b: string): number {
  const [dA, mA, yA] = a.split("/").map(Number);
  const [dB, mB, yB] = b.split("/").map(Number);
  if (yA !== yB) return yA - yB;
  if (mA !== mB) return mA - mB;
  return dA - dB;
}

// ─── Determina o estado do pipeline pra um MLOrder ────────────────────
//
// Prioridade:
//   1. label_printed_at (nosso sistema marcou) → IMPRESSAS
//   2. shipment_snapshot.substatus === "printed" (ML marcou) → IMPRESSAS
//   3. NF pendente de emissao (isOrderInvoicePending)       → SEM GERAR LO
//   4. NF ja emitida internamente (hasEmittedInvoice)       → GERADAS
//   5. Fallback                                              → SEM GERAR LO
function getPipelineStateFromOrder(order: MLOrder): PipelineState {
  if (order.label_printed_at) return "etiqueta_impressa";

  const ship = getShipmentSnapshot(order);
  const substatus = String(ship.substatus || "").toLowerCase();
  if (substatus === "printed") return "etiqueta_impressa";

  if (isOrderInvoicePending(order)) return "sem_gerar_lo";

  if (hasEmittedInvoice(order)) return "nf_gerada";

  return "sem_gerar_lo";
}

// ─── Componente ──────────────────────────────────────────────────────

interface ColetasPanelProps {
  /**
   * Orders locais do DB (ja filtrados por permissao/deposito pelo parent).
   * E a FONTE DA VERDADE — o painel classifica cada order via
   * getOrderPrimaryBucket + parsePickupDate + getPipelineStateFromOrder.
   */
  orders: MLOrder[];
  /** Slot de toolbar renderizado no header (filtros rapidos: periodo,
   * ordenar, status, buscar, limpar). Fornecido pela MercadoLivrePage
   * pra manter o estado dos filtros centralizado. */
  toolbar?: React.ReactNode;
  /** Callback quando user clica numa celula. MercadoLivrePage usa pra
   * filtrar a lista de pedidos abaixo do painel pros order_ids
   * daquela celula. Null = sem filtro de celula ativo. */
  onSelectCell?: (selection: {
    orderIds: string[];
    dateLabel: string;
    state: PipelineState;
  } | null) => void;
}

export function ColetasPanel({
  orders,
  toolbar,
  onSelectCell,
}: ColetasPanelProps) {
  const [selectedCell, setSelectedCell] = useState<{
    dateLabel: string;
    state: PipelineState;
  } | null>(null);

  const { pickupDates, byDate, noDateCount, totalClassified } = useMemo(() => {
    // Map: dateLabel (DD/MM/YYYY) → bucket de orders por estado
    const byDate = new Map<string, Record<PipelineState, MLOrder[]>>();
    let noDateCount = 0;
    let totalClassified = 0;

    for (const order of orders) {
      // 1. So classifica orders em "today" ou "upcoming" — o resto
      // (in_transit/finalized) NAO pertence ao painel de coleta.
      const bucket = getOrderPrimaryBucket(order);
      if (bucket !== "today" && bucket !== "upcoming") continue;

      const date = parsePickupDate(order);
      const state = getPipelineStateFromOrder(order);

      if (!date) {
        // Orders sem data de coleta identificavel — contam no rodape
        // mas nao entram na grid (nao ha coluna onde encaixar).
        noDateCount++;
        continue;
      }

      const label = formatPickupDateLabel(date);
      if (!byDate.has(label)) {
        byDate.set(label, {
          sem_gerar_lo: [],
          nf_gerada: [],
          etiqueta_impressa: [],
        });
      }
      byDate.get(label)![state].push(order);
      totalClassified++;
    }

    const pickupDates = Array.from(byDate.keys()).sort(sortDateLabels);
    return { pickupDates, byDate, noDateCount, totalClassified };
  }, [orders]);

  // Propaga selecao pro parent (MercadoLivrePage filtra lista principal)
  useEffect(() => {
    if (!onSelectCell) return;
    if (!selectedCell) {
      onSelectCell(null);
      return;
    }
    const cells = byDate.get(selectedCell.dateLabel);
    if (!cells) {
      onSelectCell(null);
      return;
    }
    const list = cells[selectedCell.state];
    const orderIds = list
      .map((order) => String(order.order_id ?? order.id))
      .filter(Boolean);
    onSelectCell({
      orderIds,
      dateLabel: selectedCell.dateLabel,
      state: selectedCell.state,
    });
  }, [selectedCell, byDate, onSelectCell]);

  return (
    <Card className="overflow-hidden">
      {toolbar && (
        <CardHeader className="flex flex-col gap-3 space-y-0 py-3 px-4 2xl:flex-row 2xl:items-center 2xl:justify-end">
          <div className="flex flex-wrap items-center gap-2 min-w-0">{toolbar}</div>
        </CardHeader>
      )}

      <CardContent className={cn("space-y-4", toolbar ? "pt-0" : "pt-4")}>
        {/* Titulo do bloco (destaque conforme especificacao-mockup) */}
        <div className="flex items-center gap-2">
          <Truck className="h-4 w-4 text-emerald-700" />
          <h2 className="text-sm font-bold uppercase tracking-wide text-emerald-900">
            Coletas por Data
          </h2>
        </div>

        {pickupDates.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            {orders.length === 0
              ? "Aguardando pedidos..."
              : totalClassified === 0 && noDateCount === 0
                ? "Nenhum pedido elegível para coleta no filtro atual."
                : "Nenhum pedido com data de coleta identificável."}
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                Coletas: {pickupDates.join("  |  ")}
              </div>
              {noDateCount > 0 && (
                <div className="text-muted-foreground">
                  (+{noDateCount} sem data identificável)
                </div>
              )}
            </div>

            {/* Matriz linhas=estados × colunas=datas, layout 1:1 com o mockup.
                Overflow-x-auto pra nao quebrar em telas estreitas. */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {/* Celula canto vazia sobre a coluna de labels */}
                    <th className="p-2 text-left font-semibold text-muted-foreground w-[220px]">
                      &nbsp;
                    </th>
                    {pickupDates.slice(0, 6).map((date) => (
                      <th
                        key={date}
                        className="border bg-muted/60 p-2 text-center font-semibold"
                      >
                        Coleta {date}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PIPELINE_STATES.map((state) => {
                    const Icon = state.icon;
                    const rowTotal = pickupDates.reduce(
                      (acc, date) =>
                        acc + (byDate.get(date)?.[state.value].length ?? 0),
                      0
                    );
                    return (
                      <tr key={state.value}>
                        <td
                          className={cn(
                            "border px-3 py-2 font-medium align-middle",
                            state.tone.replace(/hover:[^\s]+/g, "")
                          )}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-2">
                              <Icon className="h-4 w-4 shrink-0" />
                              {state.label}
                            </span>
                            {rowTotal > 0 && (
                              <Badge variant="secondary" className="shrink-0">
                                {rowTotal}
                              </Badge>
                            )}
                          </span>
                        </td>
                        {pickupDates.slice(0, 6).map((date) => {
                          const count = byDate.get(date)?.[state.value].length ?? 0;
                          const isSelected =
                            selectedCell?.dateLabel === date &&
                            selectedCell?.state === state.value;
                          return (
                            <td key={date} className="border p-1">
                              <button
                                type="button"
                                disabled={count === 0}
                                onClick={() => {
                                  setSelectedCell(
                                    isSelected
                                      ? null
                                      : { dateLabel: date, state: state.value }
                                  );
                                }}
                                className={cn(
                                  "w-full rounded-md border px-3 py-2 text-center text-sm font-semibold transition-colors",
                                  count === 0
                                    ? "border-dashed border-muted-foreground/20 bg-transparent text-muted-foreground/40 cursor-not-allowed"
                                    : state.tone,
                                  isSelected && "ring-2 ring-primary ring-offset-1"
                                )}
                                title={
                                  count === 0
                                    ? "Sem pedidos nesta célula"
                                    : `${count} pedido(s) em ${state.label} pra coleta ${date}`
                                }
                              >
                                {count === 0 ? "—" : count}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ─── Sobre os estados (legenda conforme mockup) ──────────── */}
        <div className="mt-2 rounded-md border bg-muted/10 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <Info className="h-3.5 w-3.5" />
            Sobre os estados
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            {PIPELINE_STATES.map((state) => {
              const Icon = state.icon;
              return (
                <div
                  key={state.value}
                  className={cn(
                    "rounded-md border px-3 py-2 text-xs space-y-1",
                    state.tone
                  )}
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <Icon className="h-3.5 w-3.5" />
                    {state.label}
                  </div>
                  <p className="text-[11px] opacity-90">{state.description}</p>
                  <p className="text-[11px] opacity-75 italic">{state.flowNote}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* ─── Sobre os depósitos (conforme mockup) ────────────────── */}
        <div className="rounded-md border bg-muted/10 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <Warehouse className="h-3.5 w-3.5" />
            Sobre os depósitos
          </div>
          <p className="text-[11px] text-muted-foreground">
            Ao selecionar uma opção em <strong>&quot;Por depósito&quot;</strong> no
            filtro de vendas do topo, o relatório considerará apenas as vendas
            realizadas a partir do depósito escolhido.
          </p>
          <ul className="text-[11px] text-muted-foreground space-y-1 pl-4 list-disc">
            <li>
              <strong>Ourinhos Rua Dario Alonso:</strong> considera apenas as
              vendas do depósito localizado na Rua Dario Alonso, Ourinhos.
            </li>
            <li>
              <strong>Full:</strong> considera apenas as vendas do depósito Full
              (Mercado Envios — estoque no ML).
            </li>
            <li>
              <strong>Vendas sem depósito:</strong> pedidos sem depósito físico
              associado.
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
