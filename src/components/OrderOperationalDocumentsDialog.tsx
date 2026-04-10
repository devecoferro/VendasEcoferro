import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  MLNFeResponse,
  MLOrder,
  MLOrderDocumentsResponse,
} from "@/services/mercadoLivreService";
import { toast } from "sonner";
import {
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Loader2,
  Printer,
  RefreshCcw,
  Tag,
} from "lucide-react";

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Ainda nao buscado";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString("pt-BR");
}

function openDocumentUrl(url: string | null | undefined) {
  if (!url) {
    toast.error("Documento ainda nao disponivel.");
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function downloadDocumentUrl(url: string | null | undefined) {
  if (!url) {
    toast.error("Documento ainda nao disponivel para download.");
    return;
  }

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.click();
}

function printDocumentUrl(url: string | null | undefined) {
  if (!url) {
    toast.error("Documento ainda nao disponivel para impressao.");
    return;
  }

  const printWindow = window.open(url, "_blank");
  if (!printWindow) {
    toast.error("Nao foi possivel abrir a janela de impressao.");
    return;
  }

  const tryPrint = () => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch {
      toast.info("Documento aberto em nova guia para impressao manual.");
    }
  };

  window.setTimeout(tryPrint, 1200);
}

function AvailabilityBadge({
  status,
}: {
  status: "available" | "partial" | "unavailable" | "error";
}) {
  const className =
    status === "available"
      ? "border-[#cde8d3] bg-[#eefcf1] text-[#1b7a33]"
      : status === "partial"
        ? "border-[#ffe4b5] bg-[#fff5df] text-[#b86900]"
        : status === "error"
          ? "border-[#ffd8dc] bg-[#fff1f3] text-[#c2415d]"
          : "border-[#e5e7eb] bg-[#f8fafc] text-[#64748b]";

  const label =
    status === "available"
      ? "Disponivel"
      : status === "partial"
        ? "Parcial"
        : status === "error"
          ? "Erro"
          : "Indisponivel";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function NFeStatusBadge({ status }: { status: string | null | undefined }) {
  const normalized = String(status || "pending_configuration").trim().toLowerCase();
  const tone =
    normalized === "authorized"
      ? "border-[#cde8d3] bg-[#eefcf1] text-[#1b7a33]"
      : normalized === "ready_to_emit"
        ? "border-[#d9e7ff] bg-[#eef4ff] text-[#2968c8]"
        : normalized === "blocked"
          ? "border-[#ffe4b5] bg-[#fff5df] text-[#b86900]"
        : normalized === "emitting"
          ? "border-[#ffe4b5] bg-[#fff5df] text-[#b86900]"
          : normalized === "managed_by_marketplace"
            ? "border-[#e8ddff] bg-[#f6f0ff] text-[#6c3eb8]"
            : normalized === "rejected" || normalized === "error"
              ? "border-[#ffd8dc] bg-[#fff1f3] text-[#c2415d]"
              : "border-[#e5e7eb] bg-[#f8fafc] text-[#64748b]";

  const labelByStatus: Record<string, string> = {
    ready_to_emit: "Pronta para emitir",
    blocked: "Bloqueada",
    emitting: "Emitindo",
    authorized: "Autorizada",
    synced_with_mercadolivre: "Sincronizada",
    pending_sync: "Pendente de sync",
    rejected: "Rejeitada",
    error: "Erro tecnico",
    pending_data: "Pendente de dados",
    pending_configuration: "Pendente de configuracao",
    managed_by_marketplace: "Gerida pelo ML",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${tone}`}
    >
      {labelByStatus[normalized] || normalized}
    </span>
  );
}

function NFeSyncBadge({ status }: { status: string | null | undefined }) {
  const normalized = String(status || "pending").trim().toLowerCase();
  const tone =
    normalized === "synced_with_mercadolivre"
      ? "border-[#cde8d3] bg-[#eefcf1] text-[#1b7a33]"
      : normalized === "managed_by_mercado_livre_faturador"
        ? "border-[#d9e7ff] bg-[#eef4ff] text-[#2968c8]"
        : "border-[#ffe4b5] bg-[#fff5df] text-[#b86900]";

  const labelByStatus: Record<string, string> = {
    synced_with_mercadolivre: "Refletida no Mercado Livre",
    managed_by_mercado_livre_faturador: "Gerida pelo Faturador do ML",
    pending_sync: "Pendente de sync",
    pending: "Pendente",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${tone}`}
    >
      {labelByStatus[normalized] || normalized}
    </span>
  );
}

function InfoGrid({
  items,
}: {
  items: Array<{ label: string; value: string | null | undefined; breakAll?: boolean }>;
}) {
  return (
    <div className="mt-4 grid gap-3 rounded-2xl bg-[#f8fafc] p-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#64748b]">
            {item.label}
          </p>
          <p
            className={`mt-2 text-sm text-[#22304a] ${item.breakAll ? "break-all" : ""}`}
          >
            {item.value || "-"}
          </p>
        </div>
      ))}
    </div>
  );
}

