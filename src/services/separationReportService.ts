/**
 * Relatorio de Separacao (Picking List) — agrupa pedidos por SKU/produto
 * para facilitar a separacao no estoque.
 *
 * O operador seleciona os pedidos do dia, clica "Relatorio Separacao"
 * e recebe um PDF com cada produto listado uma unica vez, com imagem,
 * nome, SKU e quantidade total a separar.
 */
import jsPDF from "jspdf";
import type { MLOrder, MLOrderItem } from "@/services/mercadoLivreService";

// ─── Tipos ──────────────────────────────────────────────────────────────

export interface SeparationItem {
  sku: string;
  title: string;
  imageUrl: string | null;
  totalQuantity: number;
  orderCount: number;
  locationCorridor?: string | null;
  locationShelf?: string | null;
  locationLevel?: string | null;
  variation?: string | null;
}

// ─── Agrupamento por SKU ────────────────────────────────────────────────

// F-M6: extractVariationFromRawItem importado de mercadoLivreHelpers
import { extractVariationFromRawItem } from "./mercadoLivreHelpers";

export function buildSeparationReport(orders: MLOrder[]): SeparationItem[] {
  const map = new Map<string, SeparationItem>();

  for (const order of orders) {
    const rawItems: any[] = Array.isArray((order.raw_data as any)?.order_items)
      ? ((order.raw_data as any).order_items as any[])
      : [];
    const items: MLOrderItem[] =
      Array.isArray(order.items) && order.items.length > 0
        ? order.items
        : [
            {
              item_title: order.item_title,
              sku: order.sku,
              quantity: order.quantity ?? 1,
              amount: order.amount,
              product_image_url: order.product_image_url,
            },
          ];

    items.forEach((item, idx) => {
      const sku = (item.sku || "").trim();
      const title = (item.item_title || "").trim();
      const variation = item.variation || extractVariationFromRawItem(rawItems[idx]) || null;
      // Chave de agrupamento: SKU + variação (diferentes variações = linhas separadas)
      const key = (sku || title || "SEM_SKU") + (variation ? `::${variation}` : "");

      const existing = map.get(key);
      if (existing) {
        existing.totalQuantity += item.quantity || 1;
        existing.orderCount += 1;
        if (!existing.imageUrl && item.product_image_url) {
          existing.imageUrl = item.product_image_url;
        }
        if (!existing.title && title) {
          existing.title = title;
        }
      } else {
        map.set(key, {
          sku: sku || "-",
          title: title || "Produto sem titulo",
          imageUrl: item.product_image_url || null,
          totalQuantity: item.quantity || 1,
          orderCount: 1,
          variation,
        });
      }
    });
  }

  // Ordena por quantidade decrescente (produto mais frequente primeiro)
  return Array.from(map.values()).sort(
    (a, b) => b.totalQuantity - a.totalQuantity || a.title.localeCompare(b.title)
  );
}

// ─── Helpers de imagem (mesma logica de pdfExportService) ───────────────

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

function drawContainedImage(
  doc: jsPDF,
  imageData: string,
  x: number,
  y: number,
  boxW: number,
  boxH: number
) {
  try {
    const props = doc.getImageProperties(imageData);
    const scale = Math.min(boxW / props.width, boxH / props.height);
    const w = props.width * scale;
    const h = props.height * scale;
    const dx = x + (boxW - w) / 2;
    const dy = y + (boxH - h) / 2;
    doc.addImage(imageData, getImageFormat(imageData), dx, dy, w, h);
  } catch {
    drawPlaceholder(doc, x, y, boxW, boxH);
  }
}

function drawPlaceholder(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.setFillColor(235, 235, 240);
  doc.roundedRect(x, y, w, h, 2, 2, "F");
  doc.setFontSize(7);
  doc.setTextColor(160, 160, 170);
  doc.text("Sem imagem", x + w / 2, y + h / 2 + 1, { align: "center" });
}

// ─── Layout constants ───────────────────────────────────────────────────

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 10;
const USABLE_W = PAGE_W - MARGIN * 2;
const HEADER_H = 20;
const ROW_H = 38; // aumentado para caber CORREDOR/ESTANTE/NIVEL/VARIAÇÃO
const IMG_SIZE = 32;
const IMG_PADDING = 2;
const QTY_W = 32;
const ROWS_PER_PAGE = Math.floor((PAGE_H - MARGIN * 2 - HEADER_H - 5) / ROW_H);

// ─── Geracao do PDF ─────────────────────────────────────────────────────

