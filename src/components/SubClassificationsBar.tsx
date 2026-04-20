/**
 * SubClassificationsBar — Renderiza os cards estilo ML Seller Center
 * mostrando as sub-secoes e sub-status do bucket atual.
 *
 * Cada linha clicavel filtra a lista de pedidos abaixo (controlada pelo
 * estado `selectedSubStatus` no MercadoLivrePage). Click numa linha
 * ativa filtro, click de novo desativa.
 *
 * Para o bucket "upcoming" (Proximos dias), agrupa adicionalmente por
 * data de coleta — gera 1 card "Coleta | <dia>" por grupo de pickup_date.
 *
 * Estilo: amarelo ML / arredondado (B2 escolhido pelo operador).
 */
import { useMemo } from "react";
import type { MLOrder } from "@/services/mercadoLivreService";
import type { ShipmentBucket } from "@/services/mercadoLivreHelpers";
import {
  type MLSubStatus,
  type MLSection,
  getOrderSubstatus,
  getOrderSection,
  getOrderPickupDateLabel,
  SUBSTATUS_LABELS,
  SECTION_LABELS,
  SUBSTATUS_TONES,
} from "@/services/mlSubStatusClassifier";

interface SubClassificationsBarProps {
  orders: MLOrder[];
  bucket: ShipmentBucket;
  selectedSubStatus: MLSubStatus | null;
  onSelectSubStatus: (substatus: MLSubStatus | null) => void;
  selectedPickupGroup: string | null;
  onSelectPickupGroup: (group: string | null) => void;
}

interface SubStatusEntry {
  substatus: MLSubStatus;
  count: number;
}

interface SectionCard {
  key: string;                  // pickupGroup (pra coleta_dia) ou MLSection
  section: MLSection;
  title: string;                // label exibido
  total: number;
  substatuses: SubStatusEntry[];
  pickupGroup?: string;         // se vier de agrupamento por data
}

const TONE_CLASSES: Record<string, { dot: string; count: string }> = {
  warning: {
    dot: "bg-[#ff6d1b]",
    count: "text-[#ff6d1b]",
  },
  danger: {
    dot: "bg-[#dc2626]",
    count: "text-[#dc2626]",
  },
  info: {
    dot: "bg-[#3483fa]",
    count: "text-[#3483fa]",
  },
  success: {
    dot: "bg-[#22c55e]",
    count: "text-[#16a34a]",
  },
  neutral: {
    dot: "bg-[#9ca3af]",
    count: "text-[#6b7280]",
  },
};

