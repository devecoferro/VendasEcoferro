import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { AppLayout } from "@/components/AppLayout";
import { StatsCard } from "@/components/StatsCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useAuth } from "@/contexts/AuthContext";
import { useMercadoLivreData } from "@/hooks/useMercadoLivreData";
import {
  formatShortDate,
  formatShortTime,
  formatSaleMoment,
  getDepositInfo,
  getShipmentPresentation,
  hasConfirmedPayment,
  hasBillingInfoSnapshot,
  isOrderForCollection,
  isOrderInvoicePending,
  isOrderReadyToPrintLabel,
  isOrderUnderReview,
  countByPack,
  parseDate,
} from "@/services/mercadoLivreHelpers";
import {
  listMLConnections,
  type MLConnection,
  type MLOperationalBucket,
  type MLOrder,
} from "@/services/mercadoLivreService";
import {
  BarChart3,
  CheckCircle,
  FileCheck2,
  Loader2,
  Package,
  ShoppingCart,
  Store,
  TrendingUp,
} from "lucide-react";

// ─── Tipos ──────────────────────────────────────────────────────────────────

type CompanyFilter = "all" | "ecoferro" | "fantom";

interface DailyTrendRow {
  dayKey: string;
  label: string;
  pedidos: number;
  etiquetas: number;
}
interface DepositVolumeRow {
  deposit: string;
  pedidos: number;
  etiquetas: number;
  faturamento: number;
}
interface PriorityOrderRow {
  order: MLOrder;
  statusLabel: string;
  statusTone: "ready" | "invoice" | "review" | "collection" | "neutral";
}

// ─── Constantes ─────────────────────────────────────────────────────────────

const BUCKET_META: Array<{ key: MLOperationalBucket; label: string; color: string }> = [
  { key: "today", label: "Envios de hoje", color: "#3483fa" },
  { key: "upcoming", label: "Próximos dias", color: "#7c3aed" },
  { key: "in_transit", label: "Em trânsito", color: "#0f9b8e" },
  { key: "finalized", label: "Finalizadas", color: "#f97316" },
];
const DAILY_TREND_CHART_CONFIG = {
  pedidos: { label: "Pedidos", color: "#8bb8ff" },
  etiquetas: { label: "Etiquetas prontas", color: "#2563eb" },
} satisfies ChartConfig;
const DEPOSIT_VOLUME_CHART_CONFIG = {
  pedidos: { label: "Pedidos", color: "#3483fa" },
  etiquetas: { label: "Etiquetas prontas", color: "#22c55e" },
} satisfies ChartConfig;
const BUCKET_CHART_CONFIG = {
  today: { label: "Envios de hoje", color: "#3483fa" },
  upcoming: { label: "Próximos dias", color: "#7c3aed" },
  in_transit: { label: "Em trânsito", color: "#0f9b8e" },
  finalized: { label: "Finalizadas", color: "#f97316" },
} satisfies ChartConfig;

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
}
function buildDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// ─── Componentes auxiliares ─────────────────────────────────────────────────

