// Conferencia de Venda: o operador bipa o QR/codigo de barras na etiqueta.
// - 1o bipe: carrega os dados da venda + fotos de referencia do anuncio ML.
// - 2o bipe (do MESMO codigo, apos 5s de cooldown): imprime etiqueta + NFe.
// Objetivo: reduzir erros de separacao exibindo as fotos do anuncio e os
// detalhes do item pra conferencia visual antes da impressao.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Keyboard,
  Loader2,
  Printer,
  ScanLine,
  Search,
  X,
  ZoomIn,
} from "lucide-react";
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
import {
  mergeLabelPdfs,
  autoPrintPdfBlob,
  openPdfBlobForPrint,
  type MergeSource,
} from "@/services/pdfMergeService";

// Cooldown pra evitar que o 2o bipe acidental (mesmo codigo) dispare reimpressao.
const REPRINT_COOLDOWN_MS = 5000;

/**
 * Upgrade da URL da foto do anuncio pra maior resolucao disponivel no CDN
 * do Mercado Livre, pra o lightbox exibir a imagem em qualidade HD (~1200px+).
 *
 * Convencoes do ML CDN (http2.mlstatic.com):
 * - Sufixos `-I/D/C/O/F/S.jpg` = versoes reduzidas (~90 a ~500px)
 * - Sufixo `-V.jpg` = original max (1200px+, melhor qualidade)
 * - Prefixo `D_NQ_NP_2X_` no path = variante retina/HD (o dobro da resolucao)
 *
 * Estrategia: troca o sufixo de tamanho por `-F.jpg` (versao 1200px no 2X)
 * e injeta `_2X_` no path quando ausente. Se a URL nao seguir o padrao
 * do ML, devolve sem alterar — o `onError` do <img> volta pra URL original.
 */
function getHighResImageUrl(url: string | null | undefined): string {
  if (!url) return "";
  let out = url;

  // Troca sufixo de tamanho (-I/-D/-C/-O/-F/-S/-N.jpg) por -F.jpg. No ML,
  // o -F combinado com _2X_ devolve a maior versao compactada disponivel.
  out = out.replace(/-[IDCOFSN]\.jpg$/i, "-F.jpg");

  // Injeta _2X_ no path se ainda nao estiver presente (retina/HD).
  if (/D_NQ_NP_(?!2X_)/.test(out)) {
    out = out.replace(/D_NQ_NP_/, "D_NQ_NP_2X_");
  }

  return out;
}

/**
 * Coleta as fontes de PDF para impressao: etiqueta ML (1 pagina) +
 * DANFe (1 pagina) quando ambas estao disponiveis em URLs separadas.
 *
 * Se so existe a etiqueta ML completa (PDF unificado do ML), retorna 1 fonte
 * com as 2 primeiras paginas (etiqueta + DANFe embutida), descartando a
 * 3a+ que costuma ser comprovante/autorizacao/picking list.
 */
async function collectLabelSourcesForOrder(orderId: string): Promise<MergeSource[]> {
  try {
    const docs = await getMLOrderDocuments(orderId);
    const sources: MergeSource[] = [];

    const shippingUrl =
      docs?.shipping_label_external?.print_url ||
      docs?.shipping_label_external?.download_url ||
      docs?.shipping_label_external?.view_url ||
      null;

    const danfeUrl =
      docs?.invoice_nfe_document?.danfe_print_url ||
      docs?.invoice_nfe_document?.danfe_download_url ||
      docs?.invoice_nfe_document?.danfe_view_url ||
      null;

    // Caso ideal: etiqueta e DANFe em URLs separadas — 1 pagina de cada,
    // evita paginas intermediarias indesejadas no PDF do ML (ex: "Identificacao Produto").
    if (shippingUrl && danfeUrl) {
      sources.push({ url: shippingUrl, maxPages: 1 });
      sources.push({ url: danfeUrl, maxPages: 1 });
      return sources;
    }

    // Fallback: so tem a etiqueta ML unificada — pega ate 2 paginas (etiqueta + DANFe).
    if (shippingUrl) {
      sources.push({ url: shippingUrl, maxPages: 2 });
      return sources;
    }

    // Ultimo fallback: so tem DANFe.
    if (danfeUrl) {
      sources.push({ url: danfeUrl, maxPages: 1 });
    }
    return sources;
  } catch {
    return [];
  }
}

