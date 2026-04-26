// Dashboard de saúde admin — mostra sync status, DB, cache, audit recente.
// Consome /api/admin/health e /api/admin/audit-log.

import { useEffect, useState, useCallback } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Activity, Database, HardDrive, History } from "lucide-react";

interface HealthCounts {
  ml_orders?: number;
  ml_stock?: number;
  nfe_documents?: number;
  app_sessions_active?: number;
  app_audit_log?: number;
}

interface HealthLastSync {
  at: string | null;
  seller_id: string | null;
  age_seconds: number | null;
}

interface HealthDbSize {
  pages: number;
  page_size: number;
  bytes: number;
  mb: string;
}

interface HealthRuntime {
  uptime_seconds: number;
  memory_mb: {
    rss: string;
    heap_used: string;
    heap_total: string;
    external?: string;
  };
  cpu_seconds?: {
    user: string;
    system: string;
  };
  node_version: string;
}

interface HealthHost {
  load_avg: [number, number, number];
  memory_mb: {
    total: string;
    free: string;
    used: string;
    used_pct: string;
  };
  cpu_count: number;
  cpu_model: string;
  platform: string;
  hostname: string;
}

interface ScrapeStatRow {
  scope: string;
  total: number;
  sucessos: number;
  success_rate: number | null;
  avg_elapsed_ms: number | null;
  last_run_at: string | null;
}

interface HealthAuditRow {
  id: number;
  username: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  created_at: string;
}

interface HealthResponse {
  generated_at: string;
  counts: HealthCounts;
  last_sync: HealthLastSync | null;
  db_size: HealthDbSize | null;
  runtime: HealthRuntime;
  host?: HealthHost;
  scrape_stats?: ScrapeStatRow[] | null;
  recent_audit: HealthAuditRow[];
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return `${d}d ${h}h`;
}

