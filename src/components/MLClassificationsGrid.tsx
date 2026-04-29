/**
 * MLClassificationsGrid — cards 1:1 com o ML Seller Center, sensíveis
 * ao (depósito × bucket). Substitui o SubClassificationsBar antigo.
 *
 * Diferença do anterior:
 * - Títulos dos cards variam por depósito (Full → "Full", Ourinhos →
 *   "PROGRAMADA Coleta" / "Coleta | Amanhã")
 * - Agrupamento por (section × pickupDateLabel) — upcoming pode ter
 *   múltiplos cards "Coleta | Amanhã" / "Coleta | A partir de X"
 * - Sub-status clicáveis filtram a lista principal de pedidos
 *
 * Estrutura de dados:
 *   orders → grupo por (section + pickupDateLabel opcional) → cards
 *            cada card tem: título + subtítulo opcional + lista de
 *            sub-status com contagem clicável
 */
import { useMemo } from "react";
import { HelpCircle, MessageSquare } from "lucide-react";
import type { MLOrder } from "@/services/mercadoLivreService";
import type { ShipmentBucket } from "@/services/mercadoLivreHelpers";
import type { MLLiveSnapshotCardsByTab } from "@/services/mlLiveSnapshotService";
import {
  type MLSubStatus,
  type MLSection,
  type MLStoreKey,
  getOrderSubstatus,
  getOrderSection,
  getOrderPickupDateLabel,
  getOrderStoreKey,
  getMLCardTitle,
  SUBSTATUS_LABELS,
  SUBSTATUS_TONES,
  SUBSTATUS_HAS_HELP,
  SUBSTATUS_HELP_TEXT,
} from "@/services/mlSubStatusClassifier";

/** Formata contagens grandes igual ML (+999 pra >999). */
function formatCount(n: number): string {
  if (n > 999) return "+999";
  return String(n);
}

interface MLClassificationsGridProps {
  orders: MLOrder[];
  bucket: ShipmentBucket;
  /** Depósito selecionado no filtro do topo. "all" = todos (agregado).
   * Afeta os TÍTULOS dos cards (ex: "Full" vs "PROGRAMADA Coleta"). */
  deposit: "all" | MLStoreKey | "unknown";
  selectedSubStatus: MLSubStatus | null;
  onSelectSubStatus: (substatus: MLSubStatus | null) => void;
  selectedPickupGroup: string | null;
  onSelectPickupGroup: (group: string | null) => void;
  /** Cards + tasks parseados dos bricks ML. Quando presente, os counts
   * vem direto do ML (match 1:1). Engenharia reversa 2026-04-28. */
  cardsByTab?: MLLiveSnapshotCardsByTab | null;
}

interface SubStatusEntry {
  substatus: MLSubStatus;
  count: number;
}

interface SectionCard {
  key: string;
  section: MLSection;
  subtitle?: string;
  title: string;
  total: number;
  substatuses: SubStatusEntry[];
  pickupGroup?: string;
  /** Depósito que drive o título (pro Ourinhos/Full quando agregado). */
  inferredDeposit: MLStoreKey;
}

// Ordem dos sub-status dentro de cada card — match exato com ML Seller
// Center conforme prints de referencia 2026-04-28 (Classificacao ML/).
// Sub-status nao listados aparecem no final por ordem de contagem.
//
// Ajuste 2026-04-29: invoice_pending movido pra posicao 2 (logo apos
// cancelled_no_send) — print 022517 mostra ML PROGRAMADA Coleta como:
//   Canceladas. Nao enviar > NF-e para gerenciar > Etiquetas para
//   imprimir > Com mensagens nao lidas.
const SUBSTATUS_DISPLAY_ORDER: MLSubStatus[] = [
  // Today > Para enviar — ordem do ML print 022517 (Ourinhos)
  // e 022652 (Full):
  "cancelled_no_send",       // Canceladas. Não enviar
  "invoice_pending",         // NF-e para gerenciar
  "ready_to_print",          // Etiquetas para imprimir
  "ready_to_send",           // Prontas para enviar
  "in_distribution_center",  // No centro de distribuição (Full)
  // Upcoming > Coleta — print 022537:
  "printed_ready_to_send",
  "in_processing",
  "standard_shipping",       // Por envio padrão
  // Today > Devoluções — print 022517:
  "return_arriving_today",
  "return_pending_review",   // Revisão pendente
  // Upcoming > Devoluções — prints 022133, 022537, 022731:
  "return_in_transit",       // A caminho (devoluções)
  "return_in_ml_review",     // Em revisão pelo Mercado Livre
  // In transit — prints 022153, 022558, 022749:
  "waiting_buyer_pickup",    // Esperando retirada do comprador
  "shipped_collection",      // Coleta
  "shipped_full",            // Full
  // Finalized > Para atender — prints 022233, 022620, 022821:
  "claim_or_mediation",      // Com reclamação ou mediação
  // Finalized > Encerradas — print 022620:
  "delivered",               // Entregues
  "not_delivered",           // Não entregues
  "cancelled_final",         // Canceladas
  "returns_completed",       // Devoluções concluídas
  "returns_not_completed",   // Devoluções não concluídas
  "with_unread_messages",    // Com mensagens não lidas (sempre por ultimo)
];

