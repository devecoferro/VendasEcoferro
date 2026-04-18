import { PDFDocument } from "pdf-lib";

// Constantes de timing (antes eram magic numbers espalhados pelo arquivo)
const BLOB_URL_REVOKE_LONG_MS = 180_000; // 3 min — PDFs grandes sendo impressos
const BLOB_URL_REVOKE_MEDIUM_MS = 60_000; // 1 min — downloads em andamento
const BLOB_URL_REVOKE_SHORT_MS = 30_000; // 30s — blobs efêmeros
const PRINT_INITIAL_DELAY_MS = 1500;
const PRINT_RETRY_INTERVAL_MS = 600;
const PRINT_MAX_ATTEMPTS = 16;

export interface MergeSourceError {
  url: string;
  reason: string;
}

export interface MergeLabelsResult {
  mergedPdf: Blob;
  includedSources: number;
  skippedPages: number;
  errors: MergeSourceError[];
}

/**
 * Fonte de PDF para o merge. Cada fonte pode ter seu proprio limite de
 * paginas — util quando a etiqueta ML e a DANFe vem em URLs separadas
 * e cada uma tem apenas 1 pagina util.
 */
export interface MergeSource {
  url: string;
  maxPages?: number;
}

interface FetchedPdf {
  url: string;
  bytes: ArrayBuffer;
}

const DEFAULT_MAX_PAGES_PER_SOURCE = 2;

async function fetchPdf(url: string): Promise<FetchedPdf> {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return { url, bytes: buffer };
}

function normalizeSources(
  input: string[] | MergeSource[],
  fallbackMaxPages: number
): MergeSource[] {
  const seen = new Set<string>();
  const out: MergeSource[] = [];
  for (const item of input) {
    const url = typeof item === "string" ? item : item?.url;
    if (typeof url !== "string" || url.length === 0) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const maxPages =
      typeof item === "string"
        ? fallbackMaxPages
        : item.maxPages ?? fallbackMaxPages;
    out.push({ url, maxPages });
  }
  return out;
}

/**
 * Baixa cada fonte, recorta em no maximo `maxPages` paginas iniciais de cada
 * uma (padrao: 2 — etiqueta ML + DANFe quando vem juntas, descartando a pagina
 * de autorizacao/retirada) e une tudo em um PDF so.
 *
 * Aceita string[] (modo legado, usa `options.maxPagesPerSource` para todas)
 * ou MergeSource[] (cada fonte com seu proprio limite — util quando etiqueta
 * e DANFe vem em URLs separadas, 1 pagina cada, evitando paginas intermediarias
 * indesejadas tipo "Identificacao Produto").
 *
 * Erros por fonte nao abortam o merge: itens falhos ficam no array `errors`
 * e os bem-sucedidos vao pro PDF final.
 */
