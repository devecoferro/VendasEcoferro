import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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
    const pageText = content.items
      .map((item: any) => item.str)
      .join(" ");
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
