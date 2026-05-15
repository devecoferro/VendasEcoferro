/**
 * Relatório de Caixas — visão consolidada de despachos por empresa e período.
 * Exibe totais gerais, separação por empresa (Ecoferro / Fantom) e lista detalhada.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BarChart3,
  Box,
  Building2,
  Calendar,
  CheckCircle2,
  Download,
  Loader2,
  Package,
  RefreshCw,
  Truck,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { listMLConnections, type MLConnection } from "@/services/mercadoLivreService";
import { getBoxReport, type BoxReportCompany, type ShippingBox } from "@/services/boxesService";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function thirtyDaysAgoIso() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

const STATUS_LABEL: Record<string, string> = {
  open: "Aberta",
  confirmed: "Conferida",
  dispatched: "Despachada",
};

const STATUS_COLOR: Record<string, string> = {
  open: "bg-[#fff4ec] text-[#c2410c] border-[#ffa07a]",
  confirmed: "bg-[#eff6ff] text-[#1d4ed8] border-[#60a5fa]",
  dispatched: "bg-[#f0fdf4] text-[#15803d] border-[#22c55e]",
};

// ─── Card de empresa ─────────────────────────────────────────────────────────

interface CompanyCardProps {
  company: BoxReportCompany;
}

function CompanyCard({ company }: CompanyCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 hover:bg-[#fafafa]"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3">
          <Building2 className="h-5 w-5 text-[#2968c8]" />
          <span className="text-[16px] font-bold text-[#1a1a1a]">
            {company.seller_nickname}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[13px]">
          <div className="flex items-center gap-1.5 text-[#666]">
            <Box className="h-4 w-4" />
            <span className="font-semibold text-[#222]">{company.total_boxes}</span> caixas
          </div>
          <div className="flex items-center gap-1.5 text-[#666]">
            <Package className="h-4 w-4" />
            <span className="font-semibold text-[#222]">{company.total_orders}</span> pedidos
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[15px] font-bold text-[#22c55e]">
              {formatCurrency(company.total_amount)}
            </span>
          </div>
          <div className="flex gap-1.5">
            {company.by_status.open > 0 && (
              <span className="rounded-full border border-[#ffa07a] bg-[#fff4ec] px-2 py-0.5 text-[11px] font-semibold text-[#c2410c]">
                {company.by_status.open} abertas
              </span>
            )}
            {company.by_status.confirmed > 0 && (
              <span className="rounded-full border border-[#60a5fa] bg-[#eff6ff] px-2 py-0.5 text-[11px] font-semibold text-[#1d4ed8]">
                {company.by_status.confirmed} conferidas
              </span>
            )}
            {company.by_status.dispatched > 0 && (
              <span className="rounded-full border border-[#22c55e] bg-[#f0fdf4] px-2 py-0.5 text-[11px] font-semibold text-[#15803d]">
                {company.by_status.dispatched} despachadas
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tabela de caixas */}
      {expanded && (
        <div className="border-t border-[#ededed] px-5 py-4">
          {company.boxes.length === 0 ? (
            <p className="text-[13px] text-[#aaa]">Nenhuma caixa neste período.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#ededed] bg-[#fafafa]">
                    <th className="px-3 py-2 text-left font-semibold text-[#666]">Caixa</th>
                    <th className="px-3 py-2 text-left font-semibold text-[#666]">Status</th>
                    <th className="px-3 py-2 text-center font-semibold text-[#666]">Pedidos</th>
                    <th className="px-3 py-2 text-right font-semibold text-[#666]">Total</th>
                    <th className="px-3 py-2 text-left font-semibold text-[#666]">Rastreio</th>
                    <th className="px-3 py-2 text-left font-semibold text-[#666]">Criada em</th>
                    <th className="px-3 py-2 text-left font-semibold text-[#666]">Despachada em</th>
                  </tr>
                </thead>
                <tbody>
                  {company.boxes.map((box) => (
                    <tr key={box.id} className="border-b border-[#f0f0f0] last:border-0">
                      <td className="px-3 py-2 font-bold text-[#222]">{box.box_number}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={cn("text-[11px] font-semibold", STATUS_COLOR[box.status])}
                        >
                          {STATUS_LABEL[box.status]}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-center font-semibold text-[#444]">
                        {box.order_count}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-[#22c55e]">
                        {formatCurrency(box.total_amount)}
                      </td>
                      <td className="px-3 py-2 font-mono text-[12px] text-[#666]">
                        {box.tracking_code || "—"}
                      </td>
                      <td className="px-3 py-2 text-[#666]">{formatDate(box.created_at)}</td>
                      <td className="px-3 py-2 text-[#666]">{formatDate(box.dispatched_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Card de totais ───────────────────────────────────────────────────────────

interface TotalsCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color?: string;
}

function TotalsCard({ label, value, sub, icon, color = "#2968c8" }: TotalsCardProps) {
  return (
    <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#888]">
          {label}
        </span>
        <span style={{ color }}>{icon}</span>
      </div>
      <p className="text-[26px] font-bold leading-none text-[#1a1a1a]">{value}</p>
      {sub && <p className="mt-1.5 text-[12px] text-[#888]">{sub}</p>}
    </div>
  );
}

// ─── Página principal ────────────────────────────────────────────────────────

export default function RelatorioCaixasPage() {
  const [connections, setConnections] = useState<MLConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgoIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [report, setReport] = useState<{
    totals: { total_boxes: number; total_orders: number; total_amount: number; by_status: Record<string, number> };
    by_company: BoxReportCompany[];
    boxes: ShippingBox[];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const loadConnections = useCallback(async () => {
    try {
      const conns = await listMLConnections();
      setConnections(conns);
    } catch {
      toast.error("Erro ao carregar conexões ML");
    }
  }, []);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        date_from: dateFrom,
        date_to: dateTo,
      };
      if (selectedConnectionId !== "all") params.connection_id = selectedConnectionId;
      const result = await getBoxReport(params);
      setReport(result);
    } catch {
      toast.error("Erro ao carregar relatório");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedConnectionId]);

  useEffect(() => { loadConnections(); }, [loadConnections]);
  useEffect(() => { loadReport(); }, [loadReport]);

  // Exportar CSV
  const handleExportCsv = () => {
    if (!report) return;
    const rows = [
      ["Empresa", "Caixa", "Status", "Pedidos", "Total (R$)", "Rastreio", "Transportadora", "Criada em", "Despachada em"],
      ...report.boxes.map((b) => [
        b.seller_nickname,
        b.box_number,
        STATUS_LABEL[b.status] || b.status,
        String(b.order_count),
        b.total_amount.toFixed(2).replace(".", ","),
        b.tracking_code || "",
        b.carrier || "",
        b.created_at ? new Date(b.created_at).toLocaleString("pt-BR") : "",
        b.dispatched_at ? new Date(b.dispatched_at).toLocaleString("pt-BR") : "",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-caixas-${dateFrom}-a-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[24px] font-bold text-[#1a1a1a] sm:text-[28px]">
              Relatório de Caixas
            </h1>
            <p className="mt-1 text-[14px] text-[#666]">
              Resumo de saídas por empresa com totais e separação por status.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-10 text-[13px]"
              onClick={loadReport}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Atualizar
            </Button>
            <Button
              variant="outline"
              className="h-10 text-[13px]"
              onClick={handleExportCsv}
              disabled={!report || report.boxes.length === 0}
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar CSV
            </Button>
          </div>
        </div>

        {/* Filtros */}
        <div className="mb-6 flex flex-wrap items-end gap-4 rounded-2xl border border-[#e5e5e5] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
          <div>
            <Label className="mb-1.5 text-[12px] font-semibold text-[#666]">Empresa</Label>
            <Select value={selectedConnectionId} onValueChange={setSelectedConnectionId}>
              <SelectTrigger className="h-9 w-[180px] text-[13px]">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as empresas</SelectItem>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.seller_nickname || c.seller_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="mb-1.5 text-[12px] font-semibold text-[#666]">Data início</Label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#888]" />
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 pl-8 text-[13px]"
              />
            </div>
          </div>
          <div>
            <Label className="mb-1.5 text-[12px] font-semibold text-[#666]">Data fim</Label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#888]" />
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 pl-8 text-[13px]"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-[#2968c8]" />
          </div>
        ) : !report ? null : (
          <>
            {/* Cards de totais */}
            <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <TotalsCard
                label="Total de caixas"
                value={report.totals.total_boxes}
                sub={`${report.totals.by_status.dispatched || 0} despachadas`}
                icon={<Box className="h-5 w-5" />}
                color="#2968c8"
              />
              <TotalsCard
                label="Total de pedidos"
                value={report.totals.total_orders}
                icon={<Package className="h-5 w-5" />}
                color="#7c3aed"
              />
              <TotalsCard
                label="Faturamento total"
                value={formatCurrency(report.totals.total_amount)}
                icon={<BarChart3 className="h-5 w-5" />}
                color="#22c55e"
              />
              <TotalsCard
                label="Despachadas"
                value={report.totals.by_status.dispatched || 0}
                sub={`${report.totals.by_status.open || 0} abertas · ${report.totals.by_status.confirmed || 0} conferidas`}
                icon={<Truck className="h-5 w-5" />}
                color="#f59e0b"
              />
            </div>

            {/* Por empresa */}
            {report.by_company.length > 0 && (
              <div className="mb-6">
                <h2 className="mb-3 text-[15px] font-bold text-[#444]">Por empresa</h2>
                <div className="flex flex-col gap-3">
                  {report.by_company.map((company) => (
                    <CompanyCard key={company.connection_id} company={company} />
                  ))}
                </div>
              </div>
            )}

            {/* Sem dados */}
            {report.boxes.length === 0 && (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#e5e5e5] py-16 text-center">
                <Box className="mb-3 h-10 w-10 text-[#ccc]" />
                <p className="text-[15px] font-semibold text-[#888]">
                  Nenhuma caixa no período selecionado
                </p>
                <p className="mt-1 text-[13px] text-[#aaa]">
                  Ajuste o filtro de datas ou crie caixas na tela de Conferência de Saída.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
