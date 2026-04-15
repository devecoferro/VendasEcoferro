// Conferencia de Venda: o operador bipa o QR/codigo de barras na etiqueta.
// - 1o bipe: carrega os dados da venda + fotos de referencia do anuncio ML.
// - 2o bipe (do MESMO codigo, apos 5s de cooldown): imprime etiqueta + NFe.
// Objetivo: reduzir erros de separacao exibindo as fotos do anuncio e os
// detalhes do item pra conferencia visual antes da impressao.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2, Printer, ScanLine } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SaleCardPreview } from "@/components/SaleCardPreview";
import { cn } from "@/lib/utils";
import {
  generateMLNFe,
  getConferenciaSale,
  getMLOrderDocuments,
  mapMLOrderToSaleData,
  type MLConferenciaResponse,
} from "@/services/mercadoLivreService";
import { mergeLabelPdfs, openPdfBlobForPrint } from "@/services/pdfMergeService";

// Cooldown pra evitar que o 2o bipe acidental (mesmo codigo) dispare reimpressao.
const REPRINT_COOLDOWN_MS = 5000;

async function collectLabelUrlForOrder(orderId: string): Promise<string | null> {
  try {
    const docs = await getMLOrderDocuments(orderId);
    return (
      docs?.shipping_label_external?.print_url ||
      docs?.shipping_label_external?.download_url ||
      docs?.shipping_label_external?.view_url ||
      docs?.invoice_nfe_document?.danfe_print_url ||
      docs?.invoice_nfe_document?.danfe_download_url ||
      docs?.invoice_nfe_document?.danfe_view_url ||
      null
    );
  } catch {
    return null;
  }
}

