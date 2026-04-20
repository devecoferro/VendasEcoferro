import { SaleData } from "@/types/sales";
import { parsePdfText, pdfHasText } from "./pdfParser";
import { runOCR } from "./ocrService";
import { extractMultipleSales } from "./extractSaleFields";
import { extractProductImagesFromPdf } from "./pdfImageExtractor";

export interface ProcessingResult {
  sale: SaleData;
  rawText: string;
  confidence: Record<string, "high" | "medium" | "low" | "empty">;
  method: "pdf-text" | "ocr" | "mercado-livre";
  /**
   * ml_order_id(s) originais deste ProcessingResult. Preenchido quando a
   * origem e Mercado Livre (banner -> review). Permite a ReviewPage marcar
   * as etiquetas como impressas via POST /api/ml/labels/mark-printed apos
   * o download do PDF. Para pedidos em pack, contem todos os order_ids
   * unificados na mesma linha de review.
   */
  mlOrderIds?: string[];
}

/**
 * Process an uploaded file and extract sale data.
 * Supports multiple sales per file (common in ML PDFs).
 */
export async function processFile(
  file: File,
  onProgress?: (status: string, progress: number) => void
): Promise<ProcessingResult[]> {
  const isPdf = file.type === "application/pdf";
  const isImage = file.type.startsWith("image/");

  let rawText = "";
  let method: "pdf-text" | "ocr" = "ocr";
  let productImages: string[] = [];

  if (isPdf) {
    onProgress?.("Analisando PDF...", 10);
    const hasText = await pdfHasText(file);

    if (hasText) {
      onProgress?.("Extraindo texto do PDF...", 30);
      rawText = await parsePdfText(file);
      method = "pdf-text";
      onProgress?.("Texto extraído com sucesso", 55);
    } else {
      onProgress?.("PDF escaneado detectado. Iniciando OCR...", 30);
      rawText = await runOCR(file, (p) => {
        onProgress?.("Executando OCR...", 30 + p * 0.25);
      });
      method = "ocr";
    }

    onProgress?.("Extraindo campos da venda...", 70);
    const extractions = extractMultipleSales(rawText);

    onProgress?.("Renderizando PDF e recortando imagens...", 82);
    productImages = await extractProductImagesFromPdf(
      file,
      extractions.map((extraction) => ({ saleNumber: extraction.sale.saleNumber }))
    ).catch(() => []);

    onProgress?.("Processamento concluído", 100);

    return extractions.map((ext, index) => {
      const productImageData = productImages[index] || "";
      return {
        sale: {
          ...ext.sale,
          productImageData,
          productImageUrl: productImageData || ext.sale.productImageUrl || "",
        },
        rawText: ext.rawText,
        confidence: ext.confidence,
        method,
      };
    });
  }

  if (isImage) {
    onProgress?.("Iniciando OCR na imagem...", 20);
    rawText = await runOCR(file, (p) => {
      onProgress?.("Executando OCR...", 20 + p * 0.6);
    });
    method = "ocr";

    const dataUrl = await fileToDataUrl(file);
    productImages = dataUrl ? [dataUrl] : [];
  } else {
    throw new Error(`Tipo de arquivo não suportado: ${file.type}`);
  }

  onProgress?.("Extraindo campos da venda...", 85);
  const extractions = extractMultipleSales(rawText);
  onProgress?.("Processamento concluído", 100);

  return extractions.map((ext, index) => {
    const productImageData = productImages[index] || "";
    return {
      sale: {
        ...ext.sale,
        productImageData,
        productImageUrl: productImageData || ext.sale.productImageUrl || "",
      },
      rawText: ext.rawText,
      confidence: ext.confidence,
      method,
    };
  });
}

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
