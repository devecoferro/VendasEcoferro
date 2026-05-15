/**
 * RelatorioCaixasPage — Relatório histórico de caixas despachadas.
 *
 * - Dados carregados SOMENTE após clicar em "Gerar Relatório"
 * - Impressão A4: separado por empresa ou total consolidado
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  Box,
  Building2,
  Calendar,
  Download,
  Loader2,
  Package,
  Printer,
  RefreshCw,
  TrendingUp,
  Truck,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
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
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { listMLConnections, type MLConnection } from "@/services/mercadoLivreService";
import {
  getBoxReportSummary,
  getBoxReportDaily,
  getBoxReportList,
  type BoxReportSummary,
  type DailyReport,
  type BoxListReport,
} from "@/services/boxReportService";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDateTime(iso: string | null | undefined) {
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

function formatDayLabel(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}

function formatDateBr(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// ─── Chart config ─────────────────────────────────────────────────────────────

const chartConfig: ChartConfig = {
  total_boxes: { label: "Caixas", color: "#2968c8" },
};

// ─── Card de stat ─────────────────────────────────────────────────────────────

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
      <p className="text-[26px] font-bold leading-none text-[#1a1a1a]">{value}</p>
      {sub && <p className="mt-1.5 text-[12px] text-[#888]">{sub}</p>}
    </div>
  );
}

// ─── Card de empresa ──────────────────────────────────────────────────────────

function CompanyCard({
  nickname,
  totalBoxes,
  totalOrders,
  totalAmount,
  pct,
}: {
  nickname: string;
  totalBoxes: number;
  totalOrders: number;
  totalAmount: number;
  pct: number;
}) {
  const isEcoferro = nickname.toLowerCase().includes("ecoferro");
  const color = isEcoferro ? "#2968c8" : "#7c3aed";

  return (
    <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
      <div className="mb-4 flex items-center gap-3">
        <div
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${color}15` }}
        >
          <Building2 className="h-4 w-4" style={{ color }} />
        </div>
        <span className="text-[15px] font-bold text-[#1a1a1a]">{nickname}</span>
        <span
          className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-bold"
          style={{ backgroundColor: `${color}15`, color }}
        >
          {pct.toFixed(0)}%
        </span>
      </div>
      <div className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-[#f0f0f0]">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-[20px] font-bold text-[#1a1a1a]">{totalBoxes}</p>
          <p className="text-[11px] text-[#888]">caixas</p>
        </div>
        <div>
          <p className="text-[20px] font-bold text-[#1a1a1a]">{totalOrders}</p>
          <p className="text-[11px] text-[#888]">pedidos</p>
        </div>
        <div>
          <p className="text-[15px] font-bold text-[#22c55e]">
            {formatCurrency(totalAmount)}
          </p>
          <p className="text-[11px] text-[#888]">faturado</p>
        </div>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function RelatorioCaixasPage() {
  const [connections, setConnections] = useState<MLConnection[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgoIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [printMode, setPrintMode] = useState<"all" | "by_company">("all");

  const [summary, setSummary] = useState<BoxReportSummary | null>(null);
  const [daily, setDaily] = useState<DailyReport | null>(null);
  const [list, setList] = useState<BoxListReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasGenerated, setHasGenerated] = useState(false);

  // Parâmetros usados na última geração (para exibir no cabeçalho de impressão)
  const lastParamsRef = useRef({ dateFrom, dateTo, selectedConnectionId });

  const loadConnections = useCallback(async () => {
    if (connectionsLoaded) return;
    try {
      const conns = await listMLConnections();
      setConnections(conns);
      setConnectionsLoaded(true);
    } catch {
      toast.error("Erro ao carregar conexões ML");
    }
  }, [connectionsLoaded]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        date_from: dateFrom,
        date_to: dateTo,
        connection_id: selectedConnectionId !== "all" ? selectedConnectionId : undefined,
      };
      lastParamsRef.current = { dateFrom, dateTo, selectedConnectionId };
      const [s, d, l] = await Promise.all([
        getBoxReportSummary(params),
        getBoxReportDaily(params),
        getBoxReportList({ ...params, limit: "500" }),
      ]);
      setSummary(s);
      setDaily(d);
      setList(l);
      setHasGenerated(true);
    } catch (err) {
      toast.error("Erro ao carregar relatório");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, selectedConnectionId]);

  // Carregar conexões ao abrir o select
  const handleSelectOpen = () => {
    void loadConnections();
  };

  // Dados para o gráfico
  const chartData = useMemo(() => {
    if (!daily) return [];
    return daily.series.map((d) => ({
      day: formatDayLabel(d.date),
      total_boxes: d.total_boxes,
    }));
  }, [daily]);

  // Exportar CSV
  const handleExportCsv = () => {
    if (!list) return;
    const rows = [
      ["Empresa", "Shipping ID", "Data/Hora Despacho", "Pedidos", "Total (R$)", "Pack ID", "Substatus"],
      ...list.items.map((i) => [
        i.seller_nickname,
        i.shipping_id,
        i.shipped_at ? new Date(i.shipped_at).toLocaleString("pt-BR") : "",
        String(i.order_count),
        i.total_amount.toFixed(2).replace(".", ","),
        i.pack_id ? String(i.pack_id) : "",
        i.substatus || "",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(";")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `caixas-despachadas-${dateFrom}-a-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Impressão A4
  const handlePrint = () => {
    if (!summary || !list) return;
    const p = lastParamsRef.current;
    const periodoLabel = `${formatDateBr(p.dateFrom)} a ${formatDateBr(p.dateTo)}`;

    // Agrupar itens por empresa para impressão separada
    const byCompany: Record<string, typeof list.items> = {};
    for (const item of list.items) {
      if (!byCompany[item.seller_nickname]) byCompany[item.seller_nickname] = [];
      byCompany[item.seller_nickname].push(item);
    }

    const buildTable = (items: typeof list.items) => `
      <table>
        <thead>
          <tr>
            <th>Empresa</th>
            <th>Shipping ID</th>
            <th>Despachado em</th>
            <th>Pedidos</th>
            <th>Total</th>
            <th>Obs.</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((i) => `
            <tr>
              <td>${i.seller_nickname}</td>
              <td class="mono">#${i.shipping_id}</td>
              <td>${i.shipped_at ? new Date(i.shipped_at).toLocaleString("pt-BR") : "—"}</td>
              <td class="center">${i.order_count}</td>
              <td class="right green">${formatCurrency(i.total_amount)}</td>
              <td>${i.pack_id ? "Pack" : ""}${i.substatus ? ` ${i.substatus}` : ""}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    const buildSummaryBlock = (
      label: string,
      boxes: number,
      orders: number,
      amount: number
    ) => `
      <div class="summary-block">
        <div class="summary-item"><span class="summary-label">Total de caixas</span><span class="summary-value">${boxes}</span></div>
        <div class="summary-item"><span class="summary-label">Total de pedidos</span><span class="summary-value">${orders}</span></div>
        <div class="summary-item"><span class="summary-label">Faturamento</span><span class="summary-value green">${formatCurrency(amount)}</span></div>
      </div>
    `;

    let body = "";

    if (printMode === "by_company") {
      for (const [empresa, items] of Object.entries(byCompany)) {
        const total_boxes = items.length;
        const total_orders = items.reduce((s, i) => s + i.order_count, 0);
        const total_amount = items.reduce((s, i) => s + i.total_amount, 0);
        body += `
          <div class="section">
            <h2>${empresa}</h2>
            ${buildSummaryBlock(empresa, total_boxes, total_orders, total_amount)}
            ${buildTable(items)}
          </div>
          <div class="page-break"></div>
        `;
      }
    } else {
      body = `
        <div class="section">
          ${buildSummaryBlock(
            "Total",
            summary.totals.total_boxes,
            summary.totals.total_orders,
            summary.totals.total_amount
          )}
          ${summary.by_company.length > 1 ? `
            <div class="company-summary">
              ${summary.by_company.map((c) => `
                <div class="company-row">
                  <span class="company-name">${c.seller_nickname}</span>
                  <span>${c.total_boxes} caixas</span>
                  <span>${c.total_orders} pedidos</span>
                  <span class="green">${formatCurrency(c.total_amount)}</span>
                </div>
              `).join("")}
            </div>
          ` : ""}
          ${buildTable(list.items)}
        </div>
      `;
    }

    const html = `
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <title>Relatório de Caixas — ${periodoLabel}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: Arial, sans-serif; font-size: 11px; color: #222; padding: 20px; }
          h1 { font-size: 18px; font-weight: bold; margin-bottom: 2px; }
          .subtitle { font-size: 11px; color: #666; margin-bottom: 16px; }
          h2 { font-size: 14px; font-weight: bold; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 2px solid #2968c8; color: #2968c8; }
          .summary-block { display: flex; gap: 24px; margin-bottom: 12px; padding: 10px 14px; background: #f8f9ff; border-radius: 6px; border: 1px solid #e0e8ff; }
          .summary-item { display: flex; flex-direction: column; }
          .summary-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.05em; }
          .summary-value { font-size: 18px; font-weight: bold; color: #1a1a1a; }
          .summary-value.green { color: #16a34a; }
          .company-summary { margin-bottom: 12px; }
          .company-row { display: flex; gap: 16px; padding: 4px 0; border-bottom: 1px solid #f0f0f0; font-size: 11px; }
          .company-name { font-weight: bold; flex: 1; }
          table { width: 100%; border-collapse: collapse; margin-top: 4px; }
          th { background: #f0f4ff; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #555; padding: 6px 8px; text-align: left; border-bottom: 1px solid #dde6ff; }
          td { padding: 5px 8px; border-bottom: 1px solid #f0f0f0; font-size: 11px; vertical-align: middle; }
          tr:last-child td { border-bottom: none; }
          .mono { font-family: monospace; font-size: 10px; }
          .center { text-align: center; }
          .right { text-align: right; }
          .green { color: #16a34a; font-weight: 600; }
          .section { margin-bottom: 20px; }
          .page-break { page-break-after: always; }
          @media print {
            body { padding: 10px; }
            .page-break { page-break-after: always; }
          }
        </style>
      </head>
      <body>
        <h1>Relatório de Caixas Despachadas</h1>
        <p class="subtitle">Período: ${periodoLabel} · Gerado em: ${new Date().toLocaleString("pt-BR")}</p>
        ${body}
      </body>
      </html>
    `;

    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) { toast.error("Popup bloqueado. Permita popups para imprimir."); return; }
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
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
              Histórico de caixas despachadas por empresa e período.
            </p>
          </div>
          {hasGenerated && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="h-10 text-[13px]"
                onClick={loadData}
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
                disabled={!list || list.items.length === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                CSV
              </Button>
            </div>
          )}
        </div>

        {/* Filtros + Botão Gerar */}
        <div className="mb-6 rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
          <div className="flex flex-wrap items-end gap-4">
            {/* Empresa */}
            <div>
              <Label className="mb-1.5 block text-[12px] font-semibold text-[#666]">
                Empresa
              </Label>
              <Select
                value={selectedConnectionId}
                onValueChange={setSelectedConnectionId}
                onOpenChange={(open) => { if (open) handleSelectOpen(); }}
              >
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

            {/* Data de */}
            <div>
              <Label className="mb-1.5 block text-[12px] font-semibold text-[#666]">
                De
              </Label>
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

            {/* Data até */}
            <div>
              <Label className="mb-1.5 block text-[12px] font-semibold text-[#666]">
                Até
              </Label>
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

            {/* Modo de impressão */}
            <div>
              <Label className="mb-1.5 block text-[12px] font-semibold text-[#666]">
                Impressão
              </Label>
              <Select value={printMode} onValueChange={(v) => setPrintMode(v as "all" | "by_company")}>
                <SelectTrigger className="h-9 w-[180px] text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Total consolidado</SelectItem>
                  <SelectItem value="by_company">Separado por empresa</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Botão Gerar */}
            <Button
              className="h-9 bg-[#2968c8] px-6 text-[13px] text-white hover:bg-[#1e50a0]"
              onClick={loadData}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <BarChart3 className="mr-2 h-4 w-4" />
              )}
              Gerar Relatório
            </Button>

            {/* Botão Imprimir (só aparece após gerar) */}
            {hasGenerated && summary && list && list.items.length > 0 && (
              <Button
                variant="outline"
                className="h-9 text-[13px]"
                onClick={handlePrint}
              >
                <Printer className="mr-2 h-4 w-4" />
                Imprimir A4
              </Button>
            )}
          </div>
        </div>

        {/* Estado inicial — antes de gerar */}
        {!hasGenerated && !loading && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#e5e5e5] py-24 text-center">
            <Truck className="mb-3 h-10 w-10 text-[#ccc]" />
            <p className="text-[15px] font-semibold text-[#888]">
              Configure os filtros e clique em "Gerar Relatório"
            </p>
            <p className="mt-1 text-[13px] text-[#aaa]">
              O relatório será carregado com os dados do período selecionado.
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-[#2968c8]" />
          </div>
        )}

        {/* Conteúdo do relatório */}
        {!loading && hasGenerated && summary && (
          <>
            {/* Cards de totais */}
            <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <StatCard
                label="Total de caixas"
                value={summary.totals.total_boxes}
                sub="envios únicos"
                icon={<Box className="h-5 w-5" />}
                color="#2968c8"
              />
              <StatCard
                label="Total de pedidos"
                value={summary.totals.total_orders}
                icon={<Package className="h-5 w-5" />}
                color="#7c3aed"
              />
              <StatCard
                label="Faturamento total"
                value={formatCurrency(summary.totals.total_amount)}
                icon={<TrendingUp className="h-5 w-5" />}
                color="#22c55e"
              />
            </div>

            {/* Gráfico diário */}
            {chartData.length > 1 && (
              <div className="mb-6 rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
                <div className="mb-4 flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-[#2968c8]" />
                  <span className="text-[14px] font-bold text-[#222]">
                    Caixas despachadas por dia
                  </span>
                </div>
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <AreaChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis
                      dataKey="day"
                      tick={{ fontSize: 11, fill: "#888" }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#888" }}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      type="monotone"
                      dataKey="total_boxes"
                      stroke="#2968c8"
                      fill="#2968c820"
                      strokeWidth={2}
                      dot={false}
                    />
                  </AreaChart>
                </ChartContainer>
              </div>
            )}

            {/* Por empresa */}
            {summary.by_company.length > 0 && (
              <div className="mb-6">
                <h2 className="mb-3 text-[14px] font-bold text-[#444]">Por empresa</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {summary.by_company.map((c) => (
                    <CompanyCard
                      key={c.connection_id}
                      nickname={c.seller_nickname}
                      totalBoxes={c.total_boxes}
                      totalOrders={c.total_orders}
                      totalAmount={c.total_amount}
                      pct={
                        summary.totals.total_boxes > 0
                          ? (c.total_boxes / summary.totals.total_boxes) * 100
                          : 0
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Tabela detalhada */}
            {list && list.items.length > 0 && (
              <div className="rounded-2xl border border-[#e5e5e5] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
                <div className="flex items-center justify-between border-b border-[#ededed] px-5 py-4">
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-[#2968c8]" />
                    <span className="text-[14px] font-bold text-[#222]">
                      Detalhe dos envios
                    </span>
                  </div>
                  <span className="text-[12px] text-[#888]">
                    {list.total} {list.total === 1 ? "caixa" : "caixas"}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-[#ededed] bg-[#fafafa]">
                        <th className="px-4 py-2.5 text-left font-semibold text-[#666]">Empresa</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-[#666]">Shipping ID</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-[#666]">Despachado em</th>
                        <th className="px-4 py-2.5 text-center font-semibold text-[#666]">Pedidos</th>
                        <th className="px-4 py-2.5 text-right font-semibold text-[#666]">Total</th>
                        <th className="px-4 py-2.5 text-left font-semibold text-[#666]">Obs.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.items.map((item) => (
                        <tr
                          key={item.shipping_id}
                          className="border-b border-[#f0f0f0] last:border-0 hover:bg-[#fafafa]"
                        >
                          <td className="px-4 py-2.5 font-semibold text-[#222]">
                            {item.seller_nickname}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[12px] text-[#444]">
                            #{item.shipping_id}
                          </td>
                          <td className="px-4 py-2.5 text-[#666]">
                            {formatDateTime(item.shipped_at)}
                          </td>
                          <td className="px-4 py-2.5 text-center font-semibold text-[#444]">
                            {item.order_count}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-[#22c55e]">
                            {formatCurrency(item.total_amount)}
                          </td>
                          <td className="px-4 py-2.5 text-[#888]">
                            {item.pack_id && (
                              <span className="mr-1 rounded-full bg-[#f0f4ff] px-1.5 py-0.5 text-[11px] font-semibold text-[#2968c8]">
                                Pack
                              </span>
                            )}
                            {item.substatus && (
                              <span className="text-[11px]">{item.substatus}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {list.total > list.items.length && (
                  <div className="border-t border-[#ededed] px-5 py-3 text-center text-[12px] text-[#888]">
                    Exibindo {list.items.length} de {list.total} caixas. Exporte o CSV para ver todas.
                  </div>
                )}
              </div>
            )}

            {/* Sem dados */}
            {summary.totals.total_boxes === 0 && (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#e5e5e5] py-20 text-center">
                <Box className="mb-3 h-10 w-10 text-[#ccc]" />
                <p className="text-[15px] font-semibold text-[#888]">
                  Nenhuma caixa despachada no período
                </p>
                <p className="mt-1 text-[13px] text-[#aaa]">
                  Ajuste o filtro de datas ou empresa para ver outros períodos.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