export async function exportSeparationPdf(
  items: SeparationItem[],
  meta: { date: string; totalOrders: number }
): Promise<void> {
  if (items.length === 0) return;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // Pre-carrega todas as imagens em paralelo (max 5 simultaneous)
  const imageCache = new Map<string, string | null>();
  const urls = items.map((item) => item.imageUrl).filter(Boolean) as string[];
  const uniqueUrls = [...new Set(urls)];

  for (let i = 0; i < uniqueUrls.length; i += 5) {
    const batch = uniqueUrls.slice(i, i + 5);
    const results = await Promise.all(batch.map(loadImageAsDataUrl));
    batch.forEach((url, idx) => imageCache.set(url, results[idx]));
  }

  let currentPage = 0;
  let rowOnPage = 0;

  function startPage() {
    if (currentPage > 0) doc.addPage();
    currentPage++;
    rowOnPage = 0;

    // ── Header ──
    const headerY = MARGIN;
    doc.setFillColor(51, 51, 51);
    doc.roundedRect(MARGIN, headerY, USABLE_W, HEADER_H, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("RELATORIO DE SEPARACAO", MARGIN + 5, headerY + 8);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(
      `${meta.date}  —  ${meta.totalOrders} pedidos  —  ${items.length} produtos unicos`,
      MARGIN + 5,
      headerY + 15
    );
    doc.setTextColor(0, 0, 0);

    // ── Column headers ──
    const colY = MARGIN + HEADER_H + 3;
    doc.setFillColor(245, 245, 245);
    doc.rect(MARGIN, colY, USABLE_W, 6, "F");
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 100, 100);
    doc.text("IMAGEM", MARGIN + IMG_SIZE / 2 + IMG_PADDING, colY + 4, { align: "center" });
    doc.text("PRODUTO / SKU", MARGIN + IMG_SIZE + IMG_PADDING * 2 + 2, colY + 4);
    doc.text("QTD", MARGIN + USABLE_W - QTY_W / 2, colY + 4, { align: "center" });
    doc.text("PEDIDOS", MARGIN + USABLE_W - QTY_W - 12, colY + 4, { align: "center" });
    doc.setTextColor(0, 0, 0);
  }

  startPage();

  for (let i = 0; i < items.length; i++) {
    if (rowOnPage >= ROWS_PER_PAGE) {
      startPage();
    }

    const item = items[i];
    const baseY = MARGIN + HEADER_H + 10 + rowOnPage * ROW_H;

    // ── Linha separadora ──
    if (rowOnPage > 0) {
      doc.setDrawColor(230, 230, 230);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, baseY - 1, MARGIN + USABLE_W, baseY - 1);
    }

    // ── Numero da linha (indice) ──
    doc.setFontSize(7);
    doc.setTextColor(180, 180, 180);
    doc.text(`${i + 1}`, MARGIN + 1, baseY + 3);

    // ── Imagem ──
    const imgX = MARGIN + IMG_PADDING;
    const imgY = baseY + 1;
    const imageData = item.imageUrl ? imageCache.get(item.imageUrl) : null;
    if (imageData) {
      drawContainedImage(doc, imageData, imgX, imgY, IMG_SIZE, IMG_SIZE);
    } else {
      drawPlaceholder(doc, imgX, imgY, IMG_SIZE, IMG_SIZE);
    }

    // ── Texto: Nome do produto (linha 1) ──
    const textX = MARGIN + IMG_SIZE + IMG_PADDING * 2 + 3;
    const pedidosX = MARGIN + USABLE_W - QTY_W - 15;
    const textMaxW = pedidosX - textX - 2;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    const titleLines = doc.splitTextToSize(item.title, textMaxW);
    const displayTitle = titleLines.slice(0, 1);
    doc.text(displayTitle, textX, baseY + 5);

    // ── SKU ──
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text(`SKU: ${item.sku}`, textX, baseY + 11);

    // ── CORREDOR / ESTANTE / NIVEL / VARIAÇÃO ──
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    const locY1 = baseY + 18;
    const locY2 = baseY + 24;
    const locY3 = baseY + 30;
    const locY4 = baseY + 36;

    doc.text(`CORREDOR : ${item.locationCorridor || ""}`, textX, locY1);
    doc.text(`ESTANTE : ${item.locationShelf || ""}`, textX, locY2);
    doc.text(`NIVEL : ${item.locationLevel || ""}`, textX, locY3);

    // VARIAÇÃO: destaque quando preenchida
    if (item.variation) {
      doc.setTextColor(17, 24, 39);
      doc.text(`VARIACAO : ${item.variation}`, textX, locY4);
    } else {
      doc.setTextColor(160, 160, 170);
      doc.text(`VARIACAO :`, textX, locY4);
    }

    // ── Pedidos count ──
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60, 60, 60);
    doc.text(`${item.orderCount}`, pedidosX, baseY + 16, { align: "center" });
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.text("pedido(s)", pedidosX, baseY + 20, { align: "center" });

    // ── Quantidade (grande, destaque) ──
    const qtyX = MARGIN + USABLE_W - QTY_W / 2;
    doc.setFillColor(255, 241, 89); // amarelo ML
    doc.roundedRect(MARGIN + USABLE_W - QTY_W, baseY + 2, QTY_W, 28, 3, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(17, 24, 39);
    doc.text(`${item.totalQuantity}`, qtyX, baseY + 18, { align: "center" });
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("un", qtyX, baseY + 25, { align: "center" });

    rowOnPage++;
  }

  // ── Rodape com totais ──
  const totalQty = items.reduce((sum, item) => sum + item.totalQuantity, 0);
  const lastPageY = PAGE_H - MARGIN - 8;
  doc.setDrawColor(51, 51, 51);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, lastPageY, MARGIN + USABLE_W, lastPageY);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(51, 51, 51);
  doc.text(
    `TOTAL: ${items.length} produto(s)  —  ${totalQty} unidade(s)  —  ${meta.totalOrders} pedido(s)`,
    MARGIN + 3,
    lastPageY + 5
  );

  const filename = `separacao-${meta.date}.pdf`;
  doc.save(filename);
}
