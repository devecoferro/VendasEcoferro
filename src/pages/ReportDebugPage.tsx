import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  Bug,
  CheckCircle2,
  Circle,
  CirclePause,
  HelpCircle,
  ImagePlus,
  Lightbulb,
  Loader2,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  createDebugReport,
  deleteDebugReport,
  fileToDataUrl,
  getScreenshotUrl,
  listDebugReports,
  updateDebugReport,
  type DebugReport,
  type DebugReportPriority,
  type DebugReportStatus,
  type DebugReportType,
} from "@/services/debugReportsService";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<DebugReportType, { label: string; icon: typeof Bug; color: string }> = {
  bug: { label: "Bug / Falha", icon: Bug, color: "text-red-600 bg-red-50 ring-red-200" },
  suggestion: { label: "Sugestão / Melhoria", icon: Lightbulb, color: "text-amber-600 bg-amber-50 ring-amber-200" },
  question: { label: "Dúvida", icon: HelpCircle, color: "text-blue-600 bg-blue-50 ring-blue-200" },
};

const STATUS_LABELS: Record<DebugReportStatus, { label: string; icon: typeof Circle; color: string }> = {
  open: { label: "Aberto", icon: Circle, color: "text-blue-600 bg-blue-50" },
  in_progress: { label: "Em andamento", icon: CirclePause, color: "text-amber-600 bg-amber-50" },
  resolved: { label: "Resolvido", icon: CheckCircle2, color: "text-emerald-600 bg-emerald-50" },
  closed: { label: "Fechado", icon: X, color: "text-gray-600 bg-gray-100" },
};

const PRIORITY_LABELS: Record<DebugReportPriority, { label: string; color: string }> = {
  low: { label: "Baixa", color: "text-gray-600 bg-gray-100" },
  medium: { label: "Média", color: "text-amber-600 bg-amber-50" },
  high: { label: "Alta", color: "text-red-600 bg-red-50" },
};

const SCREEN_OPTIONS = [
  "Dashboard",
  "EcoFerro (Mercado Livre)",
  "Conferência Venda",
  "Histórico",
  "Estoque",
  "Conferência (PDF)",
  "Login",
  "Manual",
  "Usuários (Admin)",
  "Diagnóstico ML (Admin)",
  "Outra",
];

