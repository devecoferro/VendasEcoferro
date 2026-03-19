import Tesseract from "tesseract.js";

/**
 * Run OCR on an image file (PNG, JPG, JPEG) or a PDF rendered as image
 * Returns the extracted text
 */
export async function runOCR(
  file: File,
  onProgress?: (progress: number) => void
): Promise<string> {
  const result = await Tesseract.recognize(file, "por+eng", {
    logger: (m) => {
      if (m.status === "recognizing text" && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  return result.data.text;
}
