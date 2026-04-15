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
