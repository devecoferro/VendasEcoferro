import { useMemo } from "react";
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
import type { MLOperationalBucket, MLOrder } from "@/services/mercadoLivreService";
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
  statusTone:
    | "ready"
    | "invoice"
    | "review"
    | "collection"
    | "neutral";
}

const BUCKET_META: Array<{
  key: MLOperationalBucket;
  label: string;
  color: string;
}> = [
  { key: "today", label: "Envios de hoje", color: "#3483fa" },
  { key: "upcoming", label: "Próximos dias", color: "#7c3aed" },
  { key: "in_transit", label: "Em trânsito", color: "#0f9b8e" },
  { key: "finalized", label: "Finalizadas", color: "#f97316" },
];

const DAILY_TREND_CHART_CONFIG = {
  pedidos: {
    label: "Pedidos",
    color: "#8bb8ff",
  },
  etiquetas: {
    label: "Etiquetas prontas",
    color: "#2563eb",
  },
} satisfies ChartConfig;

const DEPOSIT_VOLUME_CHART_CONFIG = {
  pedidos: {
    label: "Pedidos",
    color: "#3483fa",
  },
  etiquetas: {
    label: "Etiquetas prontas",
    color: "#22c55e",
  },
} satisfies ChartConfig;

const BUCKET_CHART_CONFIG = {
  today: {
    label: "Envios de hoje",
    color: "#3483fa",
  },
  upcoming: {
    label: "Próximos dias",
    color: "#7c3aed",
  },
  in_transit: {
    label: "Em trânsito",
    color: "#0f9b8e",
  },
  finalized: {
    label: "Finalizadas",
    color: "#f97316",
  },
} satisfies ChartConfig;

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
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

function DashboardPanel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
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