function sortSubstatuses(a: SubStatusEntry, b: SubStatusEntry): number {
  const idxA = SUBSTATUS_DISPLAY_ORDER.indexOf(a.substatus);
  const idxB = SUBSTATUS_DISPLAY_ORDER.indexOf(b.substatus);
  if (idxA !== -1 && idxB !== -1) return idxA - idxB;
  if (idxA !== -1) return -1;
  if (idxB !== -1) return 1;
  return b.count - a.count;
}

// Mapping ML CARD_ID → MLSection (engenharia reversa 2026-04-28).
// Cobre todos os card IDs documentados em ml-bricks-reverse-engineered.md.
const ML_CARD_ID_TO_SECTION: Record<string, MLSection> = {
  CARD_CROSS_DOCKING_TODAY: "para_enviar_coleta",
  CARD_FULL: "para_enviar_coleta",
  CARD_RETURNS_TODAY: "envios_devolucoes",
  CARD_CROSS_DOCKING_NEXT_DAYS: "coleta_dia",
  CARD_CROSS_DOCKING_AFTER_NEXT_DAY: "coleta_dia",
  CARD_RETURNS_NEXT_DAYS: "proximos_devolucoes",
  CARD_WAITING_FOR_WITHDRAWAL: "para_retirar",
  CARD_IN_THE_WAY: "a_caminho",
  CARD_SALES_TO_ATTEND_FINISHED: "para_atender",
  CARD_CLOSED_SALES_FINISHED: "encerradas",
};

// Ordena section pra "Para enviar" vir antes de "Devoluções", etc.
const SECTION_DISPLAY_ORDER: MLSection[] = [
  "para_enviar_coleta",
  "envios_devolucoes",
  "coleta_dia",
  "proximos_devolucoes",
  "para_retirar",
  "a_caminho",
  "para_atender",
  "encerradas",
];

function sortCards(a: SectionCard, b: SectionCard): number {
  const idxA = SECTION_DISPLAY_ORDER.indexOf(a.section);
  const idxB = SECTION_DISPLAY_ORDER.indexOf(b.section);
  if (idxA !== idxB) return idxA - idxB;
  // Mesma section — ordena por pickup group (Amanhã < A partir de X)
  if (a.pickupGroup && b.pickupGroup) {
    // "Hoje" < "Amanhã" < "Quarta-feira" < "A partir de..." — usa o
    // proprio getOrderPickupDateLabel mas como sao strings, ordem
    // alfabetica funciona bem pra "A partir de" ficar no final.
    const aPrefixed = a.pickupGroup.startsWith("A partir") ? "z" + a.pickupGroup : a.pickupGroup;
    const bPrefixed = b.pickupGroup.startsWith("A partir") ? "z" + b.pickupGroup : b.pickupGroup;
    return aPrefixed.localeCompare(bPrefixed);
  }
  return 0;
}

