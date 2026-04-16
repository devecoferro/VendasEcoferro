import { PDFDocument } from "pdf-lib";

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
  options: { maxPagesPerSource?: number } = {}
): Promise<MergeLabelsResult> {
  const fallbackMaxPages = options.maxPagesPerSource ?? DEFAULT_MAX_PAGES_PER_SOURCE;
  const normalized = normalizeSources(sources, fallbackMaxPages);
  const merged = await PDFDocument.create();
  const errors: MergeSourceError[] = [];
  let includedSources = 0;
  let skippedPages = 0;

  const fetches = await Promise.allSettled(
    normalized.map(async (source) => ({
      source,
      fetched: await fetchPdf(source.url),
    }))
  );

  for (const result of fetches) {
    if (result.status === "rejected") {
      errors.push({
        url: "desconhecido",
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
      continue;
    }

    const { source, fetched } = result.value;
    const { url, bytes } = fetched;
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
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    // Popup bloqueado — cai pro download manual.
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  // Libera o objeto apos 60s (tempo suficiente pro browser carregar o PDF).
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Impressao automatica via popup window.
 *
 * Abre o PDF numa janela popup e dispara window.print() automaticamente
 * assim que o PDF renderiza. O Chrome mostra o dialogo de impressao com
 * a impressora padrao pre-selecionada.
 *
 * Para impressao 100% SILENCIOSA (sem dialogo nenhum), inicie o Chrome
 * com a flag --kiosk-printing:
 *   chrome.exe --kiosk-printing
 * Nesse modo, window.print() envia direto para a impressora padrao.
 *
 * Por que popup e nao iframe:
 * O Chrome renderiza PDFs via plugin sandboxed (Chromium PDF Viewer).
 * Num iframe invisivel, o plugin nao carrega corretamente e print()
 * falha silenciosamente. Numa janela popup o PDF viewer funciona normal
 * e print() dispara de forma confiavel.
 *
 * Fluxo:
 * 1. Abre popup pequena (200x200) com o blob URL do PDF
 * 2. Tenta print() a cada 500ms ate o PDF estar pronto (max 8s)
 * 3. Apos o print, fecha a popup automaticamente
 * 4. Se popup for bloqueada, abre em aba nova com fallback
 */
export function autoPrintPdfBlob(blob: Blob, _filename = "etiquetas-ml.pdf"): void {
  const url = URL.createObjectURL(blob);

  // Popup pequena — so precisa existir para o PDF viewer carregar.
  // Em --kiosk-printing, a janela fecha sozinha apos imprimir.
  const popup = window.open(
    url,
    "_blank",
    "width=200,height=200,left=0,top=0,menubar=no,toolbar=no,location=no,status=no"
  );

  if (!popup) {
    // Popup bloqueada — fallback: abre numa aba normal e tenta print.
    const tab = window.open(url, "_blank");
    if (tab) {
      setTimeout(() => {
        try { tab.focus(); tab.print(); } catch { /* ignore */ }
      }, 1500);
    } else {
      // Ultimo fallback: download manual.
      const link = document.createElement("a");
      link.href = url;
      link.download = _filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  // Tenta disparar print() assim que o PDF estiver renderizado.
  // O Chrome PDF viewer nao tem evento confiavel de "pronto",
  // entao tentamos a cada 500ms ate funcionar (max 8s).
  let attempts = 0;
  const maxAttempts = 16; // 16 × 500ms = 8s
  let printed = false;

  const tryPrint = () => {
    if (printed) return;
    attempts++;

    try {
      // Verifica se a popup ainda existe e tem conteudo.
      if (popup.closed) {
        printed = true;
        return;
      }
      popup.focus();
      popup.print();
      printed = true;

      // Fecha a popup apos um delay (tempo pro dialogo de impressao ou
      // para o --kiosk-printing enviar o job). Em kiosk mode, print()
      // retorna imediatamente apos enviar — 3s e' seguro.
      setTimeout(() => {
        try { if (!popup.closed) popup.close(); } catch { /* ignore */ }
      }, 3000);
    } catch {
      // PDF ainda nao renderizou ou cross-origin — tenta de novo.
      if (attempts < maxAttempts) {
        setTimeout(tryPrint, 500);
      }
    }
  };

  // Primeiro tentativa apos 1s (tempo minimo pro PDF viewer abrir).
  setTimeout(tryPrint, 1000);

  // Cleanup da URL apos 2 minutos.
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
