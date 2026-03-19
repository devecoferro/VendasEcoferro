import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { SaleData } from "@/types/sales";

// A4 portrait dimensions in mm
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 8;
const MARGIN_Y = 8;
const CARDS_PER_PAGE = 5;
const GAP = 4;

const USABLE_W = PAGE_W - MARGIN_X * 2;
const USABLE_H = PAGE_H - MARGIN_Y * 2;
const CARD_H = Math.floor((USABLE_H - GAP * (CARDS_PER_PAGE - 1)) / CARDS_PER_PAGE);
const CARD_W = USABLE_W;

const LEFT_W = 38;
const RIGHT_W = 36;
const CENTER_W = CARD_W - LEFT_W - RIGHT_W;

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  // Already a data URL (base64 from PDF extraction)
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url, { mode: "cors" });
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function generateBarcodeDataUrl(value: string): string | null {
  if (!value) return null;
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, value, {
      format: "CODE128",
      width: 1.2,
      height: 28,
      displayValue: true,
      fontSize: 8,
      margin: 1,
    });
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

async function generateQRCodeDataUrl(value: string): Promise<string | null> {
  if (!value) return null;
  try {
    return await QRCode.toDataURL(value, { width: 100, margin: 1 });
  } catch {
    return null;
  }
}

function drawPlaceholder(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.setFillColor(235, 235, 240);
  doc.roundedRect(x, y, w, h, 2, 2, "F");
  doc.setFontSize(6);
  doc.setTextColor(160, 160, 170);
  doc.text("Sem imagem", x + w / 2, y + h / 2 + 1, { align: "center" });
}

async function drawSaleCard(doc: jsPDF, sale: SaleData, x0: number, y0: number) {
  // Card border
  doc.setDrawColor(190, 190, 200);
  doc.setLineWidth(0.25);
  doc.roundedRect(x0, y0, CARD_W, CARD_H, 2, 2, "S");

  const pad = 3;
  const innerH = CARD_H - pad * 2;

  // --- LEFT: product image ---
  const imgPad = 3;
  const imgSize = Math.min(LEFT_W - imgPad * 2, innerH - 4);
  const imgX = x0 + imgPad;
  const imgY = y0 + pad + (innerH - imgSize) / 2;

  const imgData = sale.productImageUrl ? await loadImageAsDataUrl(sale.productImageUrl) : null;

  if (imgData) {
    doc.setDrawColor(180, 180, 195);
    doc.setLineWidth(0.4);
    doc.roundedRect(imgX - 0.5, imgY - 0.5, imgSize + 1, imgSize + 1, 1.5, 1.5, "S");
    try {
      doc.addImage(imgData, "JPEG", imgX, imgY, imgSize, imgSize);
    } catch {
      drawPlaceholder(doc, imgX, imgY, imgSize, imgSize);
    }
  } else {
    drawPlaceholder(doc, imgX, imgY, imgSize, imgSize);
  }

  // --- CENTER ---
  const cx = x0 + LEFT_W + 2;
  let cy = y0 + pad + 1;
  const maxTextW = CENTER_W - 6;

  // SKU badge
  doc.setFillColor(230, 235, 255);
  doc.roundedRect(cx, cy, 24, 5, 1, 1, "F");
  doc.setFontSize(6);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(60, 80, 180);
  doc.text(sale.sku || "—", cx + 12, cy + 3.5, { align: "center" });

  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120, 120, 130);
  doc.text(`Qtd: ${sale.quantity}`, cx + 27, cy + 3.5);

  cy += 7;

  // Product name (max 2 lines)
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 40);
  const productLines = doc.splitTextToSize(sale.productName || "—", maxTextW);
  doc.text(productLines.slice(0, 2), cx, cy);
  cy += Math.min(productLines.length, 2) * 3.5 + 2;

  // Info rows
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 90, 100);

  const col2x = cx + maxTextW / 2;
  const rows = [
    [`# ${sale.saleNumber || "—"}`, `${sale.saleDate || "—"} ${sale.saleTime || ""}`],
    [sale.customerName || "—", sale.customerNickname || "—"],
  ];

  for (const [left, right] of rows) {
    doc.text(left, cx, cy, { maxWidth: maxTextW / 2 - 1 });
    doc.text(right, col2x, cy, { maxWidth: maxTextW / 2 - 1 });
    cy += 4;
  }

  // Amount removed from PDF output per business rule

  // --- RIGHT: barcode + QR ---
  const rx = x0 + LEFT_W + CENTER_W + 1;

  // Separator
  doc.setDrawColor(215, 215, 225);
  doc.setLineWidth(0.15);
  doc.line(rx - 2, y0 + pad, rx - 2, y0 + CARD_H - pad);

  let ry = y0 + pad + 1;
  const codeW = RIGHT_W - 6;

  // Barcode
  const barcodeData = generateBarcodeDataUrl(sale.barcodeValue);
  if (barcodeData) {
    try {
      doc.addImage(barcodeData, "PNG", rx, ry, codeW, 16);
    } catch { /* skip */ }
  } else {
    doc.setFontSize(5);
    doc.setTextColor(170, 170, 180);
    doc.text("Sem barcode", rx + codeW / 2, ry + 8, { align: "center" });
  }

  ry += 18;

  // QR Code
  const qrData = await generateQRCodeDataUrl(sale.qrcodeValue);
  const qrSize = Math.min(innerH - 22, 22);
  if (qrData) {
    const qrX = rx + (codeW - qrSize) / 2;
    try {
      doc.addImage(qrData, "PNG", qrX, ry, qrSize, qrSize);
    } catch { /* skip */ }
  } else {
    doc.setFontSize(5);
    doc.setTextColor(170, 170, 180);
    doc.text("Sem QR", rx + codeW / 2, ry + qrSize / 2, { align: "center" });
  }
}

function getFileName(sale: SaleData): string {
  const id = sale.saleNumber || sale.sku || sale.saleDate || "etiqueta";
  return `etiqueta-${id}.pdf`;
}

function createA4Doc(): jsPDF {
  return new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
}

export async function exportSalePdf(sale: SaleData): Promise<void> {
  const doc = createA4Doc();
  await drawSaleCard(doc, sale, MARGIN_X, MARGIN_Y);
  doc.save(getFileName(sale));
}

export async function exportBatchPdf(sales: SaleData[]): Promise<void> {
  const doc = createA4Doc();

  for (let i = 0; i < sales.length; i++) {
    const pageIndex = Math.floor(i / CARDS_PER_PAGE);
    const posInPage = i % CARDS_PER_PAGE;

    if (pageIndex > 0 && posInPage === 0) {
      doc.addPage();
    }

    const offsetY = MARGIN_Y + posInPage * (CARD_H + GAP);
    await drawSaleCard(doc, sales[i], MARGIN_X, offsetY);
  }

  const today = new Date().toISOString().slice(0, 10);
  doc.save(`etiquetas-lote-${today}.pdf`);
}
