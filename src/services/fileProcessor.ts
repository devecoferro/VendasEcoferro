import { SaleData } from "@/types/sales";
import { parsePdfText, pdfHasText } from "./pdfParser";
import { runOCR } from "./ocrService";
import { extractSaleFields } from "./extractSaleFields";

export interface ProcessingResult {
  sale: SaleData;
  rawText: string;
  confidence: Record<string, "high" | "medium" | "low" | "empty">;
  method: "pdf-text" | "ocr";
}

/**
 * Process an uploaded file and extract sale data
 * Automatically chooses between PDF text parsing and OCR
 */
export async function processFile(
  file: File,
  onProgress?: (status: string, progress: number) => void
): Promise<ProcessingResult> {
  const isPdf = file.type === "application/pdf";
  const isImage = file.type.startsWith("image/");

  let rawText = "";
  let method: "pdf-text" | "ocr" = "ocr";

  if (isPdf) {
    onProgress?.("Analisando PDF...", 10);
    const hasText = await pdfHasText(file);

    if (hasText) {
      onProgress?.("Extraindo texto do PDF...", 30);
      rawText = await parsePdfText(file);
      method = "pdf-text";
      onProgress?.("Texto extraído com sucesso", 70);
    } else {
      onProgress?.("PDF escaneado detectado. Iniciando OCR...", 30);
      rawText = await runOCR(file, (p) => {
        onProgress?.("Executando OCR...", 30 + p * 0.4);
      });
      method = "ocr";
    }
  } else if (isImage) {
    onProgress?.("Iniciando OCR na imagem...", 20);
    rawText = await runOCR(file, (p) => {
      onProgress?.("Executando OCR...", 20 + p * 0.6);
    });
    method = "ocr";
  } else {
    throw new Error(`Tipo de arquivo não suportado: ${file.type}`);
  }

  onProgress?.("Extraindo campos da venda...", 85);
  const { sale, confidence } = extractSaleFields(rawText);

  onProgress?.("Processamento concluído", 100);

  return { sale, rawText, confidence, method };
}

/**
 * Process multiple files and return results for each
 */
export async function processFiles(
  files: File[],
  onProgress?: (status: string, progress: number) => void
): Promise<ProcessingResult[]> {
  const results: ProcessingResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const fileProgress = (status: string, progress: number) => {
      const overall = ((i + progress / 100) / files.length) * 100;
      onProgress?.(`[${i + 1}/${files.length}] ${status}`, overall);
    };

    const result = await processFile(files[i], fileProgress);
    results.push(result);
  }

  return results;
}
