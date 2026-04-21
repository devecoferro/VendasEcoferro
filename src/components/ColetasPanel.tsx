import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Calendar, FileText, Printer, PackageCheck, Truck, ChevronDown, ChevronUp } from "lucide-react";
import { hasEmittedInvoice } from "@/services/mercadoLivreHelpers";
import type { MLOrder } from "@/services/mercadoLivreService";
import type {
  MLLiveSnapshotResponse,
  MLLiveSnapshotOrder,
} from "@/services/mlLiveSnapshotService";

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
    tone: "border-amber-300/70 bg-amber-50 text-amber-900 hover:bg-amber-100",
  },
  {
    value: "nf_gerada",
    label: "NFs GERADAS",
    icon: Printer,
    tone: "border-blue-300/70 bg-blue-50 text-blue-900 hover:bg-blue-100",
  },
  {
    value: "etiqueta_impressa",
    label: "NFs e ETIQUETAS IMPRESSAS",
    icon: PackageCheck,
    tone: "border-emerald-300/70 bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
  },
];

// ─── Extração da data de coleta do order do snapshot ─────────────────
//
// O ML Seller Center expressa a data de coleta de 2 formas no
// status_text/description do order:
//
//   1. Explicit:  "Para entregar na coleta do dia 23 de abril"
//   2. Relativa: "A coleta passará amanhã" / "A coleta passará hoje"
//                (texto fica em description, não em status_text)
//
// Também há status como "Pronto para coleta" / "Etiqueta pronta para
// impressão" que NÃO carregam data — esses agrupamos em "Sem data
// definida" pra ainda aparecerem no relatório (operador precisa
// saber que existem mesmo sem previsão explícita).

const PICKUP_DATE_EXPLICIT_RE = /coleta do dia (\d+ de \w+)/i;

const MONTHS_PT: Record<string, string> = {
  janeiro: "01", fevereiro: "02", marco: "03", março: "03", abril: "04",
  maio: "05", junho: "06", julho: "07", agosto: "08",
  setembro: "09", outubro: "10", novembro: "11", dezembro: "12",
};

function getTodayDayMonthLabel(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const day = String(d.getDate());
  const monthIdx = d.getMonth();
  const monthNames = Object.keys(MONTHS_PT).filter(
    (k) => !["março", "março"].includes(k)
  );
  // Gera lista padronizada em português (usa "março" sem pc-latin)
  const ordered = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  void monthNames; // silencia lint
  return `${day} de ${ordered[monthIdx]}`;
}

// Classificação do order em relação à data de coleta:
//   - { label: X }  → data X (explícita ou derivada direto)
//   - "pending"     → status operacional pendente (aguardando NF-e ou
//                     etiqueta) — sem data agendada ainda. Vai ficar
//                     alocado na PRÓXIMA data de coleta agendada.
//   - null          → status nao identificavel (ignorar)
type PickupClassification =
  | { kind: "date"; label: string }
  | { kind: "pending" }
  | null;

function classifyPickupFromSnapshot(
  snapOrder: MLLiveSnapshotOrder
): PickupClassification {
  const text = `${snapOrder.status_text || ""} ${snapOrder.description || ""}`;

  // 1. Data explícita ("coleta do dia 23 de abril")
  const m = text.match(PICKUP_DATE_EXPLICIT_RE);
  if (m) return { kind: "date", label: m[1].toLowerCase().replace("março", "março") };

  // 2. Referências temporais na description
  const lower = text.toLowerCase();
  if (lower.includes("passará hoje") || lower.includes("passara hoje")) {
    return { kind: "date", label: getTodayDayMonthLabel(0) };
  }
  if (lower.includes("passará amanhã") || lower.includes("passara amanha")) {
    return { kind: "date", label: getTodayDayMonthLabel(1) };
  }
  if (lower.includes("próxima coleta") || lower.includes("proxima coleta")) {
    return { kind: "date", label: getTodayDayMonthLabel(1) };
  }

  // 3. "Pronto para coleta" sem mais info → Hoje (coleta diária)
  if (lower.includes("pronto para coleta")) {
    return { kind: "date", label: getTodayDayMonthLabel(0) };
  }

  // 4. Status operacional PENDENTE — ainda não tem coleta agendada.
  // O ML só agenda coleta quando a etiqueta está pronta E a NF-e está
  // emitida. Enquanto isso, esses orders ficam "pending" e serão
  // alocados na PRÓXIMA data de coleta agendada nos dados.
  if (
    lower.includes("etiqueta pronta para impressão") ||
    lower.includes("etiqueta pronta para impressao") ||
    lower.includes("pronta para emitir nf-e") ||
    lower.includes("pronto para emitir nf-e") ||
    lower.includes("pronta para emitir nfe") ||
    lower.includes("pronto para emitir nfe")
  ) {
    return { kind: "pending" };
  }

  return null;
}

