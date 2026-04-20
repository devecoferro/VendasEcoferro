/**
 * Relatorio de Estoque (PDF) — exporta a listagem atual da StockPage
 * respeitando os filtros aplicados (busca, marca, modelo, ano, status,
 * "so vendidos", periodo de vendas) e a ordenacao escolhida pelo usuario.
 *
 * Casos de uso:
 *   - Lista impressa pra conferencia fisica do estoque
 *   - "Top mais vendidos nos ultimos 30 dias" pra ver o que repor
 *   - Lista de produtos pausados pra revisar
 *   - Lista de "Sem SKU" pra cadastrar
 *
 * O operador NAO precisa configurar nada — clica "Imprimir Lista" e o
 * PDF sai exatamente com os mesmos produtos que estao visiveis na tela
 * (mesmos filtros, mesma ordenacao). E uma "snapshot" do que ele ve.
 */
import jsPDF from "jspdf";
import type { MLStockItem } from "@/services/mercadoLivreService";

export interface StockReportFilters {
  search: string;
  brand: string;
  model: string;
  year: string;
  status: string;
  onlyMissingSku: boolean;
  onlyWithRecentSales: boolean;
  salesPeriodLabel: string;
  salesPeriodShort: string;
  sortLabel: string;
}

// ─── Helpers de imagem (paralelo limitado, mesmo padrao do separation) ──

/**
 * Carrega imagem como data URL pra embedar no PDF.
 *
 * Estrategia em 2 etapas pra ser resiliente:
 *
 *   1. Tenta fetch DIRETO da URL original. Algumas thumbnails do ML
 *      retornam CORS aberto e funcionam. Tambem cobre o caso do
 *      backend nao ter o /api/ml/image-proxy disponivel ainda.
 *
 *   2. Se o fetch direto falhar (CORS, network, etc), tenta via
 *      /api/ml/image-proxy?url=... que faz proxy server-side.
 *
 *   3. Se o proxy tambem falhar, retorna null (placeholder no PDF).
 *
 * URLs same-origin (data: ou caminho do proprio dominio) sao usadas
 * diretamente sem retentar.
 */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { mode: "cors" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob || blob.size === 0) return null;
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Sanity: tem que ser data:image/...
        if (result && result.startsWith("data:image/")) {
          resolve(result);
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;

  let isExternal = false;
  try {
    const parsed = new URL(url, window.location.href);
    isExternal =
      typeof window !== "undefined" &&
      parsed.host !== "" &&
      parsed.host !== window.location.host;
  } catch {
    // URL invalida — tenta fetch direto mesmo assim
  }

  // 1. Tenta fetch direto primeiro (cobre o caso do proxy nao estar
  //    disponivel e algumas URLs com CORS aberto).
  const direct = await fetchAsDataUrl(url);
  if (direct) return direct;

  // 2. Se direto falhou e e externa, tenta via proxy do backend.
  if (isExternal) {
    const proxyUrl = `/api/ml/image-proxy?url=${encodeURIComponent(url)}`;
    const viaProxy = await fetchAsDataUrl(proxyUrl);
    if (viaProxy) return viaProxy;
  }

  return null;
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
  doc.setFillColor(240, 240, 245);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, "F");
}

// ─── Formatacao de "ha X dias" igual a UI ───────────────────────────────

