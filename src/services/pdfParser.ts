import * as pdfjsLib from "pdfjs-dist";

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;

interface PdfTextItemLike {
  str?: string;
}

function extractTextValue(item: unknown): string {
  return item && typeof item === "object" && "str" in item
    ? String((item as PdfTextItemLike).str || "")
    : "";
}

/**
 * Extract text content from a PDF file using pdf.js
 * Returns the concatenated text of all pages
 */
export async function parsePdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const textParts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map(extractTextValue).join(" ");
    textParts.push(pageText);
  }

  return textParts.join("\n");
}

/**
 * Check if a PDF has meaningful text content (not scanned)
 */
export async function pdfHasText(file: File): Promise<boolean> {
  try {
    const text = await parsePdfText(file);
    // If we got at least 30 non-whitespace chars, consider it text-based
    return text.replace(/\s/g, "").length > 30;
  } catch {
    return false;
  }
}