// Dado um Set de labels de datas ja detectadas nos dados, retorna o
// label da PRÓXIMA data de coleta (primeiro label > hoje). Se nenhum
// label detectado > hoje, retorna amanhã (hoje+1) como fallback.
function pickNextScheduledDate(availableLabels: string[]): string {
  const todayLabel = getTodayDayMonthLabel(0);
  const todayIdx = monthDayIndex(todayLabel);
  const candidates = availableLabels
    .map((l) => ({ label: l, idx: monthDayIndex(l) }))
    .filter((c) => c.idx > todayIdx)
    .sort((a, b) => a.idx - b.idx);
  if (candidates.length > 0) return candidates[0].label;
  return getTodayDayMonthLabel(1); // fallback: amanhã
}

// Converte "DD de mês" num indice ordenavel (month*100 + day) pra
// comparacao simples. Nao considera virada de ano, mas e suficiente
// pro horizonte de coletas (~7 dias).
function monthDayIndex(label: string): number {
  const [dayStr, monthStr] = label.split(" de ");
  const day = parseInt(dayStr, 10) || 0;
  const monthNum = parseInt(MONTHS_PT[monthStr?.toLowerCase() || ""] || "0", 10);
  return monthNum * 100 + day;
}

function formatShort(label: string): string {
  const parts = label.split(" de ");
  if (parts.length !== 2) return label;
  const day = parts[0].padStart(2, "0");
  const monthKey = parts[1].toLowerCase();
  const month = MONTHS_PT[monthKey] || MONTHS_PT[monthKey.replace("ç", "c")] || "??";
  return `${day}/${month}`;
}

function sortDateLabels(a: string, b: string): number {
  const [dayA, monthA] = a.split(" de ");
  const [dayB, monthB] = b.split(" de ");
  const mA = MONTHS_PT[monthA?.toLowerCase() || ""] || "99";
  const mB = MONTHS_PT[monthB?.toLowerCase() || ""] || "99";
  const cmp = mA.localeCompare(mB);
  if (cmp !== 0) return cmp;
  return (parseInt(dayA, 10) || 0) - (parseInt(dayB, 10) || 0);
}

// Determina em qual das 3 linhas da grid o order cai.
//
// Fonte de verdade preferida: `status_text` do snapshot ML (ao-vivo).
// Motivo: a flag local `__nfe_emitted` só é true quando o EcoFerro emite
// a NF via nosso sistema. Se o vendedor emitir por fora (ou o ML ja
// considerar emitida), nosso DB fica stale. Auditoria em prod mostrou
// 50/50 orders de Ourinhos classificados como "sem_gerar_lo" — todos
// com __nfe_emitted=false — mesmo com o ML mostrando coleta agendada
// (o que so e possivel com NF ja emitida).
//
// Regras (por prioridade):
//   1. label_printed_at local → "etiqueta_impressa" (marca definitiva
//      de impressao pelo nosso sistema; NF implicitamente esta emitida)
//   2. status_text "Pronta para emitir NF-e" → "sem_gerar_lo"
//   3. hasEmittedInvoice(local) === true → "nf_gerada"
//      (preserva o caso legado onde confiamos no nosso sistema)
//   4. Fallback: qualquer outro status em upcoming implica NF ja
//      emitida pelo vendedor (ML so mostra coleta/etiqueta-pronta/etc
//      apos a NF) → "nf_gerada"
function getPipelineState(
  snap: MLLiveSnapshotOrder,
  local: MLOrder | undefined
): PipelineState {
  if (local?.label_printed_at) return "etiqueta_impressa";

  const s = (snap.status_text || "").toLowerCase();
  if (
    s.includes("pronta para emitir nf-e") ||
    s.includes("pronto para emitir nf-e") ||
    s.includes("pronta para emitir nfe") ||
    s.includes("pronto para emitir nfe")
  ) {
    return "sem_gerar_lo";
  }

  if (local && hasEmittedInvoice(local)) return "nf_gerada";

  // Em upcoming, sem status de NF pendente → ML ja confirmou NF
  return "nf_gerada";
}

// ─── Componente ──────────────────────────────────────────────────────

interface ColetasPanelProps {
  /** Orders locais do DB (fonte da verdade pra estados NF/etiqueta). */
  orders: MLOrder[];
  /** Snapshot ao-vivo do ML Seller Center, JÁ ESCOPADO pelo filtro de
   * depósito da página (selectedDepositFilters no topo). Se null ou
   * sem orders, o painel indica estado vazio. */
  scopedLiveSnapshot: MLLiveSnapshotResponse | null;
  /** Label do filtro de depósito atual (pra mostrar no header do painel). */
  currentFilterLabel?: string;
  /** Slot de toolbar renderizado no header (filtros rápidos: periodo,
   * ordenar, status, buscar, limpar). Fornecido pela MercadoLivrePage
   * pra manter o estado dos filtros centralizado. */
  toolbar?: React.ReactNode;
  defaultExpanded?: boolean;
}