function DashboardPanel({
  title, description, action, children,
}: {
  title: string; description?: string; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-[#e6ebf4] bg-white p-5 shadow-[0_8px_24px_rgba(15,23,42,0.05)] lg:p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-[#22304a]">{title}</h2>
          {description && <p className="text-sm text-[#6b7280]">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function EmptyChartState({ message }: { message: string }) {
  return (
    <div className="flex h-[280px] items-center justify-center rounded-[22px] border border-dashed border-[#d7dfef] bg-[#f8fbff] px-6 text-center text-sm text-[#6b7280]">
      {message}
    </div>
  );
}
function getPriorityStatus(order: MLOrder): string {
  if (isOrderReadyToPrintLabel(order)) return "Etiqueta pronta";
  if (isOrderInvoicePending(order)) return "NF-e pendente";
  if (isOrderUnderReview(order)) return "Em revisão";
  if (isOrderForCollection(order)) return "Para coleta";
  return getShipmentPresentation(order).title;
}
function getPriorityTone(order: MLOrder): PriorityOrderRow["statusTone"] {
  if (isOrderReadyToPrintLabel(order)) return "ready";
  if (isOrderInvoicePending(order)) return "invoice";
  if (isOrderUnderReview(order)) return "review";
  if (isOrderForCollection(order)) return "collection";
  return "neutral";
}
function getPriorityRank(order: MLOrder): number {
  if (isOrderReadyToPrintLabel(order)) return 0;
  if (isOrderInvoicePending(order)) return 1;
  if (isOrderUnderReview(order)) return 2;
  if (isOrderForCollection(order)) return 3;
  return 4;
}
function statusBadgeClassName(tone: PriorityOrderRow["statusTone"]): string {
  switch (tone) {
    case "ready":      return "border-[#cde8d3] bg-[#eefcf1] text-[#1b7a33]";
    case "invoice":    return "border-[#ffe4b5] bg-[#fff5df] text-[#b86900]";
    case "review":     return "border-[#ffd8dc] bg-[#fff1f3] text-[#c2415d]";
    case "collection": return "border-[#d7e8ff] bg-[#eef5ff] text-[#2968c8]";
    default:           return "border-[#e5e7eb] bg-[#f8fafc] text-[#475569]";
  }
}

// ─── Seletor de empresa ─────────────────────────────────────────────────────

function CompanySelector({
  value, onChange, connections,
}: {
  value: CompanyFilter; onChange: (v: CompanyFilter) => void; connections: MLConnection[];
}) {
  const hasEcoferro = connections.some((c) => (c.seller_nickname || "").toLowerCase().includes("ecoferro"));
  const hasFantom = connections.some((c) => (c.seller_nickname || "").toLowerCase().includes("fantom"));
  const options: { key: CompanyFilter; label: string; show: boolean }[] = [
    { key: "all",      label: "Ambas",    show: hasEcoferro && hasFantom },
    { key: "ecoferro", label: "EcoFerro", show: hasEcoferro },
    { key: "fantom",   label: "Fantom",   show: hasFantom },
  ];
  const visible = options.filter((o) => o.show);
  if (visible.length <= 1) return null;
  return (
    <div className="flex items-center gap-1 rounded-full border border-[#e6ebf4] bg-[#f8fafc] p-1">
      {visible.map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-all ${
            value === opt.key
              ? "bg-white text-[#1f2937] shadow-sm"
              : "text-[#6b7280] hover:text-[#1f2937]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Hooks de dados por empresa ──────────────────────────────────────────────

function useEcoferroData(connId: string | undefined, resolved: boolean) {
  return useMercadoLivreData({
    ordersView: "dashboard",
    connectionId: connId,
    connectionIdResolved: resolved,
  });
}
function useFantomData(connId: string | undefined, resolved: boolean, active: boolean) {
  return useMercadoLivreData({
    ordersView: "dashboard",
    connectionId: active ? connId : undefined,
    connectionIdResolved: resolved && active,
  });
}

// ─── Página principal ────────────────────────────────────────────────────────

export default function DashboardPage() {
  const navigate = useNavigate();
  const { canAccessLocation } = useAuth();

  const [connections, setConnections] = useState<MLConnection[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [companyFilter, setCompanyFilter] = useState<CompanyFilter>("all");

  useEffect(() => {
    let cancelled = false;
    listMLConnections()
      .then((list) => {
        if (!cancelled) {
          setConnections(list);
          setConnectionsLoaded(true);
          if (list.length === 1) {
            const nick = (list[0].seller_nickname || "").toLowerCase();
            setCompanyFilter(nick.includes("fantom") ? "fantom" : "ecoferro");
          }
        }
      })
      .catch(() => { if (!cancelled) setConnectionsLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const ecoferroConn = connections.find((c) => (c.seller_nickname || "").toLowerCase().includes("ecoferro"));
  const fantomConn   = connections.find((c) => (c.seller_nickname || "").toLowerCase().includes("fantom"));

  // Resolve qual connectionId usar para cada empresa
  const ecoConnId  = companyFilter === "fantom" ? fantomConn?.id : ecoferroConn?.id;
  const fantomActive = companyFilter === "all";

  const ecoData    = useEcoferroData(ecoConnId, connectionsLoaded);
  const fantomData = useFantomData(fantomConn?.id, connectionsLoaded, fantomActive);

  // Mescla de orders quando "all"
  const orders = useMemo<MLOrder[]>(() => {
    if (companyFilter !== "all") return ecoData.orders || [];
    const map = new Map<string, MLOrder>();
    for (const o of [...(ecoData.orders || []), ...(fantomData.orders || [])]) {
      map.set(o.id, o);
    }
    return Array.from(map.values()).sort((a, b) => {
      const aTime = parseDate(a.sale_date)?.getTime() ?? 0;
      const bTime = parseDate(b.sale_date)?.getTime() ?? 0;
      return bTime - aTime;
    });
  }, [companyFilter, ecoData.orders, fantomData.orders]);

  // Mescla de deposits quando "all"
  const dashboard = useMemo(() => {
    if (companyFilter !== "all") return ecoData.dashboard;
    const deps = [
      ...(ecoData.dashboard?.deposits || []),
      ...(fantomData.dashboard?.deposits || []),
    ];
    if (!ecoData.dashboard && !fantomData.dashboard) return null;
    return { ...(ecoData.dashboard || fantomData.dashboard!), deposits: deps };
  }, [companyFilter, ecoData.dashboard, fantomData.dashboard]);

  const connection  = ecoData.connection;
  const connectionB = companyFilter === "all" ? fantomData.connection : null;
  const loading     = !connectionsLoaded || ecoData.loading || (companyFilter === "all" && fantomData.loading);

  // ── Filtros de localização ──────────────────────────────────────────────
  const permittedOrders = useMemo(
    () => orders.filter((order) => canAccessLocation(getDepositInfo(order).label)),
    [canAccessLocation, orders]
  );
  const accessibleDeposits = useMemo(
    () => (dashboard?.deposits || []).filter((deposit) => canAccessLocation(deposit.label)),
    [canAccessLocation, dashboard?.deposits]
  );

  // ── Derivações operacionais ─────────────────────────────────────────────
  const printableOrders      = useMemo(() => permittedOrders.filter(isOrderReadyToPrintLabel), [permittedOrders]);
  const invoicePendingOrders = useMemo(() => permittedOrders.filter(isOrderInvoicePending), [permittedOrders]);
  const underReviewOrders    = useMemo(() => permittedOrders.filter(isOrderUnderReview), [permittedOrders]);
  const billingAvailableOrders = useMemo(() => permittedOrders.filter(hasBillingInfoSnapshot), [permittedOrders]);
  const paidOrders = useMemo(
    () => permittedOrders.filter(
      (o) => o.order_status !== "cancelled" && o.order_status !== "returned" &&
             o.order_status !== "not_delivered" && hasConfirmedPayment(o)
    ),
    [permittedOrders]
  );
  const totalRevenue    = useMemo(() => paidOrders.reduce((s, o) => s + (typeof o.amount === "number" ? o.amount : 0), 0), [paidOrders]);
  const printableRevenue = useMemo(() => printableOrders.reduce((s, o) => s + (typeof o.amount === "number" ? o.amount : 0), 0), [printableOrders]);

  const bucketTotals = useMemo(
    () => BUCKET_META.map((bucket) => ({
      ...bucket,
      total: accessibleDeposits.reduce(
        (sum, deposit) => sum + (deposit.internal_operational_counts?.[bucket.key] || deposit.counts?.[bucket.key] || 0),
        0
      ),
    })),
    [accessibleDeposits]
  );
  const bucketGrandTotal = useMemo(() => bucketTotals.reduce((s, b) => s + b.total, 0), [bucketTotals]);
  const topBucket = useMemo(
    () => [...bucketTotals].sort((a, b) => b.total - a.total).find((b) => b.total > 0) || null,
    [bucketTotals]
  );

  const trendData = useMemo<DailyTrendRow[]>(() => {
    const days = 7;
    const today = startOfDay(new Date());
    const rows = Array.from({ length: days }).map((_, i) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (days - i - 1));
      return { dayKey: buildDayKey(date), label: formatShortDate(date.toISOString()), pedidos: 0, etiquetas: 0 };
    });
    const rowMap = new Map(rows.map((r) => [r.dayKey, r]));
    for (const order of permittedOrders) {
      const parsedDate = parseDate(order.sale_date);
      if (!parsedDate) continue;
      const row = rowMap.get(buildDayKey(parsedDate));
      if (!row) continue;
      row.pedidos += 1;
      if (isOrderReadyToPrintLabel(order)) row.etiquetas += 1;
    }
    return rows;
  }, [permittedOrders]);

  const depositVolumeData = useMemo<DepositVolumeRow[]>(() => {
    const grouped = new Map<string, DepositVolumeRow>();
    for (const order of permittedOrders) {
      const deposit = getDepositInfo(order);
      const key = deposit.displayLabel;
      const current = grouped.get(key) || { deposit: key, pedidos: 0, etiquetas: 0, faturamento: 0 };
      current.pedidos += 1;
      const isCancelled = ["cancelled", "returned", "not_delivered"].includes(order.order_status || "");
      if (!isCancelled) current.faturamento += typeof order.amount === "number" ? order.amount : 0;
      if (isOrderReadyToPrintLabel(order)) current.etiquetas += 1;
      grouped.set(key, current);
    }
    return Array.from(grouped.values()).sort((a, b) => b.pedidos - a.pedidos).slice(0, 6);
  }, [permittedOrders]);

  const priorityQueue = useMemo<PriorityOrderRow[]>(() => {
    return [...permittedOrders]
      .sort((a, b) => {
        const rankDiff = getPriorityRank(a) - getPriorityRank(b);
        if (rankDiff !== 0) return rankDiff;
        return (parseDate(b.sale_date)?.getTime() ?? 0) - (parseDate(a.sale_date)?.getTime() ?? 0);
      })
      .slice(0, 6)
      .map((order) => ({ order, statusLabel: getPriorityStatus(order), statusTone: getPriorityTone(order) }));
  }, [permittedOrders]);

  const operationalSummary = useMemo(() => [
    { label: "Etiquetas prontas",          value: countByPack(printableOrders),       helper: `${countByPack(printableOrders)} envios prontos`,          color: "bg-[#1b7a33]" },
    { label: "NF-e pendente",              value: countByPack(invoicePendingOrders),   helper: `${countByPack(invoicePendingOrders)} envios aguardando NF-e`, color: "bg-[#f59e0b]" },
    { label: "Em revisão",                 value: countByPack(underReviewOrders),      helper: `${countByPack(underReviewOrders)} envios em revisão`,      color: "bg-[#e11d48]" },
    { label: "Dados fiscais disponíveis",  value: countByPack(billingAvailableOrders), helper: `${countByPack(billingAvailableOrders)} envios com billing_info`, color: "bg-[#2563eb]" },
  ], [billingAvailableOrders, invoicePendingOrders, printableOrders, underReviewOrders]);

  // ── Label da empresa selecionada ────────────────────────────────────────
  const companyLabel = useMemo(() => {
    if (companyFilter === "all") {
      const names = connections.map((c) => c.seller_nickname || "").filter(Boolean).join(" + ");
      return names || "Todas as empresas";
    }
    if (companyFilter === "fantom") return connectionB?.seller_nickname || fantomConn?.seller_nickname || "Fantom";
    return connection?.seller_nickname || ecoferroConn?.seller_nickname || "EcoFerro";
  }, [companyFilter, connection, connectionB, connections, ecoferroConn, fantomConn]);

  const lastSyncLabel = useMemo(() => {
    const times = [connection?.last_sync_at, connectionB?.last_sync_at].filter(Boolean).map((t) => formatShortTime(t!));
    return times.length > 0 ? times[0] : "--:--";
  }, [connection, connectionB]);

  const hasOperationalData = permittedOrders.length > 0 || accessibleDeposits.length > 0 || Boolean(connection);

  // ── Render: loading ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  // ── Render: sem dados ───────────────────────────────────────────────────
  if (!hasOperationalData) {
    return (
      <AppLayout>
        <div className="space-y-8">
          <div className="space-y-2">
            <h1 className="text-[30px] font-semibold tracking-[-0.04em] text-[#1f2937] sm:text-[36px] lg:text-[40px]">Dashboard</h1>
            <p className="max-w-2xl text-sm text-[#6b7280] sm:text-base">
              O painel executivo fica mais útil quando há conta conectada, pedidos sincronizados e operação disponível para os locais deste usuário.
            </p>
          </div>
          <div className="rounded-[28px] border border-[#e6ebf4] bg-white px-8 py-16 text-center shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#eef5ff] text-[#3483fa]">
                <BarChart3 className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-[-0.03em] text-[#22304a]">Ainda não há dados suficientes para o dashboard</h2>
                <p className="text-sm leading-6 text-[#6b7280]">
                  Assim que a operação do Mercado Livre estiver conectada e sincronizada, este painel passa a mostrar pedidos, gargalos, gráficos e visão consolidada da expedição.
                </p>
              </div>
              <Button className="h-11 rounded-full bg-[#3483fa] px-6 text-sm font-semibold text-white hover:bg-[#2968c8]" onClick={() => navigate("/mercado-livre")}>
                Abrir operação Mercado Livre
              </Button>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  // ── Render: dashboard completo ──────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-[30px] font-semibold tracking-[-0.04em] text-[#1f2937] sm:text-[36px] lg:text-[40px]">Dashboard</h1>
            <p className="max-w-3xl text-sm text-[#6b7280] sm:text-base">
              Visão executiva da operação de etiquetas, sincronização e faturamento para os locais liberados neste usuário.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <CompanySelector value={companyFilter} onChange={setCompanyFilter} connections={connections} />
            <Badge className="rounded-full border-0 bg-[#eef5ff] px-4 py-2 text-[#2563eb]">
              {companyLabel}
            </Badge>
            <Badge variant="outline" className="rounded-full px-4 py-2 text-[#475569]">
              Última sync {lastSyncLabel}
            </Badge>
            <Button
              className="h-10 rounded-full bg-[#111827] px-5 text-sm font-semibold text-white hover:bg-[#0f172a]"
              onClick={() => navigate("/mercado-livre")}
            >
              Abrir operação
            </Button>
          </div>
        </div>

        {/* Cards de resumo */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatsCard title="Pedidos visíveis"    value={permittedOrders.length.toLocaleString("pt-BR")}          icon={ShoppingCart} accentColor="primary" subtitle="Pedidos deste usuário" />
          <StatsCard title="Etiquetas prontas"   value={printableOrders.length.toLocaleString("pt-BR")}          icon={Package}      accentColor="success" subtitle="Prontas para impressão" />
          <StatsCard title="NF-e pendente"       value={countByPack(invoicePendingOrders).toLocaleString("pt-BR")} icon={FileCheck2}   accentColor="warning" subtitle="Aguardando faturamento" />
          <StatsCard title="Depósitos ativos"    value={accessibleDeposits.length.toLocaleString("pt-BR")}       icon={Store}        accentColor="accent"  subtitle="Bases operacionais" />
          <StatsCard title="Faturamento visível" value={formatCurrency(printableRevenue)}                        icon={TrendingUp}   accentColor="primary" subtitle={`${billingAvailableOrders.length} pedidos com billing_info`} />
        </div>

        {/* Gráficos principais */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_0.95fr]">
          <DashboardPanel
            title="Ritmo dos últimos 7 dias"
            description="Pedidos sincronizados versus etiquetas realmente prontas para impressão."
            action={
              <Badge variant="outline" className="rounded-full px-3 py-1 text-[#475569]">
                Faturamento total {formatCurrency(totalRevenue)}
              </Badge>
            }
          >
            {trendData.some((e) => e.pedidos > 0 || e.etiquetas > 0) ? (
              <ChartContainer className="h-[320px] w-full aspect-auto" config={DAILY_TREND_CHART_CONFIG}>
                <AreaChart data={trendData} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pedidosGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8bb8ff" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#8bb8ff" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="etiquetasGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" />
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area type="monotone" dataKey="pedidos"   stroke="#8bb8ff" strokeWidth={2} fill="url(#pedidosGrad)" />
                  <Area type="monotone" dataKey="etiquetas" stroke="#2563eb" strokeWidth={2} fill="url(#etiquetasGrad)" />
                </AreaChart>
              </ChartContainer>
            ) : (
              <EmptyChartState message="Ainda não há pedidos nos últimos 7 dias para exibir a tendência." />
            )}
          </DashboardPanel>

          {/* Pedidos por etapa (bucket donut) */}
          <DashboardPanel title="Pedidos por etapa" description="Resumo objetivo da operação visível neste dashboard.">
            {bucketGrandTotal > 0 ? (
              <div className="flex flex-col items-center gap-4 lg:flex-row lg:items-start">
                <div className="flex flex-col items-center gap-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">Total monitorado</p>
                  {topBucket && <p className="text-xs text-[#3483fa]">Maior volume: {topBucket.label}</p>}
                  <ChartContainer className="h-[180px] w-[180px] aspect-square" config={BUCKET_CHART_CONFIG}>
                    <PieChart>
                      <Pie data={bucketTotals} dataKey="total" nameKey="key" cx="50%" cy="50%" innerRadius={55} outerRadius={80} strokeWidth={2}>
                        {bucketTotals.map((entry) => <Cell key={entry.key} fill={entry.color} />)}
                      </Pie>
                      <ChartTooltip content={<ChartTooltipContent />} />
                    </PieChart>
                  </ChartContainer>
                  <p className="text-xs font-semibold text-[#94a3b8]">PEDIDOS</p>
                  <p className="text-3xl font-bold text-[#22304a]">{bucketGrandTotal}</p>
                </div>
                <div className="flex flex-1 flex-col gap-3">
                  {bucketTotals.map((bucket) => (
                    <div key={bucket.key} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: bucket.color }} />
                          <span className="text-sm font-medium text-[#22304a]">{bucket.label}</span>
                        </div>
                        <span className="text-sm font-semibold text-[#22304a]">{bucket.total}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#f0f4f8]">
                        <div className="h-full rounded-full transition-all" style={{ width: `${bucketGrandTotal > 0 ? (bucket.total / bucketGrandTotal) * 100 : 0}%`, backgroundColor: bucket.color }} />
                      </div>
                      <p className="text-xs text-[#94a3b8]">
                        {bucketGrandTotal > 0 ? `${Math.round((bucket.total / bucketGrandTotal) * 100)}% do total monitorado` : "0%"} · {bucket.label}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyChartState message="Nenhum pedido ativo nos buckets operacionais no momento." />
            )}
          </DashboardPanel>
        </div>

        {/* Segunda linha */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
          <DashboardPanel title="Volume por depósito" description="Pedidos e etiquetas prontas agrupados por base operacional.">
            {depositVolumeData.length > 0 ? (
              <ChartContainer className="h-[280px] w-full aspect-auto" config={DEPOSIT_VOLUME_CHART_CONFIG}>
                <BarChart data={depositVolumeData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f4f8" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="deposit" tick={{ fontSize: 11, fill: "#475569" }} axisLine={false} tickLine={false} width={100} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="pedidos"   fill="#3483fa" radius={[0, 4, 4, 0]} />
                  <Bar dataKey="etiquetas" fill="#22c55e" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyChartState message="Nenhum depósito com pedidos visíveis para este usuário." />
            )}
          </DashboardPanel>

          <DashboardPanel title="Resumo operacional" description="Contadores de ações pendentes na operação atual.">
            <div className="space-y-4">
              {operationalSummary.map((item) => (
                <div key={item.label} className="flex items-center gap-4 rounded-[18px] border border-[#f0f4f8] bg-[#fbfcfe] px-4 py-3">
                  <div className={`h-3 w-3 flex-shrink-0 rounded-full ${item.color}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#22304a]">{item.label}</p>
                    <p className="text-xs text-[#94a3b8]">{item.helper}</p>
                  </div>
                  <span className="text-2xl font-bold text-[#22304a]">{item.value.toLocaleString("pt-BR")}</span>
                </div>
              ))}
              <div className="mt-2 rounded-[18px] border border-[#e6f0ff] bg-[#f0f7ff] px-4 py-3">
                <div className="flex items-start gap-3">
                  <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#2563eb]" />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-[#1e3a5f]">Regra ativa de geração</p>
                    <p className="text-sm leading-6 text-[#6b7280]">
                      O sistema libera impressão quando o pedido está pago, o envio está em
                      <span className="font-semibold text-[#22304a]"> ready_to_ship</span> e não ficou travado em
                      <span className="font-semibold text-[#22304a]"> invoice_pending</span>.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </DashboardPanel>
        </div>

        {/* Fila de prioridade */}
        <DashboardPanel
          title="Fila recente de operação"
          description="Pedidos mais relevantes para acompanhamento rápido, priorizados por impressão, NF-e e revisão."
          action={
            <Button variant="outline" className="rounded-full" onClick={() => navigate("/mercado-livre")}>
              Ver tudo
            </Button>
          }
        >
          {priorityQueue.length === 0 ? (
            <div className="rounded-[22px] border border-dashed border-[#d7dfef] bg-[#f8fbff] px-6 py-12 text-center text-sm text-[#6b7280]">
              Ainda não há pedidos suficientes para montar a fila recente deste dashboard.
            </div>
          ) : (
            <div className="space-y-3">
              {priorityQueue.map(({ order, statusLabel, statusTone }) => {
                const deposit  = getDepositInfo(order);
                const shipment = getShipmentPresentation(order);
                return (
                  <button
                    key={order.id}
                    type="button"
                    className="grid w-full gap-3 rounded-[22px] border border-[#e7edf6] bg-[#fbfcfe] px-4 py-4 text-left transition hover:border-[#cfe0ff] hover:bg-white lg:grid-cols-[1.3fr_0.85fr_0.6fr_0.55fr]"
                    onClick={() => navigate("/mercado-livre")}
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#6b7280]">
                        <span className="inline-flex rounded-full bg-[#fff159] px-2 py-0.5 font-semibold text-[#333333]">ML</span>
                        <span className="font-semibold text-[#22304a]">#{order.sale_number}</span>
                        <span>{formatSaleMoment(order.sale_date)}</span>
                      </div>
                      <div>
                        <p className="text-base font-semibold text-[#172554]">{order.item_title || "Produto sem título"}</p>
                        <p className="mt-1 text-sm text-[#6b7280]">
                          {order.buyer_real_name ||
                            (order.buyer_name && order.buyer_name !== order.buyer_nickname ? order.buyer_name : null) ||
                            order.buyer_nickname || "Comprador não identificado"}
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">Operação</p>
                      <p className="text-sm font-medium text-[#22304a]">{deposit.displayLabel}</p>
                      <p className="text-sm text-[#6b7280]">{shipment.title}</p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">Valor</p>
                      <p className="text-sm font-semibold text-[#22304a]">{formatCurrency(typeof order.amount === "number" ? order.amount : 0)}</p>
                      <p className="text-sm text-[#6b7280]">{order.quantity} un.</p>
                    </div>
                    <div className="flex items-center lg:justify-end">
                      <span className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold ${statusBadgeClassName(statusTone)}`}>
                        {statusLabel}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </DashboardPanel>
      </div>
    </AppLayout>
  );
}