function formatDaysAgo(isoDate: string | null | undefined): string {
  if (!isoDate) return "—";
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "—";
  const diffDays = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return "hoje";
  if (diffDays === 1) return "ontem";
  if (diffDays < 30) return `${diffDays}d`;
  if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months}m`;
  }
  return `${Math.floor(diffDays / 365)}a`;
}

function formatPrice(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// ─── Layout constants (A4 paisagem pra caber todas as colunas) ──────────

const PAGE_W = 297;
const PAGE_H = 210;
const MARGIN = 8;
const USABLE_W = PAGE_W - MARGIN * 2;

// Colunas (somam 100% do USABLE_W). Imagem aumentou de 16mm pra 22mm
// pra ficar visivel — a imagem do produto e referencia critica pra
// quem usa o relatorio na separacao fisica.
const COLS = {
  index: { x: 0, w: 6, label: "#", align: "right" as const },
  image: { x: 6, w: 22, label: "", align: "center" as const },
  product: { x: 28, w: 89, label: "PRODUTO / SKU", align: "left" as const },
  location: { x: 117, w: 30, label: "LOCALIZAÇÃO", align: "center" as const },
  available: { x: 147, w: 18, label: "DISP.", align: "center" as const },
  sales: { x: 165, w: 28, label: "VENDAS", align: "center" as const },
  lastSale: { x: 193, w: 22, label: "ÚLTIMA", align: "center" as const },
  price: { x: 215, w: 28, label: "PREÇO", align: "right" as const },
  status: { x: 243, w: 38, label: "STATUS", align: "center" as const },
};

const HEADER_H = 24;
// Altura da linha aumentada de 16mm pra 22mm pra acomodar imagem maior
// (18mm) com margem de 2mm em cima/baixo.
const ROW_H = 22;
const COL_HEADER_H = 7;
const ROWS_PER_PAGE = Math.floor((PAGE_H - MARGIN * 2 - HEADER_H - COL_HEADER_H - 12) / ROW_H);
const IMG_SIZE = 18;

// ─── Geracao do PDF ─────────────────────────────────────────────────────

export async function exportStockListPdf(
  items: MLStockItem[],
  filters: StockReportFilters,
  meta: { totalInBase: number }
): Promise<void> {
  if (items.length === 0) {
    throw new Error("Nenhum produto pra imprimir — ajuste os filtros.");
  }

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  // Pre-carrega thumbnails em batches (max 5 paralelos) — lista de 200+
  // produtos sem batch trava o browser por download paralelo excessivo.
  const imageCache = new Map<string, string | null>();
  const urls = items.map((item) => item.thumbnail).filter(Boolean) as string[];
  const uniqueUrls = [...new Set(urls)];
  for (let i = 0; i < uniqueUrls.length; i += 5) {
    const batch = uniqueUrls.slice(i, i + 5);
    const results = await Promise.all(batch.map(loadImageAsDataUrl));
    batch.forEach((url, idx) => imageCache.set(url, results[idx]));
  }

  // Estatisticas pro cabecalho
  const totalQty = items.reduce((sum, it) => sum + (it.available_quantity || 0), 0);
  const totalRecentSales = items.reduce(
    (sum, it) => sum + (it.recent_sales_qty || 0),
    0
  );
  const itemsWithRecentSales = items.filter(
    (it) => (it.recent_sales_qty || 0) > 0
  ).length;

  const dateString = new Date().toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  let currentPage = 0;
  let rowOnPage = 0;
  const totalPages = Math.ceil(items.length / ROWS_PER_PAGE);

  function startPage() {
    if (currentPage > 0) doc.addPage();
    currentPage++;
    rowOnPage = 0;

    // ── Header principal ──
    doc.setFillColor(51, 51, 51);
    doc.roundedRect(MARGIN, MARGIN, USABLE_W, HEADER_H, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont("helvetica", "bold");
    doc.text("RELATÓRIO DE ESTOQUE", MARGIN + 4, MARGIN + 7);

    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.text(
      `Gerado em ${dateString}  ·  ${items.length} produto${items.length === 1 ? "" : "s"} de ${meta.totalInBase} no total  ·  pagina ${currentPage}/${totalPages}`,
      MARGIN + 4,
      MARGIN + 12
    );

    // Linha de filtros aplicados
    const activeFilterParts: string[] = [];
    if (filters.search) activeFilterParts.push(`busca: "${filters.search}"`);
    if (filters.brand !== "all") activeFilterParts.push(`marca: ${filters.brand}`);
    if (filters.model !== "all") activeFilterParts.push(`modelo: ${filters.model}`);
    if (filters.year !== "all") activeFilterParts.push(`ano: ${filters.year}`);
    if (filters.status !== "all") activeFilterParts.push(`status: ${filters.status}`);
    if (filters.onlyMissingSku) activeFilterParts.push("somente sem SKU");
    if (filters.onlyWithRecentSales)
      activeFilterParts.push(`somente vendidos ${filters.salesPeriodLabel}`);
    activeFilterParts.push(`vendas: ${filters.salesPeriodLabel}`);
    activeFilterParts.push(`ordem: ${filters.sortLabel}`);

    doc.setFontSize(7);
    doc.text(
      `Filtros: ${activeFilterParts.join(" · ")}`,
      MARGIN + 4,
      MARGIN + 17
    );

    // Stats no canto direito do header
    doc.setFontSize(7);
    const statsText = `${totalQty} disponíveis  ·  ${totalRecentSales} vendidas ${filters.salesPeriodShort}  ·  ${itemsWithRecentSales} c/ venda`;
    const statsW = doc.getTextWidth(statsText);
    doc.text(statsText, MARGIN + USABLE_W - statsW - 4, MARGIN + 17);

    doc.setTextColor(0, 0, 0);

    // ── Cabecalho das colunas ──
    const colY = MARGIN + HEADER_H + 2;
    doc.setFillColor(245, 245, 245);
    doc.rect(MARGIN, colY, USABLE_W, COL_HEADER_H, "F");
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(80, 80, 80);

    for (const col of Object.values(COLS)) {
      if (!col.label) continue;
      const baseX = MARGIN + col.x;
      let textX = baseX + 1;
      const opts: { align: "left" | "right" | "center" } = { align: "left" };
      if (col.align === "right") {
        textX = baseX + col.w - 1;
        opts.align = "right";
      } else if (col.align === "center") {
        textX = baseX + col.w / 2;
        opts.align = "center";
      }
      doc.text(col.label, textX, colY + 4.5, opts);
    }

    doc.setTextColor(0, 0, 0);
  }

  startPage();

  for (let i = 0; i < items.length; i++) {
    if (rowOnPage >= ROWS_PER_PAGE) {
      startPage();
    }

    const item = items[i];
    const rowY = MARGIN + HEADER_H + COL_HEADER_H + 4 + rowOnPage * ROW_H;

    // Linha separadora suave
    if (rowOnPage > 0) {
      doc.setDrawColor(235, 235, 235);
      doc.setLineWidth(0.2);
      doc.line(MARGIN, rowY - 1, MARGIN + USABLE_W, rowY - 1);
    }

    // Centro vertical da linha (rowY + ROW_H/2 = rowY + 11). As posicoes
    // Y abaixo foram recalculadas pra distribuir o conteudo nesse espaco
    // de 22mm em vez dos 16mm anteriores.

    // ── # (indice global na lista filtrada) — centralizado vertical ──
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(160, 160, 165);
    doc.text(
      String(i + 1),
      MARGIN + COLS.index.x + COLS.index.w - 1,
      rowY + 12,
      { align: "right" }
    );

    // ── Imagem (18mm centralizada na linha de 22mm = 2mm margem) ──
    const imgX = MARGIN + COLS.image.x + (COLS.image.w - IMG_SIZE) / 2;
    const imgY = rowY + (ROW_H - IMG_SIZE) / 2;
    const imageData = item.thumbnail ? imageCache.get(item.thumbnail) : null;
    if (imageData) {
      drawContainedImage(doc, imageData, imgX, imgY, IMG_SIZE, IMG_SIZE);
    } else {
      drawPlaceholder(doc, imgX, imgY, IMG_SIZE, IMG_SIZE);
    }

    // ── Produto + SKU + item_id (3 linhas distribuidas no Y) ──
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(30, 30, 30);
    const productLines = doc.splitTextToSize(
      item.title || "(sem título)",
      COLS.product.w - 2
    );
    doc.text(productLines.slice(0, 1), MARGIN + COLS.product.x + 1, rowY + 7);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    if (item.sku) {
      doc.setTextColor(110, 110, 115);
      doc.text(`SKU: ${item.sku}`, MARGIN + COLS.product.x + 1, rowY + 12);
    } else {
      doc.setTextColor(200, 60, 60);
      doc.text("⚠ SEM SKU", MARGIN + COLS.product.x + 1, rowY + 12);
    }

    doc.setTextColor(140, 140, 145);
    doc.setFontSize(6.5);
    doc.text(item.item_id, MARGIN + COLS.product.x + 1, rowY + 17);

    // ── Localizacao (centralizada vertical) ──
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(80, 80, 90);
    if (
      item.location_corridor ||
      item.location_shelf ||
      item.location_level
    ) {
      const locText = [
        item.location_corridor || "—",
        item.location_shelf || "—",
        item.location_level || "—",
      ].join("·");
      doc.text(
        locText,
        MARGIN + COLS.location.x + COLS.location.w / 2,
        rowY + 12,
        { align: "center" }
      );
    } else {
      doc.setTextColor(180, 180, 185);
      doc.text(
        "—",
        MARGIN + COLS.location.x + COLS.location.w / 2,
        rowY + 12,
        { align: "center" }
      );
    }

    // ── Disponivel (numero grande centralizado) ──
    const isOut = item.available_quantity === 0;
    const isLow = item.available_quantity <= 3 && item.status === "active";
    if (isOut) doc.setTextColor(200, 50, 50);
    else if (isLow) doc.setTextColor(220, 130, 30);
    else doc.setTextColor(40, 40, 45);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(
      String(item.available_quantity),
      MARGIN + COLS.available.x + COLS.available.w / 2,
      rowY + 13,
      { align: "center" }
    );

    // ── Vendas no periodo (qty grande + qtd pedidos pequena) ──
    const salesQty = item.recent_sales_qty || 0;
    const salesOrders = item.recent_sales_orders || 0;
    if (salesQty > 0) {
      doc.setTextColor(220, 90, 30);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(
        `${salesQty}`,
        MARGIN + COLS.sales.x + COLS.sales.w / 2,
        rowY + 11,
        { align: "center" }
      );
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(140, 140, 145);
      doc.text(
        `${salesOrders} ped${salesOrders !== 1 ? "s" : ""}`,
        MARGIN + COLS.sales.x + COLS.sales.w / 2,
        rowY + 16,
        { align: "center" }
      );
    } else {
      doc.setTextColor(180, 180, 185);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(
        "—",
        MARGIN + COLS.sales.x + COLS.sales.w / 2,
        rowY + 12,
        { align: "center" }
      );
      if (item.sold_quantity > 0) {
        doc.setFontSize(6);
        doc.setTextColor(170, 170, 175);
        doc.text(
          `tot:${item.sold_quantity}`,
          MARGIN + COLS.sales.x + COLS.sales.w / 2,
          rowY + 17,
          { align: "center" }
        );
      }
    }

    // ── Ultima venda ──
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(item.last_sale_date ? 80 : 180, item.last_sale_date ? 80 : 180, item.last_sale_date ? 90 : 185);
    doc.text(
      item.last_sale_date ? formatDaysAgo(item.last_sale_date) : "—",
      MARGIN + COLS.lastSale.x + COLS.lastSale.w / 2,
      rowY + 13,
      { align: "center" }
    );

    // ── Preco ──
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(40, 40, 45);
    doc.text(
      formatPrice(item.price),
      MARGIN + COLS.price.x + COLS.price.w - 1,
      rowY + 13,
      { align: "right" }
    );

    // ── Status (badge colorido pequeno) ──
    let statusBgR = 220,
      statusBgG = 220,
      statusBgB = 225;
    let statusFgR = 90,
      statusFgG = 90,
      statusFgB = 95;
    const statusLabel = (item.status || "—").toUpperCase();
    if (item.status === "active") {
      statusBgR = 220; statusBgG = 245; statusBgB = 230;
      statusFgR = 30; statusFgG = 130; statusFgB = 80;
    } else if (item.status === "paused") {
      statusBgR = 252; statusBgG = 240; statusBgB = 200;
      statusFgR = 160; statusFgG = 110; statusFgB = 20;
    } else if (item.status === "closed" || item.status === "under_review") {
      statusBgR = 245; statusBgG = 225; statusBgB = 225;
      statusFgR = 170; statusFgG = 50; statusFgB = 50;
    }
    const badgeW = Math.min(28, Math.max(15, doc.getTextWidth(statusLabel) * 0.7 + 6));
    const badgeH = 5;
    const badgeX = MARGIN + COLS.status.x + (COLS.status.w - badgeW) / 2;
    const badgeY = rowY + (ROW_H - badgeH) / 2;
    doc.setFillColor(statusBgR, statusBgG, statusBgB);
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.5, 1.5, "F");
    doc.setFontSize(6);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(statusFgR, statusFgG, statusFgB);
    doc.text(statusLabel, badgeX + badgeW / 2, badgeY + 3.4, { align: "center" });

    rowOnPage++;
  }

  // ── Rodape (na ultima pagina) ──
  const footerY = PAGE_H - MARGIN - 4;
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, footerY - 3, MARGIN + USABLE_W, footerY - 3);
  doc.setFontSize(6.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120, 120, 125);
  doc.text(
    "Gerado pelo VendasEcoferro · Snapshot do estoque com filtros aplicados",
    MARGIN + 1,
    footerY
  );
  doc.text(
    `${items.length} produtos · ${totalQty} unidades disponíveis · ${totalRecentSales} vendidas ${filters.salesPeriodShort}`,
    MARGIN + USABLE_W - 1,
    footerY,
    { align: "right" }
  );

  const dateForFile = new Date().toISOString().slice(0, 10);
  const filterTag = filters.onlyWithRecentSales
    ? "vendidos"
    : filters.onlyMissingSku
      ? "sem-sku"
      : filters.status !== "all"
        ? filters.status
        : "completo";
  doc.save(`estoque-${filterTag}-${dateForFile}.pdf`);
}
