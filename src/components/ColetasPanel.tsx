import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Calendar, FileText, Printer, PackageCheck } from "lucide-react";
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

// Mapeia order para uma das 3 linhas do painel espelhando como o
// ML Seller Center qualifica cada venda em "Próximos dias":
//
//   ML Seller Center                     →   Painel (3 linhas)
//   ──────────────────────────────────────────────────────────────
//   "NF-e para gerenciar"                →   SEM GERAR LO
//   (status_text: "Pronta para emitir NF-e de venda")
//
//   "Etiquetas para imprimir"            →   GERADAS
//   "Em processamento"                   →   GERADAS
//   "Por envio padrão"                   →   GERADAS
//   (status_text: "Etiqueta pronta para impressão" e afins)
//
//   "Prontas para enviar"                →   IMPRESSAS
//   (status_text: "Pronto para coleta" / "Para entregar na coleta
//    do dia X") — o ML só move pra cá depois da etiqueta pronta
//
// Engenharia reversa feita ontem no seller-center-scraper.js
// (aggregateSubCards) já categorizava nesses mesmos buckets.
//
// Override local: se `label_printed_at` foi marcado pelo nosso
// sistema, forçamos "etiqueta_impressa" mesmo que o ML ainda não
// tenha atualizado pro bucket "Prontas para enviar".
function getPipelineState(
  snap: MLLiveSnapshotOrder,
  local: MLOrder | undefined
): PipelineState {
  // 1. Override local: nosso sistema já marcou etiqueta como impressa
  if (local?.label_printed_at) return "etiqueta_impressa";

  const s = (snap.status_text || "").toLowerCase();

  // 2. ML diz "Pronta para emitir NF-e" → SEM GERAR LO
  if (
    s.includes("pronta para emitir nf-e") ||
    s.includes("pronto para emitir nf-e") ||
    s.includes("pronta para emitir nfe") ||
    s.includes("pronto para emitir nfe")
  ) {
    return "sem_gerar_lo";
  }

  // 3. ML diz "Pronto para coleta" ou "Para entregar na coleta do dia X"
  //    → bucket "Prontas para enviar" do ML = IMPRESSAS no nosso painel
  if (
    s.includes("pronto para coleta") ||
    s.includes("para entregar na coleta")
  ) {
    return "etiqueta_impressa";
  }

  // 4. Tudo o mais em upcoming = tem NF mas falta etapa intermediária
  //    ("Etiqueta pronta para impressão" / "Em processamento" /
  //     "Por envio padrão") → GERADAS
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
  /** Slot de toolbar renderizado no header (filtros rápidos: periodo,
   * ordenar, status, buscar, limpar). Fornecido pela MercadoLivrePage
   * pra manter o estado dos filtros centralizado. */
  toolbar?: React.ReactNode;
  /** Callback quando user clica numa célula. MercadoLivrePage usa pra
   * filtrar a lista de pedidos abaixo do painel pros order_ids
   * daquela célula. Null = sem filtro de célula ativo. */
  onSelectCell?: (selection: {
    orderIds: string[];
    dateLabel: string;
    state: PipelineState;
  } | null) => void;
}

