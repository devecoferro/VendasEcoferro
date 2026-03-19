import { SaleData } from "@/types/sales";
import { parsePdfText, pdfHasText } from "./pdfParser";
import { runOCR } from "./ocrService";
import { extractSaleFields, extractMultipleSales } from "./extractSaleFields";
import { extractImagesFromPdf } from "./pdfImageExtractor";

export interface ProcessingResult {
  sale: SaleData;
  rawText: string;
  confidence: Record<string, "high" | "medium" | "low" | "empty">;
  method: "pdf-text" | "ocr";
}

/**
 * Process an uploaded file and extract sale data
 * Supports multiple sales per file (common in ML PDFs)
 */
export async function processFile(
  file: File,
  onProgress?: (status: string, progress: number) => void
): Promise<ProcessingResult[]> {
  const isPdf = file.type === "application/pdf";
  const isImage = file.type.startsWith("image/");

  let rawText = "";
  let method: "pdf-text" | "ocr" = "ocr";
  let extractedImages: string[] = [];

  if (isPdf) {
    onProgress?.("Analisando PDF...", 10);
    const hasText = await pdfHasText(file);

    // Extract images in parallel with text extraction
    const imagePromise = extractImagesFromPdf(file).catch(() => [] as string[]);

    if (hasText) {
      onProgress?.("Extraindo texto do PDF...", 30);
      rawText = await parsePdfText(file);
      method = "pdf-text";
      onProgress?.("Texto extraído com sucesso", 60);
    } else {
      onProgress?.("PDF escaneado detectado. Iniciando OCR...", 30);
      rawText = await runOCR(file, (p) => {
        onProgress?.("Executando OCR...", 30 + p * 0.3);
      });
      method = "ocr";
    }

    onProgress?.("Extraindo imagens do PDF...", 75);
    extractedImages = await imagePromise;
    onProgress?.("Imagens extraídas", 80);
  } else if (isImage) {
    onProgress?.("Iniciando OCR na imagem...", 20);
    rawText = await runOCR(file, (p) => {
      onProgress?.("Executando OCR...", 20 + p * 0.6);
    });
    method = "ocr";

    // For image files, use the file itself as the product image
    const dataUrl = await fileToDataUrl(file);
    if (dataUrl) extractedImages = [dataUrl];
  } else {
    throw new Error(`Tipo de arquivo não suportado: ${file.type}`);
  }

  onProgress?.("Extraindo campos da venda...", 85);

  // Try to extract multiple sales from the text
  const extractions = extractMultipleSales(rawText);

  onProgress?.("Processamento concluído", 100);

  // Associate extracted images with sales
  // Strategy: distribute images across sales in order, skipping very small/decorative ones
  // Product images in ML PDFs typically appear once per sale block
  return extractions.map((ext, index) => {
    const imageForSale = extractedImages[index] || "";
    return {
      sale: {
        ...ext.sale,
        productImageUrl: ext.sale.productImageUrl || imageForSale,
      },
      rawText: ext.rawText,
      confidence: ext.confidence,
      method,
    };
  });
}

/**
 * Convert a File to a base64 data URL
 */
function fileToDataUrl(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
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

    const fileResults = await processFile(files[i], fileProgress);
    results.push(...fileResults);
  }

  return results;
}