export async function mergeLabelPdfs(
  sources: string[] | MergeSource[],
  options: { maxPagesPerSource?: number; concurrency?: number } = {}
): Promise<MergeLabelsResult> {
  const fallbackMaxPages = options.maxPagesPerSource ?? DEFAULT_MAX_PAGES_PER_SOURCE;
  const concurrency = options.concurrency ?? 5;
  const normalized = normalizeSources(sources, fallbackMaxPages);
  const merged = await PDFDocument.create();
  const errors: MergeSourceError[] = [];
  let includedSources = 0;
  let skippedPages = 0;

  // Baixa PDFs em lotes controlados (default: 5 simultâneos).
  // Antes baixava TODOS de uma vez (48+ simultâneos) — os servidores do ML
  // faziam rate limiting e rejeitavam tudo, causando "Falha ao ler PDFs".
  const fetchedResults: { source: MergeSource; url: string; bytes: ArrayBuffer }[] = [];
  for (let i = 0; i < normalized.length; i += concurrency) {
    const batch = normalized.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map(async (source) => {
        const fetched = await fetchPdf(source.url);
        return { source, url: fetched.url, bytes: fetched.bytes };
      })
    );
    for (const result of batchResults) {
      if (result.status === "fulfilled") {
        fetchedResults.push(result.value);
      } else {
        errors.push({
          url: batch[batchResults.indexOf(result)]?.url || "desconhecido",
          reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  }

  for (const { source, url, bytes } of fetchedResults) {
    try {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pageCount = src.getPageCount();
      const limit = source.maxPages ?? fallbackMaxPages;
      const pagesToCopy = Math.min(pageCount, limit);
      const indices = Array.from({ length: pagesToCopy }, (_, i) => i);
      const copied = await merged.copyPages(src, indices);
      for (const page of copied) {
        merged.addPage(page);
      }
      skippedPages += Math.max(0, pageCount - pagesToCopy);
      includedSources += 1;
    } catch (error) {
      errors.push({
        url,
        reason: error instanceof Error ? error.message : "Erro desconhecido ao ler PDF",
      });
    }
  }

  const bytes = await merged.save();
  const mergedPdf = new Blob([bytes], { type: "application/pdf" });
  return { mergedPdf, includedSources, skippedPages, errors };
}

export function openPdfBlobForPrint(blob: Blob, filename = "etiquetas-ml.pdf"): void {
  const url = URL.createObjectURL(blob);
  // Abre em aba nova (sem features extras — "noopener,noreferrer" causava
  // abertura dupla em alguns navegadores com plugin de PDF externo).
  const win = window.open(url, "_blank");
  if (!win) {
    // Aba bloqueada (popup blocker) — cai pro download manual.
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  // Libera o objeto apos 60s (tempo suficiente pro browser carregar o PDF).
  setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_MEDIUM_MS);
}

/**
 * Impressao automatica integrada — funciona direto no navegador.
 *
 * Detecta o dispositivo:
 * - Desktop/Notebook: abre o PDF numa aba, dispara print() automaticamente.
 *   O dialogo de impressao aparece com a impressora padrao — operador
 *   so precisa dar Enter ou Ctrl+P. Apos imprimir, a aba fecha sozinha.
 * - Mobile/Tablet: baixa o PDF para o dispositivo (celular nao imprime
 *   direto — usa apenas para conferencia visual de QR).
 *
 * Nao precisa de servico externo, extensao ou flag do Chrome.
 * Funciona em qualquer computador que acesse o sistema.
 */
export function autoPrintPdfBlob(blob: Blob, filename = "etiquetas-ml.pdf"): void {
  const isMobile = /Android|iPhone|iPad|iPod|Opera Mini|IEMobile/i.test(
    navigator.userAgent
  );

  // Mobile/Tablet: download do PDF (nao tem impressora conectada).
  if (isMobile) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_SHORT_MS);
    return;
  }

  // Desktop/Notebook: abre numa aba e dispara print() automaticamente.
  const url = URL.createObjectURL(blob);

  // Abre em aba nova (mais confiavel que popup — popups podem ser bloqueadas,
  // e PDFs em popups pequenas nao renderizam bem no Chrome).
  const printWindow = window.open(url, "_blank");

  if (!printWindow) {
    // Aba bloqueada (popup blocker) — cai pro download.
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_MEDIUM_MS);
    return;
  }

  // Espera o PDF renderizar e dispara print().
  // O Chrome PDF viewer precisa de ~1-2s para carregar o PDF.
  // Tentamos a cada 600ms ate 10s (max 16 tentativas).
  let attempts = 0;
  const maxAttempts = PRINT_MAX_ATTEMPTS;
  let printed = false;

  const tryPrint = () => {
    if (printed) return;
    attempts++;
    try {
      if (printWindow.closed) { printed = true; return; }
      printWindow.focus();
      printWindow.print();
      printed = true;

      // Escuta o evento afterprint pra fechar a aba automaticamente.
      // Funciona no Chrome, Edge e Firefox modernos.
      try {
        printWindow.addEventListener("afterprint", () => {
          setTimeout(() => {
            try { if (!printWindow.closed) printWindow.close(); } catch { /* ok */ }
          }, 500);
        });
      } catch { /* cross-origin — nao consegue escutar, tudo bem */ }
    } catch {
      // PDF ainda nao renderizou — tenta de novo.
      if (attempts < maxAttempts) {
        setTimeout(tryPrint, PRINT_RETRY_INTERVAL_MS);
      }
    }
  };

  // Primeira tentativa apos 1.5s (tempo pro PDF viewer iniciar).
  setTimeout(tryPrint, PRINT_INITIAL_DELAY_MS);

  // Cleanup da URL apos 3 minutos.
  setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_LONG_MS);
}