export default function AdminHealthPage() {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/health", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Refresh 5s — usuario quer monitorar carga em tempo real (CPU/mem)
    const interval = window.setInterval(load, 5_000);
    return () => window.clearInterval(interval);
  }, [load]);

  return (
    <AppLayout>
      <div className="max-w-6xl mx-auto space-y-6 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              Saúde do Sistema
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Atualiza a cada 5s. Admin-only.
            </p>
          </div>
          <Button onClick={load} disabled={loading} variant="outline" size="sm">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            <span className="ml-2">Atualizar</span>
          </Button>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            Erro: {error}
          </div>
        )}

        {data && (
          <>
            {/* Contadores principais */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <MetricCard label="Pedidos ML" value={data.counts.ml_orders} />
              <MetricCard label="Itens estoque" value={data.counts.ml_stock} />
              <MetricCard label="NF-e emitidas" value={data.counts.nfe_documents} />
              <MetricCard label="Sessões ativas" value={data.counts.app_sessions_active} />
              <MetricCard label="Eventos audit" value={data.counts.app_audit_log} />
            </div>

            {/* Sync + DB + Runtime */}
            <div className="grid gap-3 lg:grid-cols-3">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <RefreshCw className="h-4 w-4 text-blue-500" />
                  Último sync ML
                </div>
                {data.last_sync?.at ? (
                  <>
                    <div className="text-xs text-muted-foreground mb-1">
                      {new Date(data.last_sync.at).toLocaleString("pt-BR")}
                    </div>
                    <SyncAgeBadge seconds={data.last_sync.age_seconds} />
                    <div className="text-xs text-muted-foreground mt-2">
                      Seller: {data.last_sync.seller_id || "—"}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">Sem sync</div>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <div className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <Database className="h-4 w-4 text-purple-500" />
                  Tamanho DB
                </div>
                {data.db_size ? (
                  <>
                    <div className="text-2xl font-bold">{data.db_size.mb} MB</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {data.db_size.pages.toLocaleString("pt-BR")} pages
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">—</div>
                )}
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <div className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <HardDrive className="h-4 w-4 text-green-500" />
                  Runtime
                </div>
                <div className="text-xs space-y-1">
                  <div>Uptime: <b>{formatDuration(data.runtime.uptime_seconds)}</b></div>
                  <div>RSS: <b>{data.runtime.memory_mb.rss} MB</b></div>
                  <div>Heap: <b>{data.runtime.memory_mb.heap_used} / {data.runtime.memory_mb.heap_total} MB</b></div>
                  <div>Node: <b>{data.runtime.node_version}</b></div>
                </div>
              </div>
            </div>

            {/* Recursos do Sistema (Host + scrape stats) */}
            {data.host && (
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <Activity className="h-4 w-4 text-red-500" />
                  Recursos do sistema (refresh 5s)
                </div>
                <div className="grid gap-4 md:grid-cols-3 text-sm">
                  {/* Load average */}
                  <div className="rounded border border-border bg-background p-3">
                    <div className="text-xs text-muted-foreground mb-1">Load average</div>
                    <div className="text-2xl font-bold">
                      {data.host.load_avg[0].toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      5min: {data.host.load_avg[1].toFixed(2)} • 15min: {data.host.load_avg[2].toFixed(2)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {data.host.cpu_count} core(s)
                      {data.host.load_avg[0] > data.host.cpu_count ? (
                        <span className="ml-2 text-red-600 font-semibold">⚠ saturado</span>
                      ) : data.host.load_avg[0] > data.host.cpu_count * 0.7 ? (
                        <span className="ml-2 text-orange-600 font-semibold">alto</span>
                      ) : (
                        <span className="ml-2 text-green-600 font-semibold">ok</span>
                      )}
                    </div>
                  </div>

                  {/* Memory host */}
                  <div className="rounded border border-border bg-background p-3">
                    <div className="text-xs text-muted-foreground mb-1">Memória do host</div>
                    <div className="text-2xl font-bold">
                      {data.host.memory_mb.used_pct}%
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {(Number(data.host.memory_mb.used) / 1024).toFixed(1)} / {(Number(data.host.memory_mb.total) / 1024).toFixed(1)} GB
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full ${
                          Number(data.host.memory_mb.used_pct) > 85
                            ? "bg-red-500"
                            : Number(data.host.memory_mb.used_pct) > 70
                              ? "bg-orange-500"
                              : "bg-green-500"
                        }`}
                        style={{ width: `${data.host.memory_mb.used_pct}%` }}
                      />
                    </div>
                  </div>

                  {/* Process Node memory */}
                  <div className="rounded border border-border bg-background p-3">
                    <div className="text-xs text-muted-foreground mb-1">Nosso app (node)</div>
                    <div className="text-2xl font-bold">
                      {data.runtime.memory_mb.rss} MB
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Heap: {data.runtime.memory_mb.heap_used}/{data.runtime.memory_mb.heap_total} MB
                    </div>
                    {data.runtime.cpu_seconds && (
                      <div className="text-xs text-muted-foreground mt-1">
                        CPU acumulada: user {data.runtime.cpu_seconds.user}s + sys {data.runtime.cpu_seconds.system}s
                      </div>
                    )}
                  </div>
                </div>

                {/* Host meta */}
                <div className="mt-3 text-xs text-muted-foreground">
                  Host: {data.host.hostname} • {data.host.platform} • {data.host.cpu_model}
                </div>
              </div>
            )}

            {/* Scrape stats (telemetria) */}
            {Array.isArray(data.scrape_stats) && data.scrape_stats.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="text-sm font-semibold flex items-center gap-2 mb-3">
                  <Activity className="h-4 w-4 text-blue-500" />
                  Scraper Seller Center — últimas 24h
                </div>
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th className="text-left py-2">Scope</th>
                      <th className="text-right py-2">Total</th>
                      <th className="text-right py-2">Sucessos</th>
                      <th className="text-right py-2">Taxa</th>
                      <th className="text-right py-2">Tempo médio</th>
                      <th className="text-left py-2">Última</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.scrape_stats.map((row) => {
                      const rate = row.success_rate ?? 0;
                      const rateColor =
                        rate >= 0.9 ? "text-green-600" : rate >= 0.7 ? "text-orange-600" : "text-red-600";
                      return (
                        <tr key={row.scope} className="border-b last:border-0">
                          <td className="py-1.5 font-mono">{row.scope}</td>
                          <td className="py-1.5 text-right">{row.total}</td>
                          <td className="py-1.5 text-right">{row.sucessos}</td>
                          <td className={`py-1.5 text-right font-semibold ${rateColor}`}>
                            {rate != null ? `${(rate * 100).toFixed(0)}%` : "—"}
                          </td>
                          <td className="py-1.5 text-right">
                            {row.avg_elapsed_ms ? `${(row.avg_elapsed_ms / 1000).toFixed(1)}s` : "—"}
                          </td>
                          <td className="py-1.5 text-xs text-muted-foreground">
                            {row.last_run_at
                              ? new Date(row.last_run_at).toLocaleTimeString("pt-BR")
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Audit recente */}
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="text-sm font-semibold flex items-center gap-2 mb-3">
                <History className="h-4 w-4 text-orange-500" />
                Ações recentes (audit log)
              </div>
              {data.recent_audit.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhum evento ainda.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr className="border-b">
                      <th className="text-left py-2">Quando</th>
                      <th className="text-left py-2">Usuário</th>
                      <th className="text-left py-2">Ação</th>
                      <th className="text-left py-2">Alvo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_audit.map((row) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="py-1.5">
                          {new Date(row.created_at).toLocaleString("pt-BR", {
                            day: "2-digit",
                            month: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="py-1.5">{row.username || "—"}</td>
                        <td className="py-1.5">
                          <code className="text-xs px-1 rounded bg-muted">{row.action}</code>
                        </td>
                        <td className="py-1.5 text-muted-foreground">
                          {row.target_type ? `${row.target_type}:` : ""}
                          {row.target_id || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="text-xs text-muted-foreground text-right">
              Gerado em {new Date(data.generated_at).toLocaleString("pt-BR")}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function MetricCard({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold mt-1">
        {value != null ? value.toLocaleString("pt-BR") : "—"}
      </div>
    </div>
  );
}

function SyncAgeBadge({ seconds }: { seconds: number | null }) {
  if (seconds == null) return <Badge variant="secondary">—</Badge>;
  if (seconds < 60) return <Badge className="bg-green-100 text-green-700 border-green-300">há {seconds}s — fresh</Badge>;
  if (seconds < 300) return <Badge className="bg-blue-100 text-blue-700 border-blue-300">há {formatDuration(seconds)}</Badge>;
  if (seconds < 3600) return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-300">há {formatDuration(seconds)}</Badge>;
  return <Badge variant="destructive">STALE — {formatDuration(seconds)}</Badge>;
}