export function OrderOperationalDocumentsDialog({
  open,
  onOpenChange,
  order,
  documents,
  loading,
  error,
  onRefresh,
  onOpenInternalLabel,
  nfeResponse,
  nfeLoading,
  nfeError,
  onRefreshNFe,
  onGenerateNFe,
  onSyncNFe,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  order: MLOrder | null;
  documents: MLOrderDocumentsResponse | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenInternalLabel: () => void;
  nfeResponse: MLNFeResponse | null;
  nfeLoading: boolean;
  nfeError: string | null;
  onRefreshNFe: () => void;
  onGenerateNFe: () => void;
  onSyncNFe: () => void;
}) {
  const orderTitle = useMemo(() => {
    if (!order) return "Pedido";
    return `Pedido #${order.sale_number || order.order_id}`;
  }, [order]);

  const shippingLabel = documents?.shipping_label_external;
  const invoice = documents?.invoice_nfe_document;
  const nfe = nfeResponse?.nfe || null;
  const readiness = nfeResponse?.readiness || null;
  const readinessChecks = readiness?.checks || [];
  const blockingReasons = readiness?.blocking_reasons || [];
  const lastFetchedAt = shippingLabel?.fetched_at || invoice?.fetched_at || null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-auto sm:max-w-[920px]">
        <DialogHeader>
          <DialogTitle>Documentos complementares</DialogTitle>
          <DialogDescription>
            {orderTitle}. A etiqueta interna do sistema segue separada da etiqueta oficial,
            da NF-e gerada pelo programa e da consulta documental externa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-2xl border border-[#e6ebf4] bg-[#f8fbff] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-[#22304a]">
                  Etiqueta interna existente
                </p>
                <p className="mt-1 text-sm text-[#5f6b7a]">
                  Fluxo atual de conferencia e exportacao em PDF do EcoFerro, mantido sem
                  alteracao.
                </p>
              </div>
              <Button variant="outline" onClick={onOpenInternalLabel}>
                <Tag className="mr-2 h-4 w-4" />
                Abrir fluxo atual
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-[#5f6b7a]">
              Ultima atualizacao documental:{" "}
              <span className="font-medium text-[#22304a]">
                {formatTimestamp(lastFetchedAt)}
              </span>
            </div>
            <Button variant="outline" onClick={onRefresh} disabled={loading}>
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCcw className="mr-2 h-4 w-4" />
              )}
              Buscar documentos externos
            </Button>
          </div>

          {error && (
            <div className="rounded-2xl border border-[#ffd8dc] bg-[#fff1f3] px-4 py-3 text-sm text-[#c2415d]">
              {error}
            </div>
          )}

          {nfeError && (
            <div className="rounded-2xl border border-[#ffd8dc] bg-[#fff1f3] px-4 py-3 text-sm text-[#c2415d]">
              {nfeError}
            </div>
          )}

          <section className="rounded-2xl border border-[#d9e7ff] bg-[#f8fbff] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <FileCheck2 className="h-4 w-4 text-[#2968c8]" />
                  <p className="text-sm font-semibold text-[#22304a]">
                    NF-e gerada pelo programa
                  </p>
                </div>
                <p className="mt-1 text-sm text-[#5f6b7a]">
                  Emissao fiscal disparada pelo EcoFerro usando o Faturador do Mercado Livre
                  quando o pedido estiver apto.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <NFeStatusBadge status={readiness?.status || nfe?.status} />
                <NFeSyncBadge status={nfe?.ml_sync_status} />
              </div>
            </div>

            <InfoGrid
              items={[
                { label: "Origem", value: nfe?.source || "mercado_livre_faturador" },
                { label: "Provedor", value: nfe?.provider || "mercado_livre_faturador" },
                { label: "Numero", value: nfe?.invoice_number },
                { label: "Serie", value: nfe?.invoice_series },
                { label: "Chave", value: nfe?.invoice_key, breakAll: true },
                {
                  label: "Protocolo",
                  value: nfe?.authorization_protocol,
                },
                { label: "Ambiente", value: nfe?.environment },
                { label: "Atualizada em", value: formatTimestamp(nfe?.updated_at) },
              ]}
            />

            <div className="mt-4 space-y-2">
              <p className="text-sm text-[#22304a]">{nfe?.note || "Sem consulta de NF-e."}</p>
              {readiness?.note && (
                <p className="text-sm text-[#5f6b7a]">
                  Validacao: <span className="font-medium">{readiness.note}</span>
                </p>
              )}
              {blockingReasons.length > 0 && (
                <div className="rounded-2xl border border-[#ffe4b5] bg-[#fff9e8] px-4 py-3 text-sm text-[#8b6b00]">
                  <p className="font-semibold">Bloqueios operacionais</p>
                  <div className="mt-2 space-y-1">
                    {blockingReasons.map((reason) => (
                      <div key={reason}>• {reason}</div>
                    ))}
                  </div>
                </div>
              )}
              {readinessChecks.length > 0 && (
                <div className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#64748b]">
                    Checklist fiscal
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {readinessChecks.map((check) => (
                      <div
                        key={check.key}
                        className={`rounded-2xl border px-3 py-3 text-sm ${
                          check.passed
                            ? "border-[#cde8d3] bg-[#eefcf1] text-[#1b7a33]"
                            : check.blocking
                              ? "border-[#ffd8dc] bg-[#fff1f3] text-[#c2415d]"
                              : "border-[#ffe4b5] bg-[#fff9e8] text-[#8b6b00]"
                        }`}
                      >
                        <div className="font-medium">{check.label}</div>
                        {(check.value || check.detail) && (
                          <div className="mt-1 text-xs opacity-80">
                            {[check.value, check.detail].filter(Boolean).join(" • ")}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {(nfe?.error_code || nfe?.error_message) && (
                <p className="text-sm text-[#c2415d]">
                  Falha fiscal: {nfe?.error_code || "sem codigo"} -{" "}
                  {nfe?.error_message || "sem detalhe adicional"}
                </p>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={onGenerateNFe} disabled={nfeLoading || !readiness?.allowed}>
                {nfeLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileCheck2 className="mr-2 h-4 w-4" />
                )}
                Gerar NF-e
              </Button>
              <Button variant="outline" onClick={onRefreshNFe} disabled={nfeLoading}>
                {nfeLoading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 h-4 w-4" />
                )}
                Reconsultar
              </Button>
              <Button
                variant="outline"
                onClick={onSyncNFe}
                disabled={nfeLoading || !nfe?.invoice_key}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Sync com Mercado Livre
              </Button>
              <Button
                variant="outline"
                disabled={!nfe?.danfe_view_url}
                onClick={() => openDocumentUrl(nfe?.danfe_view_url)}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Visualizar DANFE
              </Button>
              <Button
                variant="outline"
                disabled={!nfe?.danfe_download_url}
                onClick={() => downloadDocumentUrl(nfe?.danfe_download_url)}
              >
                <Download className="mr-2 h-4 w-4" />
                Baixar DANFE
              </Button>
              <Button
                variant="outline"
                disabled={!nfe?.danfe_print_url}
                onClick={() => printDocumentUrl(nfe?.danfe_print_url)}
              >
                <Printer className="mr-2 h-4 w-4" />
                Imprimir DANFE
              </Button>
              <Button
                variant="outline"
                disabled={!nfe?.xml_download_url}
                onClick={() => downloadDocumentUrl(nfe?.xml_download_url)}
              >
                <Download className="mr-2 h-4 w-4" />
                Baixar XML
              </Button>
            </div>
          </section>

          <section className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[#3483fa]" />
                  <p className="text-sm font-semibold text-[#22304a]">
                    Etiqueta oficial de expedicao / caixa
                  </p>
                </div>
                <p className="mt-1 text-sm text-[#5f6b7a]">
                  Documento oficial retornado pela integracao externa, separado da etiqueta
                  interna do sistema.
                </p>
              </div>
              <AvailabilityBadge status={shippingLabel?.status || "unavailable"} />
            </div>

            <InfoGrid
              items={[
                {
                  label: "Origem",
                  value: shippingLabel?.source || "mercado_livre_shipment_labels",
                },
                { label: "Ultima busca", value: formatTimestamp(shippingLabel?.fetched_at) },
              ]}
            />

            <p className="mt-4 text-sm text-[#5f6b7a]">{shippingLabel?.note || "Sem dados."}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!shippingLabel?.view_url}
                onClick={() => openDocumentUrl(shippingLabel?.view_url)}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Visualizar
              </Button>
              <Button
                variant="outline"
                disabled={!shippingLabel?.download_url}
                onClick={() => downloadDocumentUrl(shippingLabel?.download_url)}
              >
                <Download className="mr-2 h-4 w-4" />
                Baixar
              </Button>
              <Button
                variant="outline"
                disabled={!shippingLabel?.print_url}
                onClick={() => printDocumentUrl(shippingLabel?.print_url)}
              >
                <Printer className="mr-2 h-4 w-4" />
                Imprimir
              </Button>
            </div>
          </section>

          <section className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <FileCheck2 className="h-4 w-4 text-[#3483fa]" />
                  <p className="text-sm font-semibold text-[#22304a]">
                    Documento fiscal consultado externamente
                  </p>
                </div>
                <p className="mt-1 text-sm text-[#5f6b7a]">
                  Consulta documental complementar do Mercado Livre, mantida por compatibilidade
                  com o fluxo anterior.
                </p>
              </div>
              <AvailabilityBadge status={invoice?.status || "unavailable"} />
            </div>

            <InfoGrid
              items={[
                { label: "Numero da NF-e", value: invoice?.invoice_number },
                { label: "Chave", value: invoice?.invoice_key, breakAll: true },
              ]}
            />

            <p className="mt-4 text-sm text-[#5f6b7a]">{invoice?.note || "Sem dados."}</p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!invoice?.danfe_view_url}
                onClick={() => openDocumentUrl(invoice?.danfe_view_url)}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Visualizar DANFE
              </Button>
              <Button
                variant="outline"
                disabled={!invoice?.danfe_download_url}
                onClick={() => downloadDocumentUrl(invoice?.danfe_download_url)}
              >
                <Download className="mr-2 h-4 w-4" />
                Baixar DANFE
              </Button>
              <Button
                variant="outline"
                disabled={!invoice?.danfe_print_url}
                onClick={() => printDocumentUrl(invoice?.danfe_print_url)}
              >
                <Printer className="mr-2 h-4 w-4" />
                Imprimir DANFE
              </Button>
              <Button
                variant="outline"
                disabled={!invoice?.xml_download_url}
                onClick={() => downloadDocumentUrl(invoice?.xml_download_url)}
              >
                <Download className="mr-2 h-4 w-4" />
                Baixar XML
              </Button>
            </div>
          </section>

          {!documents && !nfe && !loading && !nfeLoading && (
            <div className="rounded-2xl border border-dashed border-[#d6dbe5] bg-[#fbfcfe] px-4 py-5 text-sm text-[#5f6b7a]">
              Selecione "Buscar documentos externos" ou "Reconsultar" para carregar os dados
              documentais deste pedido.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
