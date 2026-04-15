import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  Heart,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import {
  CHIP_BUCKET_LABELS,
  CHIP_BUCKET_ORDER,
  fetchChipDiff,
  fetchChipDriftHistory,
  fetchOrdersDivergence,
  triggerAutoHeal,
  type AutoHealResponse,
  type ChipBucketCounts,
  type ChipCountDiff,
  type ChipDriftHistoryEntry,
  type OrdersDivergenceResponse,
} from "@/services/mlDiagnosticsService";

const DEFAULT_INTERVAL_SECONDS = 30;
const MIN_INTERVAL_SECONDS = 10;
const MAX_INTERVAL_SECONDS = 600;
const DEFAULT_TOLERANCE = 2;

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function signLabel(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : String(value);
}

function diffToneClass(value: number, tolerance: number): string {
  const abs = Math.abs(value);
  if (abs === 0) return "text-emerald-600";
  if (abs <= tolerance) return "text-amber-600";
  return "text-red-600";
}

function StatusBadge({ status }: { status: ChipCountDiff["status"] }) {
  if (status === "IN_SYNC") {
    return (
      <Badge className="bg-emerald-100 text-emerald-800 border border-emerald-200 gap-1">
        <Check className="h-3 w-3" /> Sincronizado
      </Badge>
    );
  }
  if (status === "DRIFT_DETECTED") {
    return (
      <Badge className="bg-red-100 text-red-800 border border-red-200 gap-1">
        <XCircle className="h-3 w-3" /> Drift detectado
      </Badge>
    );
  }
  return (
    <Badge className="bg-slate-100 text-slate-700 border border-slate-200 gap-1">
      <WifiOff className="h-3 w-3" /> ML API indisponível
    </Badge>
  );
}