export function MLClassificationsGrid({
  orders,
  bucket,
  deposit,
  selectedSubStatus,
  onSelectSubStatus,
  selectedPickupGroup,
  onSelectPickupGroup,
  cardsByTab,
}: MLClassificationsGridProps) {
  const cards = useMemo<SectionCard[]>(() => {
    // Engenharia reversa 2026-04-28: quando cardsByTab esta disponivel
    // (ML retornou bricks dashboard_operations_card no event-request),
    // usamos esses dados DIRETAMENTE — match 1:1 com ML Seller Center.
    const mlCards = cardsByTab?.[bucket];
    if (mlCards && mlCards.length > 0) {
      const targetDeposit: MLStoreKey =
        deposit === "all" ? "outros" : (deposit as MLStoreKey);
      const result: SectionCard[] = [];
      for (const mlCard of mlCards) {
        const section = ML_CARD_ID_TO_SECTION[mlCard.card_id];
        if (!section) continue;
        const substatuses: SubStatusEntry[] = [];
        for (const task of mlCard.tasks) {
          if (!task.substatus) continue;
          substatuses.push({
            substatus: task.substatus as MLSubStatus,
            count: task.count,
          });
        }
        substatuses.sort(sortSubstatuses);

        // Pickup group: extrair de label "Coleta | Amanhã" ou "A partir de X"
        let pickupGroup: string | undefined = undefined;
        if (section === "coleta_dia" && mlCard.label) {
          const match = mlCard.label.match(/^Coleta\s*\|\s*(.+)$/);
          if (match) pickupGroup = match[1].trim();
        }

        result.push({
          key: `${mlCard.card_id_full}::${targetDeposit}`,
          section,
          subtitle: mlCard.tag || undefined,
          title: mlCard.label || section,
          total: mlCard.total,
          substatuses,
          pickupGroup,
          inferredDeposit: targetDeposit,
        });
      }
      result.sort(sortCards);
      return result;
    }

    // Fallback: classificacao local quando nao temos dados do ML
    // Agrupa: section + (pickup_date pra upcoming) + inferredDeposit
    const groups = new Map<
      string,
      {
        section: MLSection;
        pickupGroup?: string;
        inferredDeposit: MLStoreKey;
        counts: Map<MLSubStatus, number>;
      }
    >();

    for (const order of orders) {
      const section = getOrderSection(order, bucket);
      const substatus = getOrderSubstatus(order, bucket);
      if (!section || !substatus) continue;

      const orderDeposit = getOrderStoreKey(order);
      // Chave do agrupamento:
      //   upcoming: section + pickupGroup + deposit inferido (se "all")
      //   outros:   section + deposit inferido (se "all")
      const pickupGroup =
        bucket === "upcoming" && section === "coleta_dia"
          ? getOrderPickupDateLabel(order)
          : undefined;
      // Quando o filtro e "all", separamos por deposito inferido pra
      // gerar 1 card por deposito (Ourinhos + Full lado a lado).
      // Quando o filtro e especifico (full/ourinhos/unknown), um unico
      // card representa o scope.
      const depositKey = deposit === "all" ? orderDeposit : (deposit as MLStoreKey);
      const key = `${section}::${pickupGroup ?? ""}::${depositKey}`;

      if (!groups.has(key)) {
        groups.set(key, {
          section,
          pickupGroup,
          inferredDeposit: depositKey,
          counts: new Map(),
        });
      }
      const g = groups.get(key)!;
      g.counts.set(substatus, (g.counts.get(substatus) || 0) + 1);
    }

    // Brief 2026-04-28: garante que os cards PADRAO do bucket apareçam
    // sempre (com count 0) — espelha estrutura do ML Seller Center que
    // mostra "Devoluções", "Para retirar", "Para atender", "Encerradas"
    // mesmo quando vazios. Antes a UI sumia o card → operador achava
    // que faltava feature.
    const STANDARD_SECTIONS_BY_BUCKET: Record<ShipmentBucket, MLSection[]> = {
      today: ["para_enviar_coleta", "envios_devolucoes"],
      upcoming: ["proximos_devolucoes"], // coleta_dia tem pickup_groups dinamicos
      in_transit: ["para_retirar", "a_caminho"],
      finalized: ["para_atender", "encerradas"],
      cancelled: [],
    };
    const targetDeposit: MLStoreKey =
      deposit === "all" ? "outros" : (deposit as MLStoreKey);
    for (const std of STANDARD_SECTIONS_BY_BUCKET[bucket] || []) {
      const key = `${std}::::${targetDeposit}`;
      if (!groups.has(key)) {
        groups.set(key, {
          section: std,
          pickupGroup: undefined,
          inferredDeposit: targetDeposit,
          counts: new Map(),
        });
      }
    }

    // Brief 2026-04-28: sub-linhas padrao por section. Sempre exibir
    // mesmo quando count=0 — ML Seller Center mostra "Encerradas" com
    // 6 linhas fixas (Entregues, Nao entregues, Canceladas, Devolucoes
    // concluidas/nao concluidas, Mensagens nao lidas) mesmo quando
    // alguns estao zerados.
    const STANDARD_SUBSTATUSES_BY_SECTION: Record<MLSection, MLSubStatus[]> = {
      para_enviar_coleta: ["cancelled_no_send"],
      envios_devolucoes: ["return_pending_review"],
      coleta_dia: ["invoice_pending", "ready_to_print", "standard_shipping"],
      proximos_devolucoes: [
        "return_pending_review",
        "return_in_transit",
        "return_in_ml_review",
      ],
      para_retirar: ["waiting_buyer_pickup"],
      a_caminho: ["shipped_collection"],
      para_atender: ["claim_or_mediation"],
      encerradas: [
        "delivered",
        "not_delivered",
        "cancelled_final",
        "returns_completed",
        "returns_not_completed",
        "with_unread_messages",
      ],
    };

    const result: SectionCard[] = [];
    for (const [key, g] of groups) {
      const substatuses: SubStatusEntry[] = [];
      let total = 0;
      for (const [substatus, count] of g.counts) {
        substatuses.push({ substatus, count });
        total += count;
      }
      // Garante sub-linhas padrao da secao (mesmo com count=0)
      const seenSubs = new Set(substatuses.map((s) => s.substatus));
      for (const std of STANDARD_SUBSTATUSES_BY_SECTION[g.section] || []) {
        if (!seenSubs.has(std)) {
          substatuses.push({ substatus: std, count: 0 });
        }
      }
      substatuses.sort(sortSubstatuses);

      const { subtitle, title } = getMLCardTitle({
        bucket,
        section: g.section,
        deposit: g.inferredDeposit,
        pickupDateLabel: g.pickupGroup,
      });

      result.push({
        key,
        section: g.section,
        subtitle,
        title,
        total,
        substatuses,
        pickupGroup: g.pickupGroup,
        inferredDeposit: g.inferredDeposit,
      });
    }

    result.sort(sortCards);
    return result;
  }, [orders, bucket, deposit, cardsByTab]);

  if (cards.length === 0) {
    return (
      <div className="rounded-[18px] border border-[#e4e4e4] bg-white px-5 py-6 text-center text-sm text-[#888]">
        Nenhum pedido neste bucket.
      </div>
    );
  }

  // Grid responsivo — 4 colunas em xl, colapsa em menos
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const isPickupGroupActive = selectedPickupGroup === card.pickupGroup;
        return (
          <div
            key={card.key}
            className="rounded-[18px] border border-[#e4e4e4] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.05)]"
          >
            <div className="flex items-start justify-between gap-3 border-b border-[#f0f0f0] pb-3">
              <div className="min-w-0">
                {card.subtitle && (
                  <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#888]">
                    {card.subtitle}
                  </div>
                )}
                <div className="mt-1 text-[15px] font-semibold leading-5 text-[#333]">
                  {card.title}
                </div>
              </div>
              <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-[#f1f1f1] px-2 py-0.5 text-[11px] font-semibold text-[#666]">
                {formatCount(card.total)}
              </span>
            </div>

            <div className="mt-3 space-y-1.5">
              {card.substatuses.map((entry) => {
                const label = SUBSTATUS_LABELS[entry.substatus] ?? entry.substatus;
                const tone = SUBSTATUS_TONES[entry.substatus];
                const isSelected =
                  selectedSubStatus === entry.substatus &&
                  (!card.pickupGroup || isPickupGroupActive);
                const hasHelp = SUBSTATUS_HAS_HELP[entry.substatus];
                const helpText = SUBSTATUS_HELP_TEXT[entry.substatus];

                return (
                  <button
                    key={entry.substatus}
                    type="button"
                    disabled={entry.count === 0}
                    onClick={() => {
                      // Toggle: clicar no sub-status ja selecionado limpa
                      if (isSelected) {
                        onSelectSubStatus(null);
                        onSelectPickupGroup(null);
                      } else {
                        onSelectSubStatus(entry.substatus);
                        onSelectPickupGroup(card.pickupGroup ?? null);
                      }
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
                      isSelected
                        ? tone === "danger"
                          ? "bg-red-50 ring-1 ring-inset ring-red-300"
                          : tone === "warning"
                            ? "bg-amber-50 ring-1 ring-inset ring-amber-300"
                            : tone === "success"
                              ? "bg-emerald-50 ring-1 ring-inset ring-emerald-300"
                              : "bg-blue-50 ring-1 ring-inset ring-blue-300"
                        : "hover:bg-[#f5f8ff]"
                    }`}
                    title={helpText}
                  >
                    <span className="flex items-center gap-1.5 text-[#555]">
                      {entry.substatus === "with_unread_messages" && (
                        <MessageSquare className="h-3.5 w-3.5 text-[#888]" />
                      )}
                      <span>{label}</span>
                      {hasHelp && (
                        <HelpCircle className="h-3 w-3 text-[#aaa]" />
                      )}
                    </span>
                    <span
                      className={`font-semibold ${
                        tone === "danger"
                          ? "text-red-600"
                          : tone === "warning"
                            ? "text-amber-700"
                            : tone === "success"
                              ? "text-emerald-700"
                              : "text-[#555]"
                      }`}
                    >
                      {formatCount(entry.count)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
