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

/**
 * Baixa cada URL, recorta em no maximo `maxPagesPerSource` paginas iniciais
 * (padrao: 2 — etiqueta ML + DANFe, descartando a pagina de autorizacao/retirada)
 * e une tudo em um PDF so.
 *
 * Erros por fonte nao abortam o merge: itens falhos ficam no array `errors`
 * e os bem-sucedidos vao pro PDF final.
 */
export async function mergeLabelPdfs(
  urls: string[],
  options: { maxPagesPerSource?: number } = {}
): Promise<MergeLabelsResult> {
  const maxPagesPerSource = options.maxPagesPerSource ?? DEFAULT_MAX_PAGES_PER_SOURCE;
  const deduped = Array.from(new Set(urls.filter((url) => typeof url === "string" && url.length > 0)));
  const merged = await PDFDocument.create();
  const errors: MergeSourceError[] = [];
  let includedSources = 0;
  let skippedPages = 0;

  const fetches = await Promise.allSettled(deduped.map((url) => fetchPdf(url)));

  for (const result of fetches) {
    if (result.status === "rejected") {
      errors.push({
        url: "desconhecido",
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      });
      continue;
    }

    const { url, bytes } = result.value;
    try {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pageCount = src.getPageCount();
      const pagesToCopy = Math.min(pageCount, maxPagesPerSource);
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