function ChipCard({
  bucket,
  ml,
  app,
  diff,
  tolerance,
}: {
  bucket: keyof ChipBucketCounts;
  ml: number;
  app: number;
  diff: number;
  tolerance: number;
}) {
  const toneClass = diffToneClass(diff, tolerance);
  const label = CHIP_BUCKET_LABELS[bucket];

  return (
    <Card className="border-[#e5e5e5] shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-[#666]">{label}</CardTitle>
          <span className={`text-lg font-bold ${toneClass}`}>{signLabel(diff)}</span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md bg-[#eef4ff] px-2 py-1.5">
            <div className="text-[11px] uppercase tracking-wide text-[#2968c8]">ML</div>
            <div className="text-lg font-semibold text-[#2968c8]">{ml}</div>
          </div>
          <div className="rounded-md bg-[#f8f8f8] px-2 py-1.5">
            <div className="text-[11px] uppercase tracking-wide text-[#555]">App</div>
            <div className="text-lg font-semibold text-[#333]">{app}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MLDiagnosticsPage() {
  const [result, setResult] = useState<ChipCountDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [intervalSeconds, setIntervalSeconds] = useState(DEFAULT_INTERVAL_SECONDS);
  const [tolerance, setTolerance] = useState(DEFAULT_TOLERANCE);
  const [depositKey, setDepositKey] = useState("");
  const [logisticType, setLogisticType] = useState("");

  const [history, setHistory] = useState<ChipDriftHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [healing, setHealing] = useState(false);
  const [healResult, setHealResult] = useState<AutoHealResponse | null>(null);

  const [ordersDiff, setOrdersDiff] = useState<OrdersDivergenceResponse | null>(null);
  const [ordersDiffLoading, setOrdersDiffLoading] = useState(false);

  const intervalRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const activeFilters = useMemo(() => {
    const filters: Record<string, string> = {};
    if (depositKey.trim()) filters.deposit_key = depositKey.trim();
    if (logisticType.trim()) filters.logistic_type = logisticType.trim();
    return filters;
  }, [depositKey, logisticType]);

  const runVerify = useCallback(
    async (options: { save?: boolean; fresh?: boolean } = {}) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        setLoading(true);
        setError(null);
        const diff = await fetchChipDiff({
          tolerance,
          filters: activeFilters,
          save: options.save,
          fresh: options.fresh,
          includeBreakdown: true,
        });
        if (controller.signal.aborted) return;
        setResult(diff);
      } catch (err) {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "Falha desconhecida";
        setError(message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [tolerance, activeFilters]
  );

  const loadHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const res = await fetchChipDriftHistory(50);
      setHistory(res.history || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao carregar historico";
      toast.error(message);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void runVerify();
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-refresh interval
  useEffect(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (!autoRefresh) return;
    intervalRef.current = window.setInterval(() => {
      void runVerify();
    }, intervalSeconds * 1000);
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, intervalSeconds, runVerify]);

  const handleSaveSnapshot = useCallback(async () => {
    try {
      setSaving(true);
      await runVerify({ save: true });
      await loadHistory();
      toast.success("Snapshot salvo no historico.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(false);
    }
  }, [runVerify, loadHistory]);

  const handleAutoHeal = useCallback(async () => {
    try {
      setHealing(true);
      setHealResult(null);
      toast.info("Forçando refresh dos pedidos ativos...");
      const heal = await triggerAutoHeal({ tolerance });
      setHealResult(heal);
      if (heal.after) setResult(heal.after);
      if (heal.healed) {
        toast.success(
          heal.reason === "ALREADY_IN_SYNC"
            ? "Já estava sincronizado."
            : `Drift corrigido (${heal.refreshed_orders} pedidos refreshed)`
        );
      } else if (heal.reason === "ML_API_UNAVAILABLE") {
        toast.error("ML API indisponível — não foi possível verificar");
      } else if (heal.reason === "PARTIALLY_HEALED") {
        toast.warning(
          `Drift reduzido mas não zerou (${heal.before.max_abs_diff}→${heal.after?.max_abs_diff ?? "?"})`
        );
      } else {
        toast.error(
          `Drift persistente após refresh — provável bug de classificação (investigar pedidos divergentes)`
        );
      }
      await loadHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Auto-heal falhou");
    } finally {
      setHealing(false);
    }
  }, [tolerance, loadHistory]);

  const handleLoadOrdersDiff = useCallback(async () => {
    try {
      setOrdersDiffLoading(true);
      toast.info("Analisando pedidos divergentes — pode levar até 20s...");
      const diff = await fetchOrdersDivergence({ fresh: true, limit: 500 });
      setOrdersDiff(diff);
      if (diff.total_divergent === 0) {
        toast.success("Nenhum pedido divergente encontrado.");
      } else {
        toast.info(
          `${diff.total_divergent} pedido(s) divergente(s) em ${diff.patterns.length} padrão(ões).`
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao analisar");
    } finally {
      setOrdersDiffLoading(false);
    }
  }, []);

  const ts = result?.timestamp || null;

  return (
    <AppLayout>
      <div className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#222]">
              Diagnóstico de Chips ML
            </h1>
            <p className="mt-1 text-sm text-[#666]">
              Compara em tempo real os chips do dashboard com o Mercado Livre Seller Center.
              Divergência esperada: ≤ {tolerance} (gap natural entre medições).
            </p>
          </div>
          <div className="flex items-center gap-2">
            {result ? <StatusBadge status={result.status} /> : null}
            {autoRefresh ? (
              <Badge className="gap-1 border border-[#cde0ff] bg-[#eef4ff] text-[#2968c8]">
                <Wifi className="h-3 w-3" /> {intervalSeconds}s
              </Badge>
            ) : null}
          </div>
        </header>

        {/* ─── Controles ─── */}
        <Card className="border-[#e5e5e5]">
          <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-5">
            <div className="flex flex-col gap-1">
              <Label className="text-[12px] uppercase tracking-wide text-[#888]">
                Intervalo (s)
              </Label>
              <Input
                type="number"
                min={MIN_INTERVAL_SECONDS}
                max={MAX_INTERVAL_SECONDS}
                value={intervalSeconds}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    setIntervalSeconds(
                      Math.max(MIN_INTERVAL_SECONDS, Math.min(MAX_INTERVAL_SECONDS, n))
                    );
                  }
                }}
                disabled={!autoRefresh}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[12px] uppercase tracking-wide text-[#888]">
                Tolerância
              </Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={tolerance}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 0) setTolerance(n);
                }}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[12px] uppercase tracking-wide text-[#888]">
                Depósito
              </Label>
              <Input
                placeholder="ex: logistic:fulfillment"
                value={depositKey}
                onChange={(e) => setDepositKey(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[12px] uppercase tracking-wide text-[#888]">
                Tipo logístico
              </Label>
              <Input
                placeholder="fulfillment | cross_docking"
                value={logisticType}
                onChange={(e) => setLogisticType(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setAutoRefresh((prev) => !prev)}
              >
                {autoRefresh ? "Pausar" : "Retomar"}
              </Button>
              <Button
                className="flex-1 gap-1.5"
                onClick={() => void runVerify({ fresh: true })}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Atualizar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ─── Erro ─── */}
        {error ? (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="flex items-center gap-2 pt-6 text-red-800">
              <AlertCircle className="h-5 w-5" />
              <span className="text-sm">{error}</span>
            </CardContent>
          </Card>
        ) : null}

        {/* ─── Aviso de filtros ─── */}
        {result?.filter_applied && result.filter_warning ? (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="flex items-start gap-2 pt-6 text-amber-900">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="text-sm">
                <strong>Filtros aplicados no app, mas não no ML API:</strong>{" "}
                {result.filter_warning}
              </div>
            </CardContent>
          </Card>
        ) : null}

        {/* ─── Chips ─── */}
        {result && result.status !== "ML_API_UNAVAILABLE" ? (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {CHIP_BUCKET_ORDER.map((bucket) => (
              <ChipCard
                key={bucket}
                bucket={bucket}
                ml={result.ml_seller_center[bucket]}
                app={result.app_internal[bucket]}
                diff={result.diff[bucket]}
                tolerance={result.tolerance}
              />
            ))}
          </section>
        ) : null}

        {/* ─── Rodape resultado ─── */}
        {result ? (
          <Card className="border-[#e5e5e5]">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Último check</CardTitle>
                  <CardDescription>
                    {ts ? formatTimestamp(ts) : "—"} · max |diff| = {result.max_abs_diff}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={handleSaveSnapshot}
                    disabled={saving || result.status === "ML_API_UNAVAILABLE"}
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Salvar snapshot
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                    onClick={handleAutoHeal}
                    disabled={healing || result.status === "ML_API_UNAVAILABLE"}
                    title="Força refresh dos pedidos ativos e re-verifica — corrige drift de timing"
                  >
                    {healing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Heart className="h-3.5 w-3.5" />
                    )}
                    Forçar auto-heal
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50"
                    onClick={handleLoadOrdersDiff}
                    disabled={
                      ordersDiffLoading || result.status === "ML_API_UNAVAILABLE"
                    }
                    title="Lista os pedidos específicos que estão em buckets diferentes entre ML e app (lento, ~10-20s)"
                  >
                    {ordersDiffLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Search className="h-3.5 w-3.5" />
                    )}
                    Ver pedidos divergentes
                  </Button>
                </div>
              </div>
            </CardHeader>
            {Array.isArray(result.breakdown_by_deposit) &&
            result.breakdown_by_deposit.length > 0 ? (
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-[#888]">
                        <th className="border-b border-[#eee] pb-2">Depósito</th>
                        <th className="border-b border-[#eee] pb-2">Tipo</th>
                        {CHIP_BUCKET_ORDER.map((b) => (
                          <th
                            key={b}
                            className="border-b border-[#eee] pb-2 text-right"
                          >
                            {CHIP_BUCKET_LABELS[b]}
                          </th>
                        ))}
                        <th className="border-b border-[#eee] pb-2 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.breakdown_by_deposit
                        .filter((d) => d.total > 0)
                        .map((d) => (
                          <tr key={d.key} className="border-b border-[#f4f4f4]">
                            <td className="py-2 pr-3 font-medium text-[#333]">
                              {d.label}
                            </td>
                            <td className="py-2 pr-3 text-[#666]">{d.logistic_type}</td>
                            {CHIP_BUCKET_ORDER.map((b) => (
                              <td
                                key={b}
                                className="py-2 pr-3 text-right tabular-nums text-[#333]"
                              >
                                {d.counts[b] || 0}
                              </td>
                            ))}
                            <td className="py-2 text-right font-semibold tabular-nums text-[#222]">
                              {d.total}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            ) : null}
          </Card>
        ) : null}

        {/* ─── Resultado do Auto-Heal ─── */}
        {healResult ? (
          <Card
            className={
              healResult.healed
                ? "border-emerald-300 bg-emerald-50"
                : healResult.reason === "PARTIALLY_HEALED"
                  ? "border-amber-300 bg-amber-50"
                  : "border-red-300 bg-red-50"
            }
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Auto-heal: {
                  healResult.reason === "ALREADY_IN_SYNC" ? "Já sincronizado" :
                  healResult.reason === "RESOLVED_AFTER_REFRESH" ? "Drift resolvido" :
                  healResult.reason === "PARTIALLY_HEALED" ? "Parcialmente corrigido" :
                  healResult.reason === "PERSISTENT_CLASSIFICATION_BUG" ? "Drift persistente (bug de classificação)" :
                  "ML API indisponível"
                }
              </CardTitle>
              <CardDescription>
                {healResult.refreshed_orders > 0
                  ? `${healResult.refreshed_orders} pedidos re-fetched do ML. `
                  : ""}
                max |diff|: {healResult.before.max_abs_diff}
                {healResult.after ? ` → ${healResult.after.max_abs_diff}` : ""}
                {healResult.reason === "PERSISTENT_CLASSIFICATION_BUG" ? (
                  <span className="mt-1 block font-medium text-red-700">
                    Próximo passo: clique em "Ver pedidos divergentes" para
                    identificar exatamente quais pedidos estão em buckets
                    errados. Provável bug em classifyCrossDockingOrder ou classifyFulfillmentOrder.
                  </span>
                ) : null}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : null}

        {/* ─── Pedidos Divergentes ─── */}
        {ordersDiff ? (
          <Card className="border-[#e5e5e5]">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-base">
                    Pedidos divergentes ({ordersDiff.total_divergent})
                  </CardTitle>
                  <CardDescription>
                    {ordersDiff.ml_connections_succeeded}/{ordersDiff.ml_connections_queried}{" "}
                    conexão(ões) ML respondendo ·{" "}
                    {formatTimestamp(ordersDiff.timestamp)}
                    {ordersDiff.truncated ? " · lista truncada (500 primeiros)" : ""}
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={handleLoadOrdersDiff}
                  disabled={ordersDiffLoading}
                >
                  {ordersDiffLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Re-analisar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {ordersDiff.error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {ordersDiff.error}
                </div>
              ) : ordersDiff.total_divergent === 0 ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  Nenhum pedido divergente — app e ML classificam todos da mesma forma.
                </div>
              ) : (
                <>
                  {/* Padrões de misclassificação */}
                  {ordersDiff.patterns.length > 0 ? (
                    <div>
                      <div className="mb-2 text-[11px] uppercase tracking-wide text-[#888]">
                        Padrões de divergência (app → ML)
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {ordersDiff.patterns.map((p) => (
                          <Badge
                            key={p.pattern}
                            className="border border-amber-300 bg-amber-50 text-amber-800"
                          >
                            {p.pattern}: {p.count}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Tabela de pedidos */}
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] border-separate border-spacing-0 text-sm">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-[#888]">
                          <th className="border-b border-[#eee] pb-2 pr-3">Order ID</th>
                          <th className="border-b border-[#eee] pb-2 pr-3">App diz</th>
                          <th className="border-b border-[#eee] pb-2 pr-3">ML diz</th>
                          <th className="border-b border-[#eee] pb-2">Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ordersDiff.divergences.slice(0, 100).map((d) => (
                          <tr
                            key={d.order_id}
                            className="border-b border-[#f4f4f4]"
                          >
                            <td className="py-2 pr-3 font-mono text-[#333]">
                              {d.order_id}
                            </td>
                            <td className="py-2 pr-3">
                              {d.app_bucket ? (
                                <Badge className="border border-[#d0d7de] bg-[#f6f8fa] text-[#24292f]">
                                  {CHIP_BUCKET_LABELS[d.app_bucket]}
                                </Badge>
                              ) : (
                                <span className="text-[#999]">não encontrado</span>
                              )}
                            </td>
                            <td className="py-2 pr-3">
                              {d.ml_bucket ? (
                                <Badge className="border border-[#cde0ff] bg-[#eef4ff] text-[#2968c8]">
                                  {CHIP_BUCKET_LABELS[d.ml_bucket]}
                                </Badge>
                              ) : (
                                <span className="text-[#999]">não encontrado</span>
                              )}
                            </td>
                            <td className="py-2">
                              <a
                                href={`https://www.mercadolivre.com.br/vendas/${d.order_id}/detalhe`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#2968c8] hover:underline"
                              >
                                Ver no ML
                              </a>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {ordersDiff.divergences.length > 100 ? (
                      <div className="mt-2 text-[11px] text-[#888]">
                        Mostrando 100 de {ordersDiff.divergences.length} divergências.
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ) : null}

        {/* ─── Historico ─── */}
        <Card className="border-[#e5e5e5]">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">Histórico de drift</CardTitle>
                <CardDescription>
                  Snapshots persistidos (cron 30s — grava em mudanças + heartbeat 5min + saves manuais). Retenção: 30 dias.
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => void loadHistory()}
                disabled={historyLoading}
              >
                {historyLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Recarregar
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-[#888]">
                Nenhum snapshot ainda. O cron salva a cada 15 min (primeiro após ~90s do boot).
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-[#888]">
                      <th className="border-b border-[#eee] pb-2">Quando</th>
                      <th className="border-b border-[#eee] pb-2">Status</th>
                      <th className="border-b border-[#eee] pb-2 text-right">|Δ|</th>
                      <th className="border-b border-[#eee] pb-2 text-right">Hoje</th>
                      <th className="border-b border-[#eee] pb-2 text-right">Próximos</th>
                      <th className="border-b border-[#eee] pb-2 text-right">Trânsito</th>
                      <th className="border-b border-[#eee] pb-2 text-right">Finaliz.</th>
                      <th className="border-b border-[#eee] pb-2 text-right">Cancel.</th>
                      <th className="border-b border-[#eee] pb-2">Fonte</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row) => (
                      <tr key={row.id} className="border-b border-[#f4f4f4]">
                        <td className="py-1.5 pr-3 text-[#555] tabular-nums">
                          {formatTimestamp(row.captured_at)}
                        </td>
                        <td className="py-1.5 pr-3">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">
                          {row.max_abs_diff}
                        </td>
                        <td className={`py-1.5 pr-3 text-right tabular-nums ${diffToneClass(row.diff_today, tolerance)}`}>
                          {signLabel(row.diff_today)}
                        </td>
                        <td className={`py-1.5 pr-3 text-right tabular-nums ${diffToneClass(row.diff_upcoming, tolerance)}`}>
                          {signLabel(row.diff_upcoming)}
                        </td>
                        <td className={`py-1.5 pr-3 text-right tabular-nums ${diffToneClass(row.diff_in_transit, tolerance)}`}>
                          {signLabel(row.diff_in_transit)}
                        </td>
                        <td className={`py-1.5 pr-3 text-right tabular-nums ${diffToneClass(row.diff_finalized, tolerance)}`}>
                          {signLabel(row.diff_finalized)}
                        </td>
                        <td className={`py-1.5 pr-3 text-right tabular-nums ${diffToneClass(row.diff_cancelled, tolerance)}`}>
                          {signLabel(row.diff_cancelled)}
                        </td>
                        <td className="py-1.5 text-[#888] text-[12px]">
                          {row.source || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