export function ColetasPanel({
  orders,
  scopedLiveSnapshot,
  toolbar,
  onSelectCell,
}: ColetasPanelProps) {
  const [selectedCell, setSelectedCell] = useState<{
    dateLabel: string;
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
    // Une orders dos dois tabs do ML Seller Center:
    //   - today: "Envios de hoje" (83 no ML Ourinhos) — orders que
    //     precisam ser enviados HOJE (status_text: "Pronto para coleta",
    //     "Prontas para enviar", "Venda cancelada. Nao envie" etc.)
    //   - upcoming: "Proximos dias" (110 no ML Ourinhos) — orders com
    //     coleta agendada pra depois de hoje
    //
    // Ambos passam pelo mesmo classifyPickupFromSnapshot. Orders
    // "Pronto para coleta" sem data explicita caem em HOJE (getTodayDayMonthLabel(0)).
    // Dedup por order_id+pack_id no final pra evitar se o ML retornar
    // o mesmo pedido em ambos tabs (edge case raro).
    const todayOrders = scopedLiveSnapshot?.orders?.today ?? [];
    const upcomingOrders = scopedLiveSnapshot?.orders?.upcoming ?? [];
    const seen = new Set<string>();
    const upcoming: MLLiveSnapshotOrder[] = [];
    for (const o of [...todayOrders, ...upcomingOrders]) {
      const key = `${o.pack_id || ""}_${o.order_id || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      upcoming.push(o);
    }

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

  // Propaga seleção pro parent (MercadoLivrePage filtra lista principal)
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
      .map((entry) => String(entry.snap.order_id))
      .filter(Boolean);
    onSelectCell({
      orderIds,
      dateLabel: selectedCell.dateLabel,
      state: selectedCell.state,
    });
  }, [selectedCell, byDate, onSelectCell]);

  const snapshotUpcomingTotal =
    (scopedLiveSnapshot?.orders?.today?.length ?? 0) +
    (scopedLiveSnapshot?.orders?.upcoming?.length ?? 0);
  const withoutPickupDate = snapshotUpcomingTotal - pickupDates.reduce(
    (acc, d) =>
      acc +
      byDate.get(d)!.sem_gerar_lo.length +
      byDate.get(d)!.nf_gerada.length +
      byDate.get(d)!.etiqueta_impressa.length,
    0
  );

  // ─── Extrapolação proporcional ao total real do ML ─────────────────
  // O scraper pega só os 50 primeiros orders por tab (limitação do ML
  // Seller Center — paginação client-side não funciona via offset).
  // Mas counters.upcoming vem do brick segmented_actions e tem o
  // total REAL (ex: 169). Pra o painel não subestimar drasticamente,
  // extrapolamos proporcionalmente.
  //
  // Exemplo: amostra=50, total_ml=169 → ratio=3.38
  //   Se amostra tem 15 "sem_gerar_lo" → extrapolado ≈ 51
  // Soma today + upcoming pra bater com a amostra (que agora cobre os 2 tabs).
  // Ex: Ourinhos hoje: today=83, upcoming=110 → total=193.
  const mlTotalUpcoming =
    (scopedLiveSnapshot?.counters?.today ?? 0) +
    (scopedLiveSnapshot?.counters?.upcoming ?? 0);
  const extrapolationRatio =
    snapshotUpcomingTotal > 0 && mlTotalUpcoming > snapshotUpcomingTotal
      ? mlTotalUpcoming / snapshotUpcomingTotal
      : 1;
  const extrapolate = (sampleCount: number): number =>
    extrapolationRatio === 1
      ? sampleCount
      : Math.round(sampleCount * extrapolationRatio);
  const isExtrapolating = extrapolationRatio > 1;

  return (
    <Card className="overflow-hidden">
      {toolbar && (
        <CardHeader className="flex flex-col gap-3 space-y-0 py-3 px-4 2xl:flex-row 2xl:items-center 2xl:justify-end">
          <div className="flex flex-wrap items-center gap-2 min-w-0">{toolbar}</div>
        </CardHeader>
      )}

      <CardContent className={cn("space-y-4", toolbar ? "pt-0" : "pt-4")}>
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
              <div className="flex items-center justify-between gap-2 text-xs flex-wrap">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  Coletas: {pickupDates.map(formatShort).join("  |  ")}
                </div>
                <div className="flex items-center gap-3 text-muted-foreground">
                  {isExtrapolating && (
                    <span
                      title={`O scraper captura os primeiros ${snapshotUpcomingTotal} pedidos por tab. Os contadores acima são extrapolados proporcionalmente pro total real do ML (${mlTotalUpcoming}). Distribuição baseada na amostra.`}
                      className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 px-2 py-0.5 font-medium"
                    >
                      amostra {snapshotUpcomingTotal}/{mlTotalUpcoming} · extrapolado ×{extrapolationRatio.toFixed(2)}
                    </span>
                  )}
                  {withoutPickupDate > 0 && (
                    <span>(+{withoutPickupDate} sem data identificável)</span>
                  )}
                </div>
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
                          const sampleCount = cells[state.value].length;
                          const displayCount = extrapolate(sampleCount);
                          const Icon = state.icon;
                          const isSelected =
                            selectedCell?.dateLabel === date &&
                            selectedCell?.state === state.value;
                          return (
                            <button
                              key={state.value}
                              type="button"
                              disabled={sampleCount === 0}
                              onClick={() => {
                                setSelectedCell(
                                  isSelected
                                    ? null
                                    : { dateLabel: date, state: state.value }
                                );
                              }}
                              className={cn(
                                "w-full flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs font-medium transition-colors",
                                state.tone,
                                isSelected && "ring-2 ring-primary ring-offset-1",
                                sampleCount === 0 && "opacity-60 cursor-not-allowed"
                              )}
                              title={
                                sampleCount === 0
                                  ? "Sem pedidos nesta célula"
                                  : isExtrapolating
                                  ? `${sampleCount} na amostra · ~${displayCount} no ML total`
                                  : undefined
                              }
                            >
                              <span className="flex items-center gap-2">
                                <Icon className="h-4 w-4" />
                                {state.label}
                              </span>
                              <Badge variant="secondary">
                                {displayCount}
                                {isExtrapolating && sampleCount > 0 && (
                                  <span className="ml-1 text-[9px] opacity-60">~</span>
                                )}
                              </Badge>
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
