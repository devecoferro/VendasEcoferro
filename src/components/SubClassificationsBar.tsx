/**
 * SubClassificationsBar — Cards no estilo EXATO do ML Seller Center.
 *
 * Layout 1:1 com o ML:
 *   - Card branco bordado, padding generoso
 *   - Header: titulo grande + pill cinza com contagem
 *   - "PARA ENVIAR" tem subtitulo (PARA ENVIAR / Coleta) — outros cards
 *     usam so titulo simples
 *   - Lista de sub-status: texto cinza + contagem direita
 *   - Pill vermelha rosa pros sub-status criticos (Canceladas, Reclamacao)
 *   - Hover sutil pra indicar clicavel
 *
 * Para o bucket "upcoming" (Proximos dias), agrupa adicionalmente por
 * data de coleta — gera 1 card "Coleta | <dia>" por grupo de pickup_date.
 */
import { useMemo } from "react";
import { HelpCircle, MessageSquare } from "lucide-react";
import type { MLOrder } from "@/services/mercadoLivreService";
import type { ShipmentBucket } from "@/services/mercadoLivreHelpers";
import {
  type MLSubStatus,
  type MLSection,
  getOrderSubstatus,
  getOrderSection,
  getOrderPickupDateLabel,
  SUBSTATUS_LABELS,
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
  key: string;
  section: MLSection;
  subtitle?: string;       // ex: "PARA ENVIAR" no card de Coleta (today)
  title: string;           // ex: "Coleta", "Devoluções", "Coleta | Quarta-feira"
  hasHelpIcon?: boolean;   // ⓘ (HelpCircle) no header igual o ML
  total: number;
  substatuses: SubStatusEntry[];
  pickupGroup?: string;
}

/**
 * Mapping section → display config (subtitle, hasHelpIcon, etc).
 * Replica visual do ML: PARA ENVIAR tem subtitle "PARA ENVIAR" + titulo
 * "Coleta", outros cards usam so o nome direto.
 */
function getSectionDisplay(section: MLSection): {
  subtitle?: string;
  title: string;
  hasHelpIcon: boolean;
} {
  switch (section) {
    case "para_enviar_coleta":
      return { subtitle: "PARA ENVIAR", title: "Coleta", hasHelpIcon: true };
    case "envios_devolucoes":
    case "proximos_devolucoes":
      return { title: "Devoluções", hasHelpIcon: false };
    case "coleta_dia":
      return { title: "Coleta", hasHelpIcon: false }; // sufixado | <dia> depois
    case "para_retirar":
      return { title: "Para retirar", hasHelpIcon: false };
    case "a_caminho":
      return { title: "A caminho", hasHelpIcon: false };
    case "para_atender":
      return { title: "Para atender", hasHelpIcon: false };
    case "encerradas":
      return { title: "Encerradas", hasHelpIcon: false };
    default:
      return { title: section, hasHelpIcon: false };
  }
}

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

    const result: SectionCard[] = [];
    for (const [key, entry] of groupMap) {
      const substatuses: SubStatusEntry[] = [];
      let total = 0;
      for (const [substatus, count] of entry.substatusCounts) {
        substatuses.push({ substatus, count });
        total += count;
      }
      // Ordena: warning/danger primeiro, depois alfabetico
      substatuses.sort((a, b) => {
        const ta = SUBSTATUS_TONES[a.substatus];
        const tb = SUBSTATUS_TONES[b.substatus];
        const priority: Record<string, number> = {
          danger: 1,
          warning: 2,
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

      const display = getSectionDisplay(entry.section);
      const title = entry.pickupGroup
        ? `${display.title} | ${entry.pickupGroup}`
        : display.title;

      result.push({
        key,
        section: entry.section,
        subtitle: display.subtitle,
        title,
        hasHelpIcon: display.hasHelpIcon,
        total,
        substatuses,
        pickupGroup: entry.pickupGroup ?? undefined,
      });
    }

    // Ordena cards: nao-devolucoes primeiro, depois por proximidade da data
    const dateScore = (label: string) => {
      if (label === "Hoje") return 0;
      if (label === "Amanhã") return 1;
      if (label === "Sem data definida") return 99;
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
      return 50;
    };

    result.sort((a, b) => {
      const aDev = a.section.includes("devolucoes");
      const bDev = b.section.includes("devolucoes");
      if (aDev !== bDev) return aDev ? 1 : -1;

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
          className="rounded-2xl border border-[#e5e5e5] bg-white px-5 py-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {card.subtitle && (
                <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[#999]">
                  {card.subtitle}
                  {card.hasHelpIcon && (
                    <HelpCircle className="h-3 w-3 text-[#3483fa]" />
                  )}
                </p>
              )}
              <h3 className="truncate text-[16px] font-bold text-[#333]">
                {card.title}
              </h3>
            </div>
            <span className="inline-flex h-6 min-w-[26px] shrink-0 items-center justify-center rounded-full bg-[#f1f1f4] px-2 text-[11px] font-semibold text-[#666]">
              {card.total}
            </span>
          </div>

          {/* Lista de sub-status */}
          <div className="mt-3 -mx-2">
            {card.substatuses.map((s) => {
              const tone = SUBSTATUS_TONES[s.substatus] || "neutral";
              const isActive =
                selectedSubStatus === s.substatus &&
                (card.pickupGroup
                  ? selectedPickupGroup === card.pickupGroup
                  : selectedPickupGroup === null);
              const isDanger = tone === "danger";
              const isMessages = s.substatus === ("with_unread_messages" as MLSubStatus);

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
                  className={`group flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition ${
                    isActive
                      ? "bg-[#fff9e6] ring-1 ring-[#fff159]"
                      : "hover:bg-[#fafafa]"
                  }`}
                  title={`Filtrar por: ${SUBSTATUS_LABELS[s.substatus]}`}
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-[#666]">
                    <span className="truncate">
                      {SUBSTATUS_LABELS[s.substatus]}
                    </span>
                    {isMessages && (
                      <MessageSquare className="h-3.5 w-3.5 text-[#3483fa]" />
                    )}
                  </span>
                  {isDanger ? (
                    <span className="inline-flex h-5 min-w-[22px] shrink-0 items-center justify-center rounded-full bg-[#fde7eb] px-1.5 text-[11px] font-semibold text-[#d63030]">
                      {s.count}
                    </span>
                  ) : (
                    <span className="shrink-0 text-[12px] font-medium text-[#666]">
                      {s.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