export default function ReportDebugPage() {
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  const [reports, setReports] = useState<DebugReport[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // Form state
  const [type, setType] = useState<DebugReportType>("bug");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [screen, setScreen] = useState<string>("");
  const [priority, setPriority] = useState<DebugReportPriority>("medium");
  const [screenshotDataUrls, setScreenshotDataUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // List filter (admin)
  const [statusFilter, setStatusFilter] = useState<"all" | DebugReportStatus>(
    "all"
  );
  const [typeFilter, setTypeFilter] = useState<"all" | DebugReportType>("all");

  const loadReports = async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const { reports: all } = await listDebugReports({
        status: statusFilter === "all" ? undefined : statusFilter,
        type: typeFilter === "all" ? undefined : typeFilter,
      });
      setReports(all);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Erro ao carregar");
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    void loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, typeFilter]);

  async function handleAddScreenshots(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const added: string[] = [];
    for (const file of files) {
      try {
        const url = await fileToDataUrl(file);
        added.push(url);
      } catch (err) {
        toast({
          title: "Imagem não aceita",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        });
      }
    }
    if (added.length) {
      setScreenshotDataUrls((prev) => [...prev, ...added]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeScreenshot(idx: number) {
    setScreenshotDataUrls((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSubmit() {
    if (!title.trim() || !description.trim()) {
      toast({
        title: "Preencha título e descrição",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      await createDebugReport({
        type,
        title: title.trim(),
        description: description.trim(),
        screen: screen || null,
        priority,
        screenshots: screenshotDataUrls,
      });
      toast({
        title: "Report enviado!",
        description: "Obrigado pela contribuição. O time vai avaliar em breve.",
      });
      // Reset form
      setType("bug");
      setTitle("");
      setDescription("");
      setScreen("");
      setPriority("medium");
      setScreenshotDataUrls([]);
      await loadReports();
    } catch (err) {
      toast({
        title: "Falha ao enviar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateStatus(id: string, status: DebugReportStatus) {
    try {
      await updateDebugReport(id, { status });
      toast({ title: "Status atualizado" });
      await loadReports();
    } catch (err) {
      toast({
        title: "Falha ao atualizar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Tem certeza que quer deletar este report?")) return;
    try {
      await deleteDebugReport(id);
      toast({ title: "Report deletado" });
      await loadReports();
    } catch (err) {
      toast({
        title: "Falha ao deletar",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6 sm:px-6 lg:flex-row lg:gap-8">
        {/* ─── Form de novo report (coluna esquerda) ─────────────── */}
        <section className="lg:w-[420px] lg:flex-shrink-0">
          <div className="rounded-2xl border border-[#e6e6e6] bg-white p-5 shadow-sm lg:sticky lg:top-6">
            <header className="mb-4 flex items-center gap-2 border-b border-[#e6e6e6] pb-3">
              <Bug className="h-5 w-5 text-[#3483fa]" />
              <h2 className="text-[16px] font-bold text-[#333]">
                Enviar novo report
              </h2>
            </header>

            <div className="space-y-4">
              {/* Tipo */}
              <div className="space-y-1.5">
                <Label className="text-[13px] font-semibold">Tipo *</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.entries(TYPE_LABELS) as Array<
                    [DebugReportType, (typeof TYPE_LABELS)[DebugReportType]]
                  >).map(([key, cfg]) => {
                    const Icon = cfg.icon;
                    const active = type === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setType(key)}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-lg border p-2 text-[11px] font-medium transition",
                          active
                            ? `${cfg.color} ring-2 ring-inset border-transparent`
                            : "border-[#e6e6e6] bg-white text-[#666] hover:bg-[#f9fafb]"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {cfg.label.split(" / ")[0]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Título */}
              <div className="space-y-1.5">
                <Label htmlFor="report-title" className="text-[13px] font-semibold">
                  Título *
                </Label>
                <Input
                  id="report-title"
                  placeholder={
                    type === "bug"
                      ? "Ex: Botão Imprimir não baixa PDF"
                      : type === "suggestion"
                        ? "Ex: Adicionar atalho Ctrl+P"
                        : "Ex: Como reimprimir etiqueta antiga?"
                  }
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                  className="text-[14px]"
                />
                <p className="text-[11px] text-[#999]">{title.length}/200</p>
              </div>

              {/* Tela */}
              <div className="space-y-1.5">
                <Label className="text-[13px] font-semibold">
                  Em qual tela?
                </Label>
                <Select value={screen || undefined} onValueChange={setScreen}>
                  <SelectTrigger className="text-[14px]">
                    <SelectValue placeholder="(opcional) Selecione a tela" />
                  </SelectTrigger>
                  <SelectContent>
                    {SCREEN_OPTIONS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Prioridade */}
              <div className="space-y-1.5">
                <Label className="text-[13px] font-semibold">Prioridade</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.entries(PRIORITY_LABELS) as Array<
                    [DebugReportPriority, (typeof PRIORITY_LABELS)[DebugReportPriority]]
                  >).map(([key, cfg]) => {
                    const active = priority === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setPriority(key)}
                        className={cn(
                          "rounded-lg border p-2 text-[12px] font-medium transition",
                          active
                            ? `${cfg.color} ring-2 ring-inset border-transparent`
                            : "border-[#e6e6e6] bg-white text-[#666] hover:bg-[#f9fafb]"
                        )}
                      >
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Descrição */}
              <div className="space-y-1.5">
                <Label htmlFor="report-desc" className="text-[13px] font-semibold">
                  Descrição *
                </Label>
                <Textarea
                  id="report-desc"
                  placeholder="Descreva o que aconteceu, o que você esperava, e como reproduzir o problema (se aplicável)."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={5000}
                  rows={5}
                  className="text-[14px]"
                />
                <p className="text-[11px] text-[#999]">
                  {description.length}/5000
                </p>
              </div>

              {/* Screenshots */}
              <div className="space-y-1.5">
                <Label className="text-[13px] font-semibold">
                  Anexar prints (opcional — máx 2MB cada)
                </Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleAddScreenshots}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#d1d5db] bg-[#f9fafb] p-3 text-[13px] font-medium text-[#666] transition hover:border-[#3483fa] hover:bg-[#eef4ff] hover:text-[#3483fa]"
                >
                  <ImagePlus className="h-4 w-4" />
                  Adicionar imagem(ns)
                </button>
                {screenshotDataUrls.length > 0 && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {screenshotDataUrls.map((url, idx) => (
                      <div
                        key={idx}
                        className="group relative aspect-square overflow-hidden rounded-lg border border-[#e6e6e6] bg-[#f9fafb]"
                      >
                        <img
                          src={url}
                          alt={`Screenshot ${idx + 1}`}
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removeScreenshot(idx)}
                          className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white opacity-0 transition group-hover:opacity-100"
                          aria-label="Remover"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full"
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Enviando…
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Enviar report
                  </>
                )}
              </Button>
            </div>
          </div>
        </section>

        {/* ─── Lista de reports (coluna direita) ─────────────────── */}
        <main className="flex-1 min-w-0">
          <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h1 className="text-[22px] font-bold text-[#333]">
                Reports {isAdmin ? "(todos)" : "(meus)"}
              </h1>
              <p className="text-[13px] text-[#666]">
                {isAdmin
                  ? "Admin: vê reports de todos os usuários."
                  : "Você vê apenas os reports que enviou."}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}
              >
                <SelectTrigger className="h-9 w-[160px] text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos status</SelectItem>
                  <SelectItem value="open">Abertos</SelectItem>
                  <SelectItem value="in_progress">Em andamento</SelectItem>
                  <SelectItem value="resolved">Resolvidos</SelectItem>
                  <SelectItem value="closed">Fechados</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={typeFilter}
                onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}
              >
                <SelectTrigger className="h-9 w-[160px] text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos tipos</SelectItem>
                  <SelectItem value="bug">Bugs</SelectItem>
                  <SelectItem value="suggestion">Sugestões</SelectItem>
                  <SelectItem value="question">Dúvidas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {loadingList && (
            <div className="rounded-lg border border-[#e6e6e6] bg-white p-8 text-center text-[14px] text-[#666]">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-[#3483fa]" />
              Carregando reports…
            </div>
          )}

          {listError && !loadingList && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-4 text-[14px] text-red-700">
              <AlertCircle className="h-4 w-4" />
              {listError}
            </div>
          )}

          {!loadingList && !listError && reports.length === 0 && (
            <div className="rounded-lg border border-dashed border-[#d1d5db] bg-[#f9fafb] p-10 text-center text-[14px] text-[#666]">
              Nenhum report ainda. Use o formulário ao lado pra enviar o primeiro.
            </div>
          )}

          {!loadingList && reports.length > 0 && (
            <div className="space-y-3">
              {reports.map((r) => {
                const typeCfg = TYPE_LABELS[r.type];
                const statusCfg = STATUS_LABELS[r.status];
                const priorityCfg = PRIORITY_LABELS[r.priority];
                const TypeIcon = typeCfg.icon;
                const StatusIcon = statusCfg.icon;

                return (
                  <div
                    key={r.id}
                    className="rounded-xl border border-[#e6e6e6] bg-white p-4 shadow-sm"
                  >
                    <header className="mb-3 flex flex-wrap items-start gap-3">
                      <div
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
                          typeCfg.color
                        )}
                      >
                        <TypeIcon className="h-3 w-3" />
                        {typeCfg.label}
                      </div>
                      <div
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                          statusCfg.color
                        )}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {statusCfg.label}
                      </div>
                      <div
                        className={cn(
                          "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                          priorityCfg.color
                        )}
                      >
                        {priorityCfg.label}
                      </div>
                      {r.screen && (
                        <div className="inline-flex items-center rounded-full bg-[#f3f4f6] px-2.5 py-0.5 text-[11px] font-medium text-[#555]">
                          📍 {r.screen}
                        </div>
                      )}

                      <div className="ml-auto text-[11px] text-[#999]">
                        {new Date(r.created_at).toLocaleString("pt-BR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </header>

                    <h3 className="mb-1.5 text-[15px] font-semibold text-[#333]">
                      {r.title}
                    </h3>
                    <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#555]">
                      {r.description}
                    </p>

                    {r.screenshots.length > 0 && (
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {r.screenshots.map((filename) => (
                          <a
                            key={filename}
                            href={getScreenshotUrl(filename)}
                            target="_blank"
                            rel="noreferrer"
                            className="block aspect-square overflow-hidden rounded-lg border border-[#e6e6e6] bg-[#f9fafb] transition hover:ring-2 hover:ring-[#3483fa]"
                          >
                            <img
                              src={getScreenshotUrl(filename)}
                              alt="screenshot"
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          </a>
                        ))}
                      </div>
                    )}

                    {r.admin_notes && (
                      <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-[13px] text-blue-900">
                        <strong>Nota do admin:</strong> {r.admin_notes}
                      </div>
                    )}

                    <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#f3f4f6] pt-3 text-[11px] text-[#666]">
                      <span>Por <strong>{r.username}</strong></span>

                      {isAdmin && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Select
                            value={r.status}
                            onValueChange={(v) =>
                              handleUpdateStatus(r.id, v as DebugReportStatus)
                            }
                          >
                            <SelectTrigger className="h-7 w-[130px] text-[11px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Aberto</SelectItem>
                              <SelectItem value="in_progress">
                                Em andamento
                              </SelectItem>
                              <SelectItem value="resolved">Resolvido</SelectItem>
                              <SelectItem value="closed">Fechado</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(r.id)}
                            className="h-7 text-red-600 hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </footer>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </AppLayout>
  );
}