export default function ConferenciaVendaPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastScanAtRef = useRef<number>(0);

  const [scanBuffer, setScanBuffer] = useState("");
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MLConferenciaResponse | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  // Mantem o input escondido focado: o leitor USB e' um HID que "digita"
  // no elemento com foco atual. Refoca ao clicar em qualquer lugar da pagina.
  useEffect(() => {
    const focusInput = () => {
      if (
        inputRef.current &&
        document.activeElement !== inputRef.current &&
        !printing
      ) {
        inputRef.current.focus();
      }
    };
    focusInput();
    const interval = setInterval(focusInput, 400);
    const handler = () => focusInput();
    window.addEventListener("click", handler);
    return () => {
      clearInterval(interval);
      window.removeEventListener("click", handler);
    };
  }, [printing]);

  const handlePrint = useCallback(async (order: MLConferenciaResponse["order"]) => {
    setPrinting(true);
    try {
      // Tenta gerar NFe antes — se ja existir, o endpoint retorna o existente
      // sem reemitir; se falhar, seguimos com a etiqueta e um aviso.
      try {
        const nfePayload = await generateMLNFe(order.order_id);
        if (nfePayload.action === "generate_failed") {
          toast.warning(`NFe: ${nfePayload.nfe.note}`);
        }
      } catch (nfeError) {
        toast.warning(
          nfeError instanceof Error
            ? `NFe: ${nfeError.message}`
            : "Falha ao gerar a NFe; seguindo apenas com a etiqueta."
        );
      }

      const labelUrl = await collectLabelUrlForOrder(order.order_id);
      if (!labelUrl) {
        toast.error(
          "Nenhuma etiqueta/DANFe disponivel para esta venda. Verifique o Mercado Livre."
        );
        return;
      }

      // Mantem apenas as 2 primeiras paginas (etiqueta + DANFe); a 3a
      // e' comprovante que nao precisa imprimir.
      const merged = await mergeLabelPdfs([labelUrl], { maxPagesPerSource: 2 });
      if (merged.includedSources === 0) {
        toast.error("Falha ao ler o PDF da etiqueta.");
        return;
      }

      openPdfBlobForPrint(
        merged.mergedPdf,
        `conferencia-${order.sale_number || order.order_id}.pdf`
      );
      toast.success("Etiqueta + NFe enviada para impressao.");
    } catch (printError) {
      toast.error(
        printError instanceof Error
          ? printError.message
          : "Falha ao preparar a impressao."
      );
    } finally {
      setPrinting(false);
    }
  }, []);

  const handleScan = useCallback(
    async (code: string) => {
      const normalized = code.trim();
      if (!normalized) return;

      const now = Date.now();
      const sameCodeAsLoaded =
        result &&
        (result.order.sale_number === normalized ||
          result.order.order_id === normalized);

      // 2o bipe do mesmo codigo apos cooldown => imprime.
      if (sameCodeAsLoaded) {
        if (now - lastScanAtRef.current < REPRINT_COOLDOWN_MS) {
          toast.info(
            `Aguarde ${Math.ceil(
              (REPRINT_COOLDOWN_MS - (now - lastScanAtRef.current)) / 1000
            )}s antes de bipar novamente para imprimir.`
          );
          return;
        }
        lastScanAtRef.current = now;
        await handlePrint(result.order);
        return;
      }

      // Codigo novo => carrega a venda.
      setLoading(true);
      setError(null);
      try {
        const payload = await getConferenciaSale(normalized);
        setResult(payload);
        setActiveImageIndex(0);
        lastScanAtRef.current = Date.now();
        if (!payload.has_ml_connection) {
          toast.warning(
            "Sem conexao com o Mercado Livre — fotos do anuncio indisponiveis."
          );
        } else {
          toast.success(`Venda #${payload.order.sale_number} carregada.`);
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Erro ao buscar a venda.";
        setError(message);
        setResult(null);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    },
    [handlePrint, result]
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const value = scanBuffer;
      setScanBuffer("");
      void handleScan(value);
    }
  };

  // Primeiro item_id da venda (todos os itens de um mesmo anuncio compartilham
  // o mesmo item_id; packs com itens diferentes tem varios — mostramos o
  // primeiro e deixamos o usuario trocar pelo thumbnail lateral se quiser).
  const allItemIds = Array.from(
    new Set(
      (result?.order?.items || [])
        .map((item) => item.item_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const currentItemId = selectedItemId || allItemIds[0] || null;
  const currentPictures = currentItemId ? result?.pictures?.[currentItemId] || [] : [];
  const currentItemInfo = currentItemId ? result?.items?.[currentItemId] : null;

  // Reseta a selecao de item quando uma nova venda e' carregada.
  useEffect(() => {
    setSelectedItemId(null);
  }, [result?.order?.order_id]);

  const mainImage = currentPictures[activeImageIndex] || currentPictures[0] || null;
  const saleData = result ? mapMLOrderToSaleData(result.order) : null;

  return (
    <AppLayout>
      {/* Input invisivel que captura o scan do leitor USB (HID keyboard).
          sr-only pra manter acessivel sem mostrar visualmente. */}
      <Input
        ref={inputRef}
        value={scanBuffer}
        onChange={(e) => setScanBuffer(e.target.value)}
        onKeyDown={handleKeyDown}
        className="sr-only"
        aria-label="Leitor de codigo da venda"
        autoFocus
        autoComplete="off"
        spellCheck={false}
      />

      <div className="space-y-4">
        {/* Cabecalho com instrucao e estado do scanner. */}
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-4 py-4 shadow-sm sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ScanLine className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                Conferencia de Venda
              </h1>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Bipe o QR da etiqueta. Bipe novamente apos 5s para imprimir.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]">
            <span
              className={cn(
                "inline-flex h-2.5 w-2.5 rounded-full",
                loading
                  ? "animate-pulse bg-amber-500"
                  : result
                    ? "bg-emerald-500"
                    : "bg-slate-400"
              )}
            />
            <span className="text-muted-foreground">
              {loading
                ? "Lendo..."
                : result
                  ? "Venda carregada"
                  : "Aguardando scan"}
            </span>
          </div>
        </header>

        {error && !result && (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/40 px-6 py-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <ScanLine className="h-8 w-8" />
            </div>
            <h2 className="mt-4 text-base font-semibold text-foreground sm:text-lg">
              Aguardando bipe do leitor
            </h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Aproxime o leitor do QR/codigo de barras impresso na etiqueta.
              Os dados do pedido e as fotos do anuncio aparecerao aqui.
            </p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {result && (
          <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            {/* Coluna esquerda: thumbnails das fotos de referencia do anuncio ML. */}
            <aside className="space-y-3 rounded-2xl border border-border/60 bg-card p-3 shadow-sm sm:p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Fotos do anuncio
                </p>
                {currentItemInfo?.permalink && (
                  <a
                    href={currentItemInfo.permalink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                  >
                    Abrir ML
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              {allItemIds.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  {allItemIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setSelectedItemId(id);
                        setActiveImageIndex(0);
                      }}
                      className={cn(
                        "rounded-md border px-2 py-1 text-[11px] font-medium transition-colors",
                        id === currentItemId
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:border-primary/60"
                      )}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              )}

              {mainImage ? (
                <div className="overflow-hidden rounded-xl border border-border bg-white">
                  <img
                    src={mainImage}
                    alt={currentItemInfo?.title || "Foto de referencia"}
                    className="h-64 w-full object-contain"
                  />
                </div>
              ) : (
                <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 text-xs text-muted-foreground">
                  {result.has_ml_connection
                    ? "Sem fotos cadastradas no anuncio."
                    : "Conecte ao Mercado Livre para ver fotos."}
                </div>
              )}

              {currentPictures.length > 1 && (
                <div className="grid grid-cols-4 gap-1.5">
                  {currentPictures.slice(0, 8).map((url, idx) => (
                    <button
                      key={url}
                      type="button"
                      onClick={() => setActiveImageIndex(idx)}
                      className={cn(
                        "overflow-hidden rounded-md border bg-white transition-all",
                        idx === activeImageIndex
                          ? "border-primary ring-2 ring-primary/40"
                          : "border-border hover:border-primary/60"
                      )}
                    >
                      <img
                        src={url}
                        alt={`Foto ${idx + 1}`}
                        className="aspect-square w-full object-contain"
                      />
                    </button>
                  ))}
                </div>
              )}

              {currentItemInfo?.title && (
                <p className="text-[11px] leading-[1.4] text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    Titulo no anuncio:
                  </span>{" "}
                  {currentItemInfo.title}
                </p>
              )}
            </aside>

            {/* Coluna direita: dados da venda + acao de imprimir. */}
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-sm">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Venda
                  </p>
                  <p className="text-base font-semibold text-foreground sm:text-lg">
                    #{result.order.sale_number || result.order.order_id}
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={() => handlePrint(result.order)}
                  disabled={printing}
                  className="gap-2"
                >
                  {printing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Printer className="h-4 w-4" />
                  )}
                  Imprimir etiqueta + NFe
                </Button>
              </div>

              {saleData && <SaleCardPreview sale={saleData} />}
            </section>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
