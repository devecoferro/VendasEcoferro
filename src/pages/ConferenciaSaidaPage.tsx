/**
 * ConferenciaSaidaPage — Visão do dia: caixas que saíram hoje.
 *
 * Leitura automática dos pedidos ML já sincronizados.
 * "Caixa" = 1 shipping_id único com status shipped.
 * Separação por empresa (Ecoferro / Fantom).
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Box,
  Building2,
  CheckCircle2,
  Loader2,
  Package,
  RefreshCw,
  Truck,
  TrendingUp,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getBoxReportToday,
  type TodayReport,
  type TodayBoxCompany,
} from "@/services/boxReportService";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

const SUBSTATUS_LABEL: Record<string, string> = {
  out_for_delivery: "Em rota de entrega",
  receiver_absent: "Destinatário ausente",
  not_visited: "Não visitado",
  at_customs: "Na alfândega",
  null: "Em trânsito",
};

// ─── Card de totais ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon,
  color = "#2968c8",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#888]">
          {label}
        </span>
        <span style={{ color }}>{icon}</span>
      </div>
      <p className="text-[28px] font-bold leading-none text-[#1a1a1a]">{value}</p>
      {sub && <p className="mt-1.5 text-[12px] text-[#888]">{sub}</p>}
    </div>
  );
}

// ─── Card de empresa ──────────────────────────────────────────────────────────

function CompanyCard({ company }: { company: TodayBoxCompany }) {
  const [expanded, setExpanded] = useState(true);

  const isEcoferro = company.seller_nickname.toLowerCase().includes("ecoferro");
  const accentColor = isEcoferro ? "#2968c8" : "#7c3aed";

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
      {/* Header da empresa */}
      <button
        className="flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-4 hover:bg-[#fafafa]"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-xl"
            style={{ backgroundColor: `${accentColor}15` }}
          >
            <Building2 className="h-4 w-4" style={{ color: accentColor }} />
          </div>
          <span className="text-[15px] font-bold text-[#1a1a1a]">
            {company.seller_nickname}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[13px]">
          <div className="flex items-center gap-1.5 text-[#666]">
            <Box className="h-4 w-4" />
            <span className="font-bold text-[#222]">{company.total_boxes}</span>
            <span>caixas</span>
          </div>
          <div className="flex items-center gap-1.5 text-[#666]">
            <Package className="h-4 w-4" />
            <span className="font-bold text-[#222]">{company.total_orders}</span>
            <span>pedidos</span>
          </div>
          <span className="font-bold text-[#22c55e]">
            {formatCurrency(company.total_amount)}
          </span>
        </div>
      </button>

      {/* Lista de caixas */}
      {expanded && (
        <div className="border-t border-[#ededed]">
          {company.boxes.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-[#aaa]">
              Nenhuma caixa despachada hoje.
            </p>
          ) : (
            <div className="divide-y divide-[#f0f0f0]">
              {company.boxes.map((box, idx) => (
                <div
                  key={box.shipping_id}
                  className="flex flex-wrap items-center gap-3 px-5 py-3 text-[13px]"
                >
                  {/* Número sequencial */}
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#f0f4ff] text-[11px] font-bold text-[#2968c8]">
                    {idx + 1}
                  </span>

                  {/* Shipping ID */}
                  <span className="font-mono text-[12px] text-[#444]">
                    #{box.shipping_id}
                  </span>

                  {/* Horário */}
                  <span className="text-[#888]">{formatTime(box.shipped_at)}</span>

                  {/* Pedidos */}
                  <span className="flex items-center gap-1 text-[#666]">
                    <Package className="h-3.5 w-3.5" />
                    {box.order_count} {box.order_count === 1 ? "pedido" : "pedidos"}
                  </span>

                  {/* Pack */}
                  {box.pack_id && (
                    <span className="rounded-full bg-[#f0f4ff] px-2 py-0.5 text-[11px] font-semibold text-[#2968c8]">
                      Pack
                    </span>
                  )}

                  {/* Substatus */}
                  {box.substatus && (
                    <span className="rounded-full bg-[#fef9c3] px-2 py-0.5 text-[11px] font-semibold text-[#854d0e]">
                      {SUBSTATUS_LABEL[box.substatus] || box.substatus}
                    </span>
                  )}

                  {/* Valor */}
                  <span className="ml-auto font-semibold text-[#22c55e]">
                    {formatCurrency(box.total_amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function ConferenciaSaidaPage() {
  const [data, setData] = useState<TodayReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getBoxReportToday();
      setData(result);
      setLastUpdate(new Date());
    } catch (err) {
      toast.error("Erro ao carregar caixas de hoje");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Auto-refresh a cada 2 minutos
    const interval = setInterval(() => void load(), 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [load]);

  const today = new Date();
  const todayLabel = today.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-[24px] font-bold text-[#1a1a1a] sm:text-[28px]">
              Conferência de Saída
            </h1>
            <p className="mt-1 text-[14px] capitalize text-[#666]">{todayLabel}</p>
            {lastUpdate && (
              <p className="mt-0.5 text-[12px] text-[#aaa]">
                Atualizado às{" "}
                {lastUpdate.toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            className="h-10 self-start text-[13px]"
            onClick={load}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Atualizar
          </Button>
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[#2968c8]" />
          </div>
        ) : !data ? null : (
          <>
            {/* Cards de totais do dia */}
            <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <StatCard
                label="Caixas saídas hoje"
                value={data.total_boxes}
                sub="envios únicos"
                icon={<Box className="h-5 w-5" />}
                color="#2968c8"
              />
              <StatCard
                label="Pedidos despachados"
                value={data.total_orders}
                icon={<Package className="h-5 w-5" />}
                color="#7c3aed"
              />
              <StatCard
                label="Faturamento do dia"
                value={formatCurrency(data.total_amount)}
                icon={<TrendingUp className="h-5 w-5" />}
                color="#22c55e"
              />
            </div>

            {/* Separação por empresa */}
            {data.by_company.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#e5e5e5] py-20 text-center">
                <Truck className="mb-3 h-10 w-10 text-[#ccc]" />
                <p className="text-[15px] font-semibold text-[#888]">
                  Nenhuma caixa despachada hoje
                </p>
                <p className="mt-1 text-[13px] text-[#aaa]">
                  As caixas aparecem aqui automaticamente quando o status do envio muda para
                  "Despachado" no Mercado Livre.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Resumo consolidado quando há 2+ empresas */}
                {data.by_company.length > 1 && (
                  <div className="rounded-2xl border border-[#e5e5e5] bg-[#f8faff] p-4">
                    <div className="mb-2 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-[#2968c8]" />
                      <span className="text-[13px] font-semibold text-[#444]">
                        Consolidado — todas as empresas
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-6 text-[13px]">
                      {data.by_company.map((c) => (
                        <div key={c.connection_id} className="flex items-center gap-2">
                          <span className="font-semibold text-[#222]">
                            {c.seller_nickname}:
                          </span>
                          <span className="text-[#666]">
                            {c.total_boxes} caixas · {c.total_orders} pedidos ·{" "}
                            <span className="font-semibold text-[#22c55e]">
                              {formatCurrency(c.total_amount)}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cards por empresa */}
                {data.by_company.map((company) => (
                  <CompanyCard key={company.connection_id} company={company} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
