import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { SaleData } from "@/types/sales";

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

const LEFT_W = 40;
const RIGHT_W = 40;
const CENTER_W = CARD_W - LEFT_W - RIGHT_W;

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;

  try {
    const response = await fetch(url, { mode: "cors" });
    const blob = await response.blob();

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

function getImageFormat(dataUrl: string): "PNG" | "JPEG" | "WEBP" {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

function generateBarcodeDataUrl(value: string): string | null {
  if (!value) return null;

  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, value, {
      format: "CODE128",
      width: 1.2,
      height: 28,
      displayValue: false,
      margin: 1,
      background: "#ffffff",
      lineColor: "#111827",
    });
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

async function generateQRCodeDataUrl(value: string): Promise<string | null> {
  if (!value) return null;

  try {
    return await QRCode.toDataURL(value, {
      width: 120,
      margin: 1,
      color: { dark: "#111827", light: "#FFFFFF" },
    });
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

function drawContainedImage(
  doc: jsPDF,
  imageData: string,
  x: number,
  y: number,
  boxW: number,
  boxH: number
) {
  const imageProps = doc.getImageProperties(imageData);
  const scale = Math.min(boxW / imageProps.width, boxH / imageProps.height);
  const drawW = imageProps.width * scale;
  const drawH = imageProps.height * scale;
  const offsetX = x + (boxW - drawW) / 2;
  const offsetY = y + (boxH - drawH) / 2;

  doc.addImage(imageData, getImageFormat(imageData), offsetX, offsetY, drawW, drawH);
}

async function drawSaleCard(doc: jsPDF, sale: SaleData, x0: number, y0: number) {
  doc.setDrawColor(185, 185, 195);
  doc.setLineWidth(0.25);
  doc.roundedRect(x0, y0, CARD_W, CARD_H, 1.6, 1.6, "S");

  const pad = 3;
  const innerH = CARD_H - pad * 2;

  const imgBoxSize = Math.min(LEFT_W - 10, innerH - 4);
  const imgX = x0 + 5;
  const imgY = y0 + pad + (innerH - imgBoxSize) / 2;
  const imgCenterX = imgX + imgBoxSize / 2;
  const imgCenterY = imgY + imgBoxSize / 2;
  const imgRadius = imgBoxSize / 2;

  const imageSource = sale.productImageData || sale.productImageUrl;
  const imgData = imageSource ? await loadImageAsDataUrl(imageSource) : null;

  doc.setFillColor(255, 255, 255);
  doc.circle(imgCenterX, imgCenterY, imgRadius + 0.6, "F");
  doc.setDrawColor(224, 227, 232);
  doc.setLineWidth(0.6);
  doc.circle(imgCenterX, imgCenterY, imgRadius + 0.6, "S");

  if (imgData) {
    try {
      drawContainedImage(doc, imgData, imgX + 2, imgY + 2, imgBoxSize - 4, imgBoxSize - 4);
    } catch {
      drawPlaceholder(doc, imgX, imgY, imgBoxSize, imgBoxSize);
    }
  } else {
    drawPlaceholder(doc, imgX, imgY, imgBoxSize, imgBoxSize);
  }

  const cx = x0 + LEFT_W + 2.5;
  let cy = y0 + pad + 0.5;
  const maxTextW = CENTER_W - 6.5;

  doc.setFillColor(232, 237, 250);
  doc.roundedRect(cx, cy, 30, 5.5, 1.2, 1.2, "F");
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(60, 80, 180);
  doc.text(`SKU: ${sale.sku || "-"}`, cx + 15, cy + 3.7, { align: "center" });

  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120, 120, 130);
  doc.text(`${sale.quantity} unidade${sale.quantity !== 1 ? "s" : ""}`, cx + 33, cy + 3.7);
  cy += 8.5;

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 40);
  const productLines = doc.splitTextToSize(sale.productName || "-", maxTextW);
  doc.text(productLines.slice(0, 2), cx, cy);
  cy += Math.min(productLines.length, 2) * 3.9 + 1.5;

  doc.setFontSize(6.2);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110, 110, 120);
  doc.text(`#${sale.saleNumber || "-"}`, cx, cy, { maxWidth: maxTextW });
  cy += 3.6;
  doc.text(`${sale.saleDate || "-"} ${sale.saleTime || ""}`.trim(), cx, cy, {
    maxWidth: maxTextW,
  });
  cy += 5;

  doc.setFontSize(9.5);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(45, 45, 55);
  doc.text(sale.customerName || "-", cx, cy, { maxWidth: maxTextW * 0.6 });

  doc.setFontSize(8.7);
  doc.setTextColor(120, 120, 130);
  doc.text(sale.customerNickname || "-", cx + maxTextW * 0.62, cy, {
    maxWidth: maxTextW * 0.38,
  });

  const rx = x0 + LEFT_W + CENTER_W + 2;
  doc.setDrawColor(215, 215, 225);
  doc.setLineWidth(0.15);
  doc.line(rx - 2, y0 + pad, rx - 2, y0 + CARD_H - pad);

  let ry = y0 + pad + 1;
  const codeW = RIGHT_W - 8;

  const barcodeData = generateBarcodeDataUrl(sale.barcodeValue);
  doc.setFontSize(5.4);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120, 120, 130);
  doc.text("Codigo de barras", rx + codeW / 2, ry + 1, { align: "center" });
  ry += 2.8;

  if (barcodeData) {
    try {
      doc.addImage(barcodeData, "PNG", rx, ry, codeW, 14);
    } catch {
      doc.setFontSize(5);
      doc.setTextColor(170, 170, 180);
      doc.text("Sem barcode", rx + codeW / 2, ry + 7, { align: "center" });
    }
  } else {
    doc.setFontSize(5);
    doc.setTextColor(170, 170, 180);
    doc.text("Sem barcode", rx + codeW / 2, ry + 7, { align: "center" });
  }

  ry += 15;
  doc.setFontSize(5.2);
  doc.setTextColor(120, 120, 130);
  doc.text(sale.barcodeValue || "-", rx + codeW / 2, ry, { align: "center" });
  ry += 4.5;

  const qrData = await generateQRCodeDataUrl(sale.qrcodeValue);
  doc.setFontSize(5.4);
  doc.setTextColor(120, 120, 130);
  doc.text("QR code", rx + codeW / 2, ry, { align: "center" });
  ry += 2.4;

  const qrSize = Math.min(innerH - 24, 18);
  if (qrData) {
    const qrX = rx + (codeW - qrSize) / 2;
    try {
      doc.addImage(qrData, "PNG", qrX, ry, qrSize, qrSize);
    } catch {
      doc.setFontSize(5);
      doc.setTextColor(170, 170, 180);
      doc.text("Sem QR", rx + codeW / 2, ry + qrSize / 2, { align: "center" });
    }
  } else {
    doc.setFontSize(5);
    doc.setTextColor(170, 170, 180);
    doc.text("Sem QR", rx + codeW / 2, ry + qrSize / 2, { align: "center" });
  }

  doc.setFontSize(5.2);
  doc.setTextColor(120, 120, 130);
  doc.text(sale.qrcodeValue || "-", rx + codeW / 2, ry + qrSize + 2.8, {
    align: "center",
  });
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

  for (let index = 0; index < sales.length; index += 1) {
    const pageIndex = Math.floor(index / CARDS_PER_PAGE);
    const posInPage = index % CARDS_PER_PAGE;

    if (pageIndex > 0 && posInPage === 0) {
      doc.addPage();
    }

    const offsetY = MARGIN_Y + posInPage * (CARD_H + GAP);
    await drawSaleCard(doc, sales[index], MARGIN_X, offsetY);
  }

  const today = new Date().toISOString().slice(0, 10);
  doc.save(`etiquetas-lote-${today}.pdf`);
}