export function ColetasPanel({
  orders,
  scopedLiveSnapshot,
  currentFilterLabel,
  toolbar,
  defaultExpanded = true,
}: ColetasPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [selectedCell, setSelectedCell] = useState<{
    pickupDate: string;
    state: PipelineState;
  } | null>(null);

  const localByOrderId = useMemo(() => {
    const map = new Map<string, MLOrder>();
    for (const o of orders) {
      if (o.order_id) map.set(String(o.order_id), o);
    }
    return map;
  }, [orders]);

  const { pickupDates, byDate } = useMemo(() => {
    const byDate = new Map<
      string,
      Record<PipelineState, Array<{ snap: MLLiveSnapshotOrder; local: MLOrder | undefined }>>
    >();
    const upcoming = scopedLiveSnapshot?.orders?.upcoming ?? [];

    // Passada 1: orders com data identificada (explícita ou derivada)
    const pendingOrders: Array<{ snap: MLLiveSnapshotOrder; local: MLOrder | undefined }> = [];
    for (const snap of upcoming) {
      const cls = classifyPickupFromSnapshot(snap);
      const local = localByOrderId.get(String(snap.order_id));
      if (!cls) continue;
      if (cls.kind === "pending") {
        pendingOrders.push({ snap, local });
        continue;
      }
      const state = getPipelineState(snap, local);
      if (!byDate.has(cls.label)) {
        byDate.set(cls.label, {
          sem_gerar_lo: [],
          nf_gerada: [],
          etiqueta_impressa: [],
        });
      }
      byDate.get(cls.label)![state].push({ snap, local });
    }

    // Passada 2: aloca orders "pending" na PRÓXIMA data agendada.
    // "Próxima" = menor data > hoje nos dados já coletados; fallback
    // pra amanhã se não houver nenhuma data futura identificada.
    if (pendingOrders.length > 0) {
      const existingLabels = Array.from(byDate.keys());
      const nextLabel = pickNextScheduledDate(existingLabels);
      if (!byDate.has(nextLabel)) {
        byDate.set(nextLabel, {
          sem_gerar_lo: [],
          nf_gerada: [],
          etiqueta_impressa: [],
        });
      }
      for (const entry of pendingOrders) {
        const state = getPipelineState(entry.snap, entry.local);
        byDate.get(nextLabel)![state].push(entry);
      }
    }

    const pickupDates = Array.from(byDate.keys()).sort(sortDateLabels);
    return { pickupDates, byDate };
  }, [scopedLiveSnapshot, localByOrderId]);

  const effectiveSelection =
    selectedCell && byDate.has(selectedCell.pickupDate) ? selectedCell : null;

  const selectedEntries = effectiveSelection
    ? byDate.get(effectiveSelection.pickupDate)![effectiveSelection.state]
    : [];

  const snapshotUpcomingTotal = scopedLiveSnapshot?.orders?.upcoming?.length ?? 0;
  const withoutPickupDate = snapshotUpcomingTotal - pickupDates.reduce(
    (acc, d) =>
      acc +
      byDate.get(d)!.sem_gerar_lo.length +
      byDate.get(d)!.nf_gerada.length +
      byDate.get(d)!.etiqueta_impressa.length,
    0
  );

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-3 space-y-0 py-3 px-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity shrink-0"
        >
          <Truck className="h-5 w-5" />
          <CardTitle className="text-base font-semibold whitespace-nowrap">Coletas por Data</CardTitle>
          <Badge variant="secondary" className="ml-1">
            {pickupDates.length} data{pickupDates.length === 1 ? "" : "s"}
          </Badge>
          {expanded ? (
            <ChevronUp className="h-4 w-4 ml-1 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 ml-1 text-muted-foreground" />
          )}
        </button>

        {toolbar ? (
          <div className="flex flex-wrap items-center gap-2 min-w-0">{toolbar}</div>
        ) : (
          currentFilterLabel && (
            <span className="text-xs text-muted-foreground">
              Filtro: <span className="font-medium text-foreground">{currentFilterLabel}</span>
            </span>
          )
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="pt-0 space-y-4">
          {pickupDates.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {!scopedLiveSnapshot
                ? "Aguardando snapshot do ML Seller Center..."
                : snapshotUpcomingTotal === 0
                  ? "Nenhum pedido em \"Próximos dias\" no filtro atual."
                  : "Nenhum pedido desse filtro tem data de coleta identificável."}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  Coletas: {pickupDates.map(formatShort).join("  |  ")}
                </div>
                {withoutPickupDate > 0 && (
                  <span className="text-muted-foreground">
                    (+{withoutPickupDate} sem data identificável)
                  </span>
                )}
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