export default function ConferenciaVendaPage() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const manualInputRef = useRef<HTMLInputElement | null>(null);
  const lastScanAtRef = useRef<number>(0);

  const [scanBuffer, setScanBuffer] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MLConferenciaResponse | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  // Lightbox para ampliar a foto do anuncio. null = fechado; numero = indice
  // da foto aberta. Navegacao por teclado (<- ->), clique nas setas ou nas
  // metades esquerda/direita da propria imagem.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Mantem o input escondido focado: o leitor USB e' um HID que "digita"
  // no elemento com foco atual. Refoca ao clicar em qualquer lugar da pagina.
  // Exceto quando o usuario esta usando o campo manual (ou qualquer outro
  // input/button clicado de proposito), para nao roubar o foco dele.
  useEffect(() => {
    const isInteractiveFocus = () => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return false;
      const tag = active.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return true;
      // Allow contenteditable regions to keep focus.
      return active.isContentEditable === true;
    };

    const focusInput = () => {
      if (!inputRef.current) return;
      if (printing) return;
      if (lightboxIndex !== null) return; // Nao roubar foco enquanto o lightbox esta aberto.
      if (document.activeElement === inputRef.current) return;
      if (isInteractiveFocus()) return;
      inputRef.current.focus();
    };

    focusInput();
    const interval = setInterval(focusInput, 400);
    const handler = (event: MouseEvent) => {
      // Clicks em botoes/inputs ja atualizam o foco; so refocar em cliques
      // em area "vazia" da pagina.
      const target = event.target as HTMLElement | null;
      if (target && target.closest("input, textarea, button, select, a, [contenteditable='true']")) {
        return;
      }
      focusInput();
    };
    window.addEventListener("click", handler);
    return () => {
      clearInterval(interval);
      window.removeEventListener("click", handler);
    };
  }, [printing, lightboxIndex]);

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

      const sources = await collectLabelSourcesForOrder(order.order_id);
      if (sources.length === 0) {
        toast.error(
          "Nenhuma etiqueta/DANFe disponivel para esta venda. Verifique o Mercado Livre."
        );
        return;
      }

      // Quando etiqueta e DANFe vem em URLs separadas, cada fonte entra com
      // 1 pagina so — evita paginas intermediarias indesejadas do PDF unificado
      // (ex: "Identificacao Produto" que o ML insere entre etiqueta e DANFe).
      const merged = await mergeLabelPdfs(sources);
      if (merged.includedSources === 0) {
        toast.error("Falha ao ler o PDF da etiqueta.");
        return;
      }

      // Auto-print: dispara o dialogo de impressao automaticamente.
      // O operador so precisa confirmar (Enter) — a impressora padrao
      // ja vem pre-selecionada. Muito mais rapido que abrir aba nova.
      autoPrintPdfBlob(
        merged.mergedPdf,
        `conferencia-${order.sale_number || order.order_id}.pdf`
      );
      toast.success("Impressao automatica disparada — confirme na impressora.");
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

  // Submit do formulario de entrada manual (fallback caso o leitor USB
  // nao esteja funcionando). Dispara o mesmo fluxo do bipe: se for codigo
  // novo, carrega a venda; se for o mesmo ja carregado, imprime.
  const handleManualSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const value = manualCode.trim();
      if (!value) {
        toast.info("Digite o numero ou QR da venda antes de buscar.");
        return;
      }
      setManualCode("");
      // Devolve o foco ao input invisivel apos usar o manual, assim o
      // leitor USB volta a funcionar imediatamente apos a busca manual.
      window.setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
      await handleScan(value);
    },
    [handleScan, manualCode]
  );

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
  // Memoizado pra manter a mesma referencia entre renders — evita disparar
  // o efeito de preload (lightbox) a cada re-render quando o array de fotos
  // e' estavel. Dep do `result` pq `pictures` muda quando o backend devolve.
  const currentPictures = useMemo(
    () => (currentItemId ? result?.pictures?.[currentItemId] || [] : []),
    [currentItemId, result?.pictures]
  );
  const currentItemInfo = currentItemId ? result?.items?.[currentItemId] : null;

  // Reseta a selecao de item e fecha lightbox quando uma nova venda e' carregada.
  useEffect(() => {
    setSelectedItemId(null);
    setLightboxIndex(null);
  }, [result?.order?.order_id]);

  const mainImage = currentPictures[activeImageIndex] || currentPictures[0] || null;
  const saleData = result ? mapMLOrderToSaleData(result.order) : null;

  // ─── Lightbox (ampliar imagem do anuncio) ─────────────────────────
  const openLightbox = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= currentPictures.length) return;
      setLightboxIndex(idx);
      // Tira o foco do input invisivel para nao competir com as setas.
      inputRef.current?.blur();
    },
    [currentPictures.length]
  );

  const closeLightbox = useCallback(() => {
    setLightboxIndex((idx) => {
      if (idx !== null) {
        // Sincroniza a foto principal com a ultima vista no lightbox.
        setActiveImageIndex(idx);
      }
      return null;
    });
  }, []);

  const showPrevImage = useCallback(() => {
    setLightboxIndex((idx) => {
      if (idx === null || currentPictures.length === 0) return idx;
      return (idx - 1 + currentPictures.length) % currentPictures.length;
    });
  }, [currentPictures.length]);

  const showNextImage = useCallback(() => {
    setLightboxIndex((idx) => {
      if (idx === null || currentPictures.length === 0) return idx;
      return (idx + 1) % currentPictures.length;
    });
  }, [currentPictures.length]);

  // Navegacao por teclado enquanto o lightbox esta aberto.
  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeLightbox();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        showPrevImage();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        showNextImage();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxIndex, closeLightbox, showPrevImage, showNextImage]);

  const lightboxImage =
    lightboxIndex !== null ? currentPictures[lightboxIndex] || null : null;
  // URL em alta resolucao pra exibir no lightbox — a imagem de fallback
  // fica como placeholder enquanto a HD carrega (via onLoad/onError).
  const lightboxImageHD = getHighResImageUrl(lightboxImage);
  const [hdImageReady, setHdImageReady] = useState(false);

  // Reset flag de HD carregado sempre que o index muda, pra nao mostrar
  // a foto anterior em HD enquanto a proxima ainda esta baixando.
  useEffect(() => {
    setHdImageReady(false);
  }, [lightboxIndex]);

  // Preload da imagem anterior e proxima em HD pra navegacao instantanea.
  useEffect(() => {
    if (lightboxIndex === null || currentPictures.length <= 1) return;
    const preloadUrls = [
      currentPictures[(lightboxIndex + 1) % currentPictures.length],
      currentPictures[(lightboxIndex - 1 + currentPictures.length) % currentPictures.length],
    ];
    preloadUrls.forEach((rawUrl) => {
      if (!rawUrl) return;
      const hd = getHighResImageUrl(rawUrl);
      // Criar Image fora do DOM apenas dispara o download pra cache do browser.
      const img = new Image();
      img.src = hd;
    });
  }, [lightboxIndex, currentPictures]);

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
        {/* Cabecalho com instrucao, estado do scanner e entrada manual (fallback
            para quando o leitor USB nao estiver funcionando). */}
        <header className="space-y-3 rounded-2xl border border-border/60 bg-card px-4 py-4 shadow-sm sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
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
          </div>

          {/* Fallback manual: campo visivel para digitar o codigo da venda
              quando o leitor USB/QR nao estiver funcionando. */}
          <form
            onSubmit={handleManualSubmit}
            className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <Keyboard className="h-3.5 w-3.5" />
              Entrada manual
            </div>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={manualInputRef}
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="Digite o QR da venda (numero da venda ou order_id)"
                className="h-10 pl-9 text-sm"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={!manualCode.trim() || loading || printing}
              className="h-10 gap-2"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
              Buscar
            </Button>
          </form>
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
          // Duas colunas de larguras equivalentes no desktop — a esquerda
          // exibe a foto do anuncio em tamanho grande pra conferencia visual,
          // a direita traz os dados da venda e QR codes pra impressao.
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            {/* Coluna esquerda: foto grande + thumbnails do anuncio ML. */}
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
                <button
                  type="button"
                  onClick={() => openLightbox(activeImageIndex)}
                  className="group relative block w-full overflow-hidden rounded-xl border border-border bg-white transition-all hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label="Ampliar foto do anuncio"
                  title="Clique para ampliar (use as setas ← → para navegar)"
                >
                  {/* aspect-[4/3] escala a altura com a largura da coluna —
                      fica ~450px de altura em 600px de coluna, aproximando
                      o tamanho mostrado no mockup sem hardcode frágil. */}
                  <img
                    src={mainImage}
                    alt={currentItemInfo?.title || "Foto de referencia"}
                    className="aspect-[4/3] w-full object-contain transition-transform duration-200 group-hover:scale-[1.03]"
                  />
                  {/* Overlay que aparece no hover com o icone de "ampliar". */}
                  <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/35 group-hover:opacity-100">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-[#333] shadow-md">
                      <ZoomIn className="h-4 w-4" />
                      Ampliar
                    </span>
                  </span>
                </button>
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 text-xs text-muted-foreground">
                  {result.has_ml_connection
                    ? "Sem fotos cadastradas no anuncio."
                    : "Conecte ao Mercado Livre para ver fotos."}
                </div>
              )}

              {currentPictures.length > 1 && (
                // 4 thumbnails em linha — a coluna agora e' mais larga,
                // entao cada thumbnail fica confortavelmente maior.
                <div className="grid grid-cols-4 gap-2">
                  {currentPictures.slice(0, 8).map((url, idx) => (
                    <button
                      key={url}
                      type="button"
                      // 1 clique: seleciona; 2 cliques: abre lightbox. Double
                      // click tem delay — usamos Ctrl+Click ou o hover indicator
                      // para a versao mais rapida. Aqui: selecionar ativa foto
                      // principal; clique na principal abre lightbox.
                      onClick={() => {
                        if (idx === activeImageIndex) {
                          openLightbox(idx);
                        } else {
                          setActiveImageIndex(idx);
                        }
                      }}
                      className={cn(
                        "group relative overflow-hidden rounded-md border bg-white transition-all",
                        idx === activeImageIndex
                          ? "border-primary ring-2 ring-primary/40"
                          : "border-border hover:border-primary/60"
                      )}
                      title={
                        idx === activeImageIndex
                          ? "Clique para ampliar"
                          : "Clique para ver nesta area principal"
                      }
                    >
                      <img
                        src={url}
                        alt={`Foto ${idx + 1}`}
                        className="aspect-square w-full object-contain"
                      />
                      {idx === activeImageIndex && (
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all duration-150 group-hover:bg-black/40 group-hover:opacity-100">
                          <ZoomIn className="h-4 w-4 text-white" />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {currentItemInfo?.title && (
                <p className="text-[12px] leading-[1.45] text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    Titulo no anuncio:
                  </span>{" "}
                  {currentItemInfo.title}
                </p>
              )}
            </aside>

            {/* Coluna direita: header da venda (numero + botao imprimir) + card
                completo da venda com QR codes. */}
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
                {/* Botao amarelo no estilo ML (mesma paleta do "Imprimir
                    etiqueta ML + DANFe" do MercadoLivrePage) pra manter
                    consistencia visual entre os fluxos de impressao. */}
                <Button
                  type="button"
                  onClick={() => handlePrint(result.order)}
                  disabled={printing}
                  className="h-10 gap-2 rounded-lg bg-[#fff159] px-4 text-[14px] font-semibold text-[#333333] shadow-[0_1px_3px_rgba(255,241,89,0.6)] transition hover:bg-[#ffe924] hover:shadow-[0_2px_6px_rgba(255,241,89,0.8)] disabled:cursor-not-allowed disabled:bg-[#f1f1f1] disabled:text-[#a0a0a0] disabled:shadow-none"
                >
                  {printing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Printer className="h-4 w-4" />
                  )}
                  Imprimir etiqueta + NFe
                </Button>
              </div>

              {/* hideProductImage: a thumbnail do produto no card da etiqueta
                  seria redundante aqui — a foto grande do anuncio ML ja esta
                  sendo exibida na coluna esquerda. */}
              {saleData && <SaleCardPreview sale={saleData} hideProductImage />}
            </section>
          </div>
        )}
      </div>

      {/* Lightbox para ampliar a foto do anuncio. Fecha clicando no fundo,
          no X, ou com ESC. Navega com <- -> ou clicando nas setas/metades.
          O lightbox ocupa 100% da tela (fixed inset-0) e a imagem usa
          toda a viewport disponivel para facilitar a conferencia visual
          de pecas. */}
      {lightboxIndex !== null && lightboxImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Foto ampliada do anuncio"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm"
          onClick={closeLightbox}
        >
          {/* Contador superior esquerdo */}
          <div className="pointer-events-none absolute left-4 top-4 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-white">
            {lightboxIndex + 1} / {currentPictures.length}
          </div>

          {/* Botao fechar superior direito */}
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              closeLightbox();
            }}
            className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25"
            aria-label="Fechar (Esc)"
            title="Fechar (Esc)"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Seta anterior */}
          {currentPictures.length > 1 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                showPrevImage();
              }}
              className="absolute left-4 top-1/2 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25"
              aria-label="Imagem anterior (seta esquerda)"
              title="Anterior (←)"
            >
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}

          {/* Seta proxima */}
          {currentPictures.length > 1 && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                showNextImage();
              }}
              className="absolute right-4 top-1/2 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/25"
              aria-label="Proxima imagem (seta direita)"
              title="Proxima (→)"
            >
              <ChevronRight className="h-6 w-6" />
            </button>
          )}

          {/* Imagem + zonas de clique (esquerda/direita) para navegacao por mouse.
              Uso a mesma URL + HD sobreposta: a versao baixa (~500px, que ja
              veio cacheada da coluna esquerda) aparece imediatamente como
              placeholder; quando o HD (~1200px+) termina de baixar, a opacidade
              troca para exibir a versao em alta resolucao. Zero delay visivel
              para o operador, e conferencia em resolucao que mostra detalhes
              de parafuso/solda/textura sem ambiguidade. */}
          <div
            className="relative flex h-full w-full items-center justify-center"
            onClick={(event) => event.stopPropagation()}
          >
            {/* Low-res placeholder — sempre visivel ate o HD estar pronto. */}
            <img
              src={lightboxImage}
              alt=""
              aria-hidden="true"
              className={cn(
                "absolute inset-0 m-auto max-h-[100vh] max-w-[100vw] select-none object-contain transition-opacity duration-200",
                hdImageReady ? "opacity-0" : "opacity-100"
              )}
              draggable={false}
            />
            {/* HD — substitui a low-res assim que termina de carregar. */}
            <img
              key={lightboxImageHD}
              src={lightboxImageHD || lightboxImage}
              alt={`Foto ${lightboxIndex + 1} do anuncio${
                currentItemInfo?.title ? ` — ${currentItemInfo.title}` : ""
              }`}
              className={cn(
                "relative max-h-[100vh] max-w-[100vw] select-none object-contain transition-opacity duration-200",
                hdImageReady ? "opacity-100" : "opacity-0"
              )}
              draggable={false}
              onLoad={() => setHdImageReady(true)}
              onError={(event) => {
                // Se a URL HD nao existir no CDN (raro), cai pra URL original
                // e marca como "pronto" pra exibir a low-res em tela cheia.
                const target = event.target as HTMLImageElement;
                if (target.src !== lightboxImage) {
                  target.src = lightboxImage || "";
                }
                setHdImageReady(true);
              }}
            />
            {currentPictures.length > 1 && (
              <>
                {/* Clique na metade esquerda da imagem = anterior. */}
                <button
                  type="button"
                  onClick={showPrevImage}
                  className="absolute left-0 top-0 h-full w-1/2 cursor-w-resize bg-transparent focus:outline-none"
                  aria-label="Clique na esquerda para imagem anterior"
                  tabIndex={-1}
                />
                {/* Clique na metade direita da imagem = proxima. */}
                <button
                  type="button"
                  onClick={showNextImage}
                  className="absolute right-0 top-0 h-full w-1/2 cursor-e-resize bg-transparent focus:outline-none"
                  aria-label="Clique na direita para proxima imagem"
                  tabIndex={-1}
                />
              </>
            )}
          </div>

          {/* Dica de atalhos inferior */}
          <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-4 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-white/80">
            ← → navegar · Esc fechar
          </div>
        </div>
      )}
    </AppLayout>
  );
}