export function SubClassificationsBar({
  orders,
  bucket,
  selectedSubStatus,
  onSelectSubStatus,
  selectedPickupGroup,
  onSelectPickupGroup,
}: SubClassificationsBarProps) {
  const cards = useMemo<SectionCard[]>(() => {
    if (orders.length === 0) return [];

    // Agrupa orders por (section, pickupGroup, substatus)
    type Key = string;
    const groupMap = new Map<
      Key,
      {
        section: MLSection;
        pickupGroup: string | null;
        substatusCounts: Map<MLSubStatus, number>;
      }
    >();

    for (const order of orders) {
      const section = getOrderSection(order, bucket);
      if (!section) continue;
      const substatus = getOrderSubstatus(order, bucket);
      if (!substatus) continue;

      // Pra "coleta_dia", agrupa adicionalmente por pickup date
      const pickupGroup =
        section === "coleta_dia" ? getOrderPickupDateLabel(order) : null;

      const key = `${section}|${pickupGroup ?? ""}`;
      let entry = groupMap.get(key);
      if (!entry) {
        entry = {
          section,
          pickupGroup,
          substatusCounts: new Map(),
        };
        groupMap.set(key, entry);
      }
      entry.substatusCounts.set(
        substatus,
        (entry.substatusCounts.get(substatus) || 0) + 1
      );
    }

    // Converte em array de cards
    const result: SectionCard[] = [];
    for (const [key, entry] of groupMap) {
      const substatuses: SubStatusEntry[] = [];
      let total = 0;
      for (const [substatus, count] of entry.substatusCounts) {
        substatuses.push({ substatus, count });
        total += count;
      }
      // Ordena sub-status: prioriza "warning"/"danger" (acoes pendentes)
      substatuses.sort((a, b) => {
        const ta = SUBSTATUS_TONES[a.substatus];
        const tb = SUBSTATUS_TONES[b.substatus];
        const priority: Record<string, number> = {
          warning: 1,
          danger: 2,
          info: 3,
          success: 4,
          neutral: 5,
        };
        const diff = (priority[ta] ?? 9) - (priority[tb] ?? 9);
        if (diff !== 0) return diff;
        return SUBSTATUS_LABELS[a.substatus].localeCompare(
          SUBSTATUS_LABELS[b.substatus]
        );
      });

      const baseTitle = SECTION_LABELS[entry.section];
      const title = entry.pickupGroup
        ? `${baseTitle} | ${entry.pickupGroup}`
        : baseTitle;

      result.push({
        key,
        section: entry.section,
        title,
        total,
        substatuses,
        pickupGroup: entry.pickupGroup ?? undefined,
      });
    }

    // Ordena cards: cards com "warning"/"danger" primeiro, depois alfabetico.
    // Pra "coleta_dia", ordena por proximidade da data (Hoje > Amanha > ...)
    const dateScore = (label: string) => {
      if (label === "Hoje") return 0;
      if (label === "Amanhã") return 1;
      if (label === "Sem data definida") return 99;
      // Dias da semana: tenta achar
      const weekdayIdx = [
        "Segunda-feira",
        "Terça-feira",
        "Quarta-feira",
        "Quinta-feira",
        "Sexta-feira",
        "Sábado",
        "Domingo",
      ].indexOf(label);
      if (weekdayIdx >= 0) return 2 + weekdayIdx;
      // "A partir de ..."
      return 50;
    };

    result.sort((a, b) => {
      // Prioriza nao-devolucoes
      const aDev = a.section.includes("devolucoes");
      const bDev = b.section.includes("devolucoes");
      if (aDev !== bDev) return aDev ? 1 : -1;

      // Pra coleta_dia, ordena por data
      if (a.pickupGroup && b.pickupGroup) {
        return dateScore(a.pickupGroup) - dateScore(b.pickupGroup);
      }

      return a.title.localeCompare(b.title);
    });

    return result;
  }, [orders, bucket]);

  if (cards.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.key}
          className="rounded-2xl border border-[#e6e6e6] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="truncate text-[14px] font-bold uppercase tracking-wide text-[#333]">
              {card.title}
            </h3>
            <span className="inline-flex h-6 min-w-[26px] shrink-0 items-center justify-center rounded-full bg-[#f1f1f4] px-2 text-[11px] font-bold text-[#555]">
              {card.total}
            </span>
          </div>
          <div className="mt-3 space-y-1.5">
            {card.substatuses.map((s) => {
              const tone = SUBSTATUS_TONES[s.substatus] || "neutral";
              const toneCls = TONE_CLASSES[tone] || TONE_CLASSES.neutral;
              const isActive =
                selectedSubStatus === s.substatus &&
                (card.pickupGroup
                  ? selectedPickupGroup === card.pickupGroup
                  : selectedPickupGroup === null);

              return (
                <button
                  key={s.substatus}
                  type="button"
                  onClick={() => {
                    if (isActive) {
                      onSelectSubStatus(null);
                      onSelectPickupGroup(null);
                    } else {
                      onSelectSubStatus(s.substatus);
                      onSelectPickupGroup(card.pickupGroup ?? null);
                    }
                  }}
                  className={`group flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] transition ${
                    isActive
                      ? "bg-[#fff9e6] text-[#333] ring-1 ring-[#fff159]"
                      : "hover:bg-[#fafafa]"
                  }`}
                  title={`Filtrar lista por: ${SUBSTATUS_LABELS[s.substatus]}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 shrink-0 rounded-full ${toneCls.dot}`}
                    />
                    <span className="truncate text-[#333]">
                      {SUBSTATUS_LABELS[s.substatus]}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 text-[12px] font-semibold ${toneCls.count}`}
                  >
                    {s.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