function getPriorityStatus(order: MLOrder): PriorityOrderRow["statusLabel"] {
  if (isOrderReadyToPrintLabel(order)) {
    return "Etiqueta pronta";
  }
  if (isOrderInvoicePending(order)) {
    return "NF-e pendente";
  }
  if (isOrderUnderReview(order)) {
    return "Em revisão";
  }
  if (isOrderForCollection(order)) {
    return "Para coleta";
  }
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
    case "ready":
      return "border-[#cde8d3] bg-[#eefcf1] text-[#1b7a33]";
    case "invoice":
      return "border-[#ffe4b5] bg-[#fff5df] text-[#b86900]";
    case "review":
      return "border-[#ffd8dc] bg-[#fff1f3] text-[#c2415d]";
    case "collection":
      return "border-[#d7e8ff] bg-[#eef5ff] text-[#2968c8]";
    default:
      return "border-[#e5e7eb] bg-[#f8fafc] text-[#475569]";
  }
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { canAccessLocation } = useAuth();
  const { connection, orders, dashboard, loading } = useMercadoLivreData({
    ordersView: "dashboard",
  });

  const permittedOrders = useMemo(
    () => orders.filter((order) => canAccessLocation(getDepositInfo(order).label)),
    [canAccessLocation, orders]
  );

  const accessibleDeposits = useMemo(
    () => (dashboard?.deposits || []).filter((deposit) => canAccessLocation(deposit.label)),
    [canAccessLocation, dashboard?.deposits]
  );

  const printableOrders = useMemo(
    () => permittedOrders.filter(isOrderReadyToPrintLabel),
    [permittedOrders]
  );

  const invoicePendingOrders = useMemo(
    () => permittedOrders.filter(isOrderInvoicePending),
    [permittedOrders]
  );

  const underReviewOrders = useMemo(
    () => permittedOrders.filter(isOrderUnderReview),
    [permittedOrders]
  );

  const billingAvailableOrders = useMemo(
    () => permittedOrders.filter(hasBillingInfoSnapshot),
    [permittedOrders]
  );

  const paidOrders = useMemo(
    () =>
      permittedOrders.filter(
        (order) =>
          order.order_status !== "cancelled" &&
          order.order_status !== "returned" &&
          order.order_status !== "not_delivered" &&
          hasConfirmedPayment(order)
      ),
    [permittedOrders]
  );

  const totalRevenue = useMemo(
    () =>
      paidOrders.reduce((sum, order) => {
        return sum + (typeof order.amount === "number" ? order.amount : 0);
      }, 0),
    [paidOrders]
  );

  const printableRevenue = useMemo(
    () =>
      printableOrders.reduce((sum, order) => {
        return sum + (typeof order.amount === "number" ? order.amount : 0);
      }, 0),
    [printableOrders]
  );

  const bucketTotals = useMemo(
    () =>
      BUCKET_META.map((bucket) => ({
        ...bucket,
        total: accessibleDeposits.reduce(
          (sum, deposit) =>
            sum + (deposit.internal_operational_counts?.[bucket.key] || deposit.counts?.[bucket.key] || 0),
          0
        ),
      })),
    [accessibleDeposits]
  );

  const bucketGrandTotal = useMemo(
    () => bucketTotals.reduce((sum, bucket) => sum + bucket.total, 0),
    [bucketTotals]
  );

  const topBucket = useMemo(
    () =>
      [...bucketTotals]
        .sort((left, right) => right.total - left.total)
        .find((bucket) => bucket.total > 0) || null,
    [bucketTotals]
  );

  const trendData = useMemo<DailyTrendRow[]>(() => {
    const days = 7;
    const today = startOfDay(new Date());
    const rows = Array.from({ length: days }).map((_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() - (days - index - 1));
      return {
        dayKey: buildDayKey(date),
        label: formatShortDate(date.toISOString()),
        pedidos: 0,
        etiquetas: 0,
      };
    });

    const rowMap = new Map(rows.map((row) => [row.dayKey, row]));

    for (const order of permittedOrders) {
      const parsedDate = parseDate(order.sale_date);
      if (!parsedDate) continue;

      const key = buildDayKey(parsedDate);
      const row = rowMap.get(key);
      if (!row) continue;

      row.pedidos += 1;
      if (isOrderReadyToPrintLabel(order)) {
        row.etiquetas += 1;
      }
    }

    return rows;
  }, [permittedOrders]);

  const depositVolumeData = useMemo<DepositVolumeRow[]>(() => {
    const grouped = new Map<string, DepositVolumeRow>();

    for (const order of permittedOrders) {
      const deposit = getDepositInfo(order);
      const key = deposit.displayLabel;
      const current = grouped.get(key) || {
        deposit: key,
        pedidos: 0,
        etiquetas: 0,
        faturamento: 0,
      };

      current.pedidos += 1;
      const isCancelled =
        order.order_status === "cancelled" ||
        order.order_status === "returned" ||
        order.order_status === "not_delivered";
      if (!isCancelled) {
        current.faturamento += typeof order.amount === "number" ? order.amount : 0;
      }

      if (isOrderReadyToPrintLabel(order)) {
        current.etiquetas += 1;
      }

      grouped.set(key, current);
    }

    return Array.from(grouped.values())
      .sort((left, right) => right.pedidos - left.pedidos)
      .slice(0, 6);
  }, [permittedOrders]);

  const priorityQueue = useMemo<PriorityOrderRow[]>(() => {
    return [...permittedOrders]
      .sort((left, right) => {
        const rankDiff = getPriorityRank(left) - getPriorityRank(right);
        if (rankDiff !== 0) return rankDiff;

        const leftTime = parseDate(left.sale_date)?.getTime() ?? 0;
        const rightTime = parseDate(right.sale_date)?.getTime() ?? 0;
        return rightTime - leftTime;
      })
      .slice(0, 6)
      .map((order) => ({
        order,
        statusLabel: getPriorityStatus(order),
        statusTone: getPriorityTone(order),
      }));
  }, [permittedOrders]);

  const operationalSummary = useMemo(
    () => [
      {
        label: "Etiquetas prontas",
        value: countByPack(printableOrders),
        helper: `${countByPack(printableOrders)} envios liberados para impressão`,
        color: "bg-[#1b7a33]",
      },
      {
        label: "NF-e pendente",
        value: countByPack(invoicePendingOrders),
        helper: `${countByPack(invoicePendingOrders)} envios aguardando faturamento (${invoicePendingOrders.length} pedidos)`,
        color: "bg-[#f59e0b]",
      },
      {
        label: "Em revisão",
        value: countByPack(underReviewOrders),
        helper: `${countByPack(underReviewOrders)} envios exigem atenção`,
        color: "bg-[#e11d48]",
      },
      {
        label: "Dados fiscais disponíveis",
        value: countByPack(billingAvailableOrders),
        helper: `${countByPack(billingAvailableOrders)} envios com billing_info válido`,
        color: "bg-[#2563eb]",
      },
    ],
    [billingAvailableOrders, invoicePendingOrders, printableOrders, underReviewOrders]
  );

  const hasOperationalData =
    permittedOrders.length > 0 ||
    accessibleDeposits.length > 0 ||
    Boolean(connection);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  if (!hasOperationalData) {
    return (
      <AppLayout>
        <div className="space-y-8">
          <div className="space-y-2">
            <h1 className="text-[30px] font-semibold tracking-[-0.04em] text-[#1f2937] sm:text-[36px] lg:text-[40px]">
              Dashboard
            </h1>
            <p className="max-w-2xl text-sm text-[#6b7280] sm:text-base">
              O painel executivo fica mais útil quando há conta conectada, pedidos sincronizados
              e operação disponível para os locais deste usuário.
            </p>
          </div>

          <div className="rounded-[28px] border border-[#e6ebf4] bg-white px-8 py-16 text-center shadow-[0_8px_24px_rgba(15,23,42,0.05)]">
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[#eef5ff] text-[#3483fa]">
                <BarChart3 className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-[-0.03em] text-[#22304a]">
                  Ainda não há dados suficientes para o dashboard
                </h2>
                <p className="text-sm leading-6 text-[#6b7280]">
                  Assim que a operação do Mercado Livre estiver conectada e sincronizada, este
                  painel passa a mostrar pedidos, gargalos, gráficos e visão consolidada da
                  expedição.
                </p>
              </div>
              <Button
                className="h-11 rounded-full bg-[#3483fa] px-6 text-sm font-semibold text-white hover:bg-[#2968c8]"
                onClick={() => navigate("/mercado-livre")}
              >
                Abrir operação Mercado Livre
              </Button>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-[30px] font-semibold tracking-[-0.04em] text-[#1f2937] sm:text-[36px] lg:text-[40px]">
              Dashboard
            </h1>
            <p className="max-w-3xl text-sm text-[#6b7280] sm:text-base">
              Visão executiva da operação de etiquetas, sincronização e faturamento para os
              locais liberados neste usuário.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className="rounded-full border-0 bg-[#eef5ff] px-4 py-2 text-[#2563eb]">
              {connection?.seller_nickname || "Mercado Livre"}
            </Badge>
            <Badge variant="outline" className="rounded-full px-4 py-2 text-[#475569]">
              Última sync {connection?.last_sync_at ? formatShortTime(connection.last_sync_at) : "--:--"}
            </Badge>
            <Button
              className="h-10 rounded-full bg-[#111827] px-5 text-sm font-semibold text-white hover:bg-[#0f172a]"
              onClick={() => navigate("/mercado-livre")}
            >
              Abrir operação
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <StatsCard
            title="Pedidos visíveis"
            value={permittedOrders.length.toLocaleString("pt-BR")}
            icon={ShoppingCart}
            accentColor="primary"
            subtitle="Pedidos deste usuário"
          />
          <StatsCard
            title="Etiquetas prontas"
            value={printableOrders.length.toLocaleString("pt-BR")}
            icon={Package}
            accentColor="success"
            subtitle="Prontas para impressão"
          />
          <StatsCard
            title="NF-e pendente"
            value={countByPack(invoicePendingOrders).toLocaleString("pt-BR")}
            icon={FileCheck2}
            accentColor="warning"
            subtitle={`Aguardando faturamento (${invoicePendingOrders.length} pedidos)`}
          />
          <StatsCard
            title="Depósitos ativos"
            value={accessibleDeposits.length.toLocaleString("pt-BR")}
            icon={Store}
            accentColor="accent"
            subtitle="Bases operacionais"
          />
          <StatsCard
            title="Faturamento visível"
            value={formatCurrency(printableRevenue)}
            icon={TrendingUp}
            accentColor="primary"
            subtitle={`${billingAvailableOrders.length} pedidos com billing_info`}
          />
        </div>

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
            {trendData.some((entry) => entry.pedidos > 0 || entry.etiquetas > 0) ? (
              <ChartContainer
                className="h-[320px] w-full aspect-auto"
                config={DAILY_TREND_CHART_CONFIG}
              >
                <AreaChart data={trendData} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendPedidos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8bb8ff" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#8bb8ff" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="trendEtiquetas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} strokeDasharray="4 4" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={12}
                  />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent indicator="line" />}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area
                    type="monotone"
                    dataKey="pedidos"
                    stroke="var(--color-pedidos)"
                    fill="url(#trendPedidos)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="etiquetas"
                    stroke="var(--color-etiquetas)"
                    fill="url(#trendEtiquetas)"
                    strokeWidth={2.5}
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <EmptyChartState message="Ainda não há histórico suficiente para montar o gráfico dos últimos dias." />
            )}
          </DashboardPanel>

          <DashboardPanel
            title="Pedidos por etapa"
            description="Resumo objetivo da operação visível neste dashboard."
          >
            {bucketTotals.some((bucket) => bucket.total > 0) ? (
              <div className="grid gap-5 lg:grid-cols-[0.92fr_1.08fr]">
                <div className="rounded-[24px] border border-[#edf1f7] bg-[#f8fbff] p-4">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#94a3b8]">
                        Total monitorado
                      </p>
                      <p className="mt-1 text-[30px] font-semibold tracking-[-0.03em] text-[#111827]">
                        {bucketGrandTotal.toLocaleString("pt-BR")}
                      </p>
                    </div>
                    {topBucket && (
                      <Badge variant="outline" className="rounded-full border-[#dbe7ff] bg-white text-[#2563eb]">
                        Maior volume: {topBucket.label}
                      </Badge>
                    )}
                  </div>

                  <div className="relative h-[230px]">
                    <ChartContainer className="h-full w-full aspect-auto" config={BUCKET_CHART_CONFIG}>
                      <PieChart>
                        <ChartTooltip content={<ChartTooltipContent hideIndicator />} />
                        <Pie
                          data={bucketTotals}
                          dataKey="total"
                          nameKey="key"
                          innerRadius={62}
                          outerRadius={96}
                          paddingAngle={3}
                        >
                          {bucketTotals.map((entry) => (
                            <Cell key={entry.key} fill={entry.color} />
                          ))}
                        </Pie>
                      </PieChart>
                    </ChartContainer>

                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <div className="rounded-full bg-white/92 px-5 py-3 text-center shadow-[0_6px_18px_rgba(15,23,42,0.08)]">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">
                          Pedidos
                        </p>
                        <p className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-[#111827]">
                          {bucketGrandTotal.toLocaleString("pt-BR")}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {bucketTotals.map((bucket) => {
                    const percentage =
                      bucketGrandTotal > 0 ? Math.round((bucket.total / bucketGrandTotal) * 100) : 0;

                    return (
                      <div
                        key={bucket.key}
                        className="rounded-[20px] border border-[#edf1f7] bg-[#f8fbff] p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <span
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: bucket.color }}
                            />
                            <span className="font-medium text-[#22304a]">{bucket.label}</span>
                          </div>
                          <span className="text-base font-semibold text-[#22304a]">
                            {bucket.total.toLocaleString("pt-BR")}
                          </span>
                        </div>
                        <div className="mt-3 h-2 rounded-full bg-[#e9eef8]">
                          <div
                            className="h-2 rounded-full"
                            style={{
                              width: `${Math.min(percentage, 100)}%`,
                              backgroundColor: bucket.color,
                            }}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-3 text-xs text-[#6b7280]">
                          <span>{percentage}% do total monitorado</span>
                          <span>{bucket.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <EmptyChartState message="Os buckets operacionais ainda não têm volume suficiente para gerar gráfico." />
            )}
          </DashboardPanel>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <DashboardPanel
            title="Volume por depósito"
            description="Comparativo entre volume total e volume já pronto para impressão."
          >
            {depositVolumeData.length > 0 ? (
              <ChartContainer
                className="h-[320px] w-full aspect-auto"
                config={DEPOSIT_VOLUME_CHART_CONFIG}
              >
                <BarChart
                  data={depositVolumeData}
                  layout="vertical"
                  margin={{ left: 18, right: 18, top: 8, bottom: 8 }}
                  barCategoryGap={14}
                >
                  <CartesianGrid horizontal={false} strokeDasharray="4 4" />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                  <YAxis
                    type="category"
                    dataKey="deposit"
                    tickLine={false}
                    axisLine={false}
                    width={120}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent indicator="line" />}
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar
                    dataKey="pedidos"
                    fill="var(--color-pedidos)"
                    radius={[0, 8, 8, 0]}
                  />
                  <Bar
                    dataKey="etiquetas"
                    fill="var(--color-etiquetas)"
                    radius={[0, 8, 8, 0]}
                  />
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyChartState message="Nenhum depósito com pedidos visíveis para este usuário." />
            )}
          </DashboardPanel>

          <DashboardPanel
            title="Radar operacional"
            description="Leituras rápidas para tomada de decisão no dia."
            action={
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => navigate("/mercado-livre")}
              >
                Abrir pedidos
              </Button>
            }
          >
            <div className="space-y-4">
              {operationalSummary.map((item) => (
                <div
                  key={item.label}
                  className="rounded-[20px] border border-[#edf1f7] bg-[#f8fbff] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className={`h-3 w-3 rounded-full ${item.color}`} />
                      <span className="font-medium text-[#22304a]">{item.label}</span>
                    </div>
                    <span className="text-xl font-semibold tracking-[-0.02em] text-[#111827]">
                      {item.value}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-[#6b7280]">{item.helper}</p>
                </div>
              ))}

              <div className="rounded-[22px] border border-[#e6ebf4] bg-white p-4">
                <div className="flex items-center gap-2 text-sm font-semibold text-[#22304a]">
                  <CheckCircle className="h-4 w-4 text-[#2563eb]" />
                  Regra ativa de geração
                </div>
                <p className="mt-2 text-sm leading-6 text-[#6b7280]">
                  O sistema libera impressão quando o pedido está pago, o envio está em
                  <span className="font-semibold text-[#22304a]"> ready_to_ship</span> e não
                  ficou travado em <span className="font-semibold text-[#22304a]">invoice_pending</span>.
                </p>
              </div>
            </div>
          </DashboardPanel>
        </div>

        <DashboardPanel
          title="Fila recente de operação"
          description="Pedidos mais relevantes para acompanhamento rápido, priorizados por impressão, NF-e e revisão."
          action={
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => navigate("/mercado-livre")}
            >
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
                const deposit = getDepositInfo(order);
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
                        <span className="inline-flex rounded-full bg-[#fff159] px-2 py-0.5 font-semibold text-[#333333]">
                          ML
                        </span>
                        <span className="font-semibold text-[#22304a]">#{order.sale_number}</span>
                        <span>{formatSaleMoment(order.sale_date)}</span>
                      </div>
                      <div>
                        <p className="text-base font-semibold text-[#172554]">
                          {order.item_title || "Produto sem título"}
                        </p>
                        <p className="mt-1 text-sm text-[#6b7280]">
                          {order.buyer_name || order.buyer_nickname || "Comprador não identificado"}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">
                        Operação
                      </p>
                      <p className="text-sm font-medium text-[#22304a]">{deposit.displayLabel}</p>
                      <p className="text-sm text-[#6b7280]">{shipment.title}</p>
                    </div>

                    <div className="space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[#94a3b8]">
                        Valor
                      </p>
                      <p className="text-sm font-semibold text-[#22304a]">
                        {formatCurrency(typeof order.amount === "number" ? order.amount : 0)}
                      </p>
                      <p className="text-sm text-[#6b7280]">{order.quantity} un.</p>
                    </div>

                    <div className="flex items-center lg:justify-end">
                      <span
                        className={`inline-flex rounded-full border px-3 py-1.5 text-xs font-semibold ${statusBadgeClassName(statusTone)}`}
                      >
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
