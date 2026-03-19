import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs`;

interface SaleAnchor {
  saleNumber: string;
  pageNum: number;
  y: number;
}

interface TextItem {
  str: string;
  x: number;
  y: number;
}

interface TextLine {
  text: string;
  y: number;
}

const RENDER_SCALE = 2.25;
const LINE_Y_TOLERANCE = 4;

/**
 * Render each PDF page to canvas and crop the visual product-image region
 * for each detected sale block.
 */
export async function extractProductImagesFromPdf(
  file: File,
  sales: Array<{ saleNumber: string }>
): Promise<string[]> {
  if (sales.length === 0) return [];

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const saleNumbers = sales.map((sale) => sale.saleNumber).filter(Boolean);
  const anchors = await extractSaleAnchors(pdf, saleNumbers);

  if (anchors.length === 0) {
    return new Array(sales.length).fill("");
  }

  const imagesBySaleNumber = new Map<string, string>();

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const pageAnchors = anchors
      .filter((anchor) => anchor.pageNum === pageNum)
      .sort((a, b) => a.y - b.y);

    if (pageAnchors.length === 0) continue;

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const pageWidth = viewport.width;
    const pageHeight = viewport.height;
    const renderViewport = page.getViewport({ scale: RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(renderViewport.width);
    canvas.height = Math.ceil(renderViewport.height);
    const context = canvas.getContext("2d");

    if (!context) {
      page.cleanup();
      continue;
    }

    await page.render({ canvasContext: context, viewport: renderViewport }).promise;

    const gaps = pageAnchors.slice(1).map((anchor, index) => anchor.y - pageAnchors[index].y);
    const estimatedBlockHeight = median(gaps) || pageHeight / Math.max(pageAnchors.length, 1);

    for (let index = 0; index < pageAnchors.length; index++) {
      const current = pageAnchors[index];
      const nextY = pageAnchors[index + 1]?.y ?? current.y + estimatedBlockHeight;
      const blockTop = clamp(current.y - 12, 0, pageHeight);
      const blockBottom = clamp(Math.max(nextY - 10, blockTop + estimatedBlockHeight * 0.72), 0, pageHeight);
      const cropped = cropProductImage(canvas, pageWidth, blockTop, blockBottom);

      if (cropped) {
        imagesBySaleNumber.set(current.saleNumber, cropped);
      }
    }

    canvas.width = 1;
    canvas.height = 1;
    page.cleanup();
  }

  return sales.map((sale) => imagesBySaleNumber.get(sale.saleNumber) || "");
}

async function extractSaleAnchors(pdf: pdfjsLib.PDFDocumentProxy, saleNumbers: string[]): Promise<SaleAnchor[]> {
  const anchors: SaleAnchor[] = [];
  const found = new Set<string>();

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: TextItem[] = content.items
      .filter((item: any) => typeof item.str === "string" && Array.isArray(item.transform))
      .map((item: any) => ({
        str: item.str,
        x: item.transform[4],
        y: viewport.height - item.transform[5],
      }));

    const lines = buildLines(items);

    for (const line of lines) {
      const compact = line.text.replace(/\s+/g, "");
      const digits = line.text.replace(/\D/g, "");

      for (const saleNumber of saleNumbers) {
        if (found.has(saleNumber)) continue;
        if (compact.includes(saleNumber) || digits.includes(saleNumber)) {
          anchors.push({ saleNumber, pageNum, y: line.y });
          found.add(saleNumber);
        }
      }
    }

    page.cleanup();
  }

  return anchors.sort((a, b) => (a.pageNum === b.pageNum ? a.y - b.y : a.pageNum - b.pageNum));
}

function buildLines(items: TextItem[]): TextLine[] {
  const sorted = [...items].sort((a, b) => (Math.abs(a.y - b.y) <= LINE_Y_TOLERANCE ? a.x - b.x : a.y - b.y));
  const lines: Array<{ y: number; items: TextItem[] }> = [];

  for (const item of sorted) {
    const existing = lines.find((line) => Math.abs(line.y - item.y) <= LINE_Y_TOLERANCE);
    if (existing) {
      existing.items.push(item);
      existing.y = (existing.y * (existing.items.length - 1) + item.y) / existing.items.length;
    } else {
      lines.push({ y: item.y, items: [item] });
    }
  }

  return lines
    .map((line) => ({
      y: line.y,
      text: line.items
        .sort((a, b) => a.x - b.x)
        .map((item) => item.str)
        .join(" ")
        .trim(),
    }))
    .filter((line) => line.text.length > 0)
    .sort((a, b) => a.y - b.y);
}

function cropProductImage(sourceCanvas: HTMLCanvasElement, pageWidth: number, blockTop: number, blockBottom: number): string {
  const blockHeight = Math.max(1, blockBottom - blockTop);
  const cropSize = Math.round(Math.min(pageWidth * 0.12, blockHeight * 0.42) * RENDER_SCALE);
  const cropX = Math.round(pageWidth * 0.045 * RENDER_SCALE);
  const cropY = Math.round((blockTop + blockHeight * 0.47) * RENDER_SCALE);

  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cropSize;
  cropCanvas.height = cropSize;
  const cropCtx = cropCanvas.getContext("2d");

  if (!cropCtx) return "";

  cropCtx.drawImage(
    sourceCanvas,
    cropX,
    cropY,
    cropSize,
    cropSize,
    0,
    0,
    cropSize,
    cropSize
  );

  const refinedCanvas = trimWhitespace(cropCanvas);
  return refinedCanvas.toDataURL("image/jpeg", 0.92);
}

function trimWhitespace(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  const { data } = imageData;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const r = data[index];
      const g = data[index + 1];
      const b = data[index + 2];
      const a = data[index + 3];
      const isContent = a > 0 && (r < 245 || g < 245 || b < 245);

      if (isContent) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX <= minX || maxY <= minY) {
    return canvas;
  }

  const padding = 8;
  const contentWidth = maxX - minX + 1;
  const contentHeight = maxY - minY + 1;
  const side = Math.max(contentWidth, contentHeight) + padding * 2;
  const startX = clamp(Math.round(minX - (side - contentWidth) / 2), 0, Math.max(0, width - side));
  const startY = clamp(Math.round(minY - (side - contentHeight) / 2), 0, Math.max(0, height - side));
  const finalSide = Math.min(side, width - startX, height - startY);

  const result = document.createElement("canvas");
  result.width = finalSide;
  result.height = finalSide;
  const resultCtx = result.getContext("2d");

  if (!resultCtx) return canvas;

  resultCtx.drawImage(canvas, startX, startY, finalSide, finalSide, 0, 0, finalSide, finalSide);
  return result;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
