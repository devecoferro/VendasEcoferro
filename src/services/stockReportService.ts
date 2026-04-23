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
import { jsPDF } from "jspdf";
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

/**
 * Quais colunas OPCIONAIS incluir no relatório. "#" e "PRODUTO/SKU" são
 * sempre incluídas (identificação mínima do produto). As demais podem
 * ser desligadas pra gerar PDF mais enxuto.
 *
 * Quando todas as opcionais estão ativas (default), o layout é o mesmo
 * da versão anterior. Quando alguma é desligada, as larguras das
 * colunas restantes são redistribuídas proporcionalmente pra preencher
 * a página A4 paisagem inteira.
 */
export interface StockReportColumnOptions {
  image?: boolean;
  location?: boolean;
  available?: boolean;
  sales?: boolean;
  lastSale?: boolean;
  price?: boolean;
  status?: boolean;
}

export const DEFAULT_STOCK_REPORT_COLUMNS: Required<StockReportColumnOptions> = {
  image: true,
  location: true,
  available: true,
  sales: true,
  lastSale: true,
  price: true,
  status: true,
};

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
async function fetchAsDataUrl(
  url: string,
  timeoutMs = 8000
): Promise<string | null> {
  // Timeout via AbortController — evita que uma URL lenta trave o PDF inteiro
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      mode: "cors",
      credentials: "include",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob || blob.size === 0) return null;
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
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
  } finally {
    window.clearTimeout(timeoutId);
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

  // NOVA estrategia (2026-04-21): priorizar PROXY pra URLs externas.
  // O fetch direto falhava na maioria das thumbnails do ML por CORS (sem
  // Access-Control-Allow-Origin). Ir direto pro proxy do backend contorna
  // isso e evita o delay do fetch direto falhando primeiro.
  if (isExternal) {
    // Normaliza http -> https (ML as vezes retorna http antigo)
    const normalizedUrl = url.startsWith("http://")
      ? url.replace("http://", "https://")
      : url;
    const proxyUrl = `/api/ml/image-proxy?url=${encodeURIComponent(normalizedUrl)}`;
    const viaProxy = await fetchAsDataUrl(proxyUrl);
    if (viaProxy) return viaProxy;
    // Proxy falhou — fallback fetch direto (algumas URLs tem CORS aberto)
    const direct = await fetchAsDataUrl(url);
    if (direct) return direct;
    return null;
  }

  // URL same-origin (data: ou relativa) — fetch direto
  return await fetchAsDataUrl(url);
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

// Larguras BASE das colunas (somam ao USABLE_W quando todas estão ativas).
// Se alguma for removida, as restantes escalam proporcionalmente.
const COL_WIDTHS_BASE = {
  index: 6,
  image: 22,
  product: 89,
  location: 30,
  available: 18,
  sales: 28,
  lastSale: 22,
  price: 28,
  status: 38,
};

type ColumnKey = keyof typeof COL_WIDTHS_BASE;

interface ColumnLayout {
  x: number;
  w: number;
  label: string;
  align: "left" | "right" | "center";
}

/**
 * Monta o layout de colunas considerando quais estão ativas.
 * Larguras das colunas fixas (# + produto) mantém proporção original;
 * as opcionais redistribuem o espaço que sobrar.
 */
function buildColumnLayout(
  columns: Required<StockReportColumnOptions>
): Record<ColumnKey, ColumnLayout> {
  const alwaysOn: ColumnKey[] = ["index", "product"];
  const optional: Array<[ColumnKey, boolean]> = [
    ["image", columns.image],
    ["location", columns.location],
    ["available", columns.available],
    ["sales", columns.sales],
    ["lastSale", columns.lastSale],
    ["price", columns.price],
    ["status", columns.status],
  ];
  const activeKeys = [...alwaysOn, ...optional.filter(([, on]) => on).map(([k]) => k)];

  // Larguras "fixas" usam o valor base. Espaço remanescente vai pras
  // demais colunas (image, location, available, etc) proporcionalmente.
  const fixedWidth = activeKeys.reduce(
    (sum, k) => sum + COL_WIDTHS_BASE[k],
    0
  );
  const scale = USABLE_W / fixedWidth;

  const labels: Record<ColumnKey, string> = {
    index: "#",
    image: "",
    product: "PRODUTO / SKU",
    location: "LOCALIZAÇÃO",
    available: "DISP.",
    sales: "VENDAS",
    lastSale: "ÚLTIMA",
    price: "PREÇO",
    status: "STATUS",
  };
  const aligns: Record<ColumnKey, ColumnLayout["align"]> = {
    index: "right",
    image: "center",
    product: "left",
    location: "center",
    available: "center",
    sales: "center",
    lastSale: "center",
    price: "right",
    status: "center",
  };

  const result = {} as Record<ColumnKey, ColumnLayout>;
  let xCursor = 0;
  const allKeys: ColumnKey[] = [
    "index",
    "image",
    "product",
    "location",
    "available",
    "sales",
    "lastSale",
    "price",
    "status",
  ];
  for (const key of allKeys) {
    const isActive = activeKeys.includes(key);
    const w = isActive ? COL_WIDTHS_BASE[key] * scale : 0;
    result[key] = {
      x: xCursor,
      w,
      label: labels[key],
      align: aligns[key],
    };
    if (isActive) xCursor += w;
  }
  return result;
}

/** Legacy default layout (todas colunas ativas) — usado se o caller não
 *  passar `columns`. Mantém retrocompatibilidade. */
const COLS = buildColumnLayout(DEFAULT_STOCK_REPORT_COLUMNS);

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
  meta: { totalInBase: number; columns?: StockReportColumnOptions }
): Promise<void> {
  if (items.length === 0) {
    throw new Error("Nenhum produto pra imprimir — ajuste os filtros.");
  }

  // Resolve quais colunas estão ativas (default = todas) e monta layout
  const columnsResolved: Required<StockReportColumnOptions> = {
    ...DEFAULT_STOCK_REPORT_COLUMNS,
    ...(meta.columns || {}),
  };
  const layout = buildColumnLayout(columnsResolved);

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

  // ── Agrupa items por marca, ordenadas por total de vendas (desc) ──
  // Cada marca vira uma "seção" no PDF com um header destacado antes dos
  // itens. Marcas sem nome vão pra "(sem marca)" no final.
  const itemsByBrand = new Map<string, MLStockItem[]>();
  for (const it of items) {
    const brandRaw = (it.brand || "").trim();
    const brandKey = brandRaw || "(sem marca)";
    if (!itemsByBrand.has(brandKey)) itemsByBrand.set(brandKey, []);
    itemsByBrand.get(brandKey)!.push(it);
  }
  const brandMetrics = new Map<
    string,
    { totalSales: number; totalAvail: number; count: number }
  >();
  for (const [brand, brandItems] of itemsByBrand) {
    brandMetrics.set(brand, {
      totalSales: brandItems.reduce((s, i) => s + (i.recent_sales_qty || 0), 0),
      totalAvail: brandItems.reduce((s, i) => s + (i.available_quantity || 0), 0),
      count: brandItems.length,
    });
  }
  const brandsSorted = [...itemsByBrand.keys()].sort((a, b) => {
    // "(sem marca)" sempre no final
    if (a === "(sem marca)") return 1;
    if (b === "(sem marca)") return -1;
    const sa = brandMetrics.get(a)?.totalSales || 0;
    const sb = brandMetrics.get(b)?.totalSales || 0;
    if (sa !== sb) return sb - sa; // desc
    return a.localeCompare(b, "pt-BR");
  });

  // Sequência final de renderização: brand_header + items. Cada entrada
  // consome 1 "slot" do ROWS_PER_PAGE pra simplificar paginação.
  type RenderEntry =
    | { type: "brand"; brand: string; count: number; totalSales: number; totalAvail: number }
    | { type: "item"; item: MLStockItem; index: number };
  const renderSequence: RenderEntry[] = [];
  let globalIndex = 0;
  for (const brand of brandsSorted) {
    const m = brandMetrics.get(brand)!;
    renderSequence.push({
      type: "brand",
      brand,
      count: m.count,
      totalSales: m.totalSales,
      totalAvail: m.totalAvail,
    });
    for (const item of itemsByBrand.get(brand)!) {
      globalIndex++;
      renderSequence.push({ type: "item", item, index: globalIndex });
    }
  }

  let currentPage = 0;
  let rowOnPage = 0;
  const totalPages = Math.ceil(renderSequence.length / ROWS_PER_PAGE);

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

    for (const col of Object.values(layout)) {
      if (col.w <= 0) continue; // coluna desativada
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

  for (const entry of renderSequence) {
    if (rowOnPage >= ROWS_PER_PAGE) {
      startPage();
    }

    const rowY = MARGIN + HEADER_H + COL_HEADER_H + 4 + rowOnPage * ROW_H;

    // ── Brand header: banner com nome da marca + métricas ──
    if (entry.type === "brand") {
      doc.setFillColor(235, 242, 255);
      doc.rect(MARGIN, rowY, USABLE_W, ROW_H, "F");
      doc.setDrawColor(100, 140, 220);
      doc.setLineWidth(0.4);
      doc.line(MARGIN, rowY, MARGIN + USABLE_W, rowY);
      doc.line(MARGIN, rowY + ROW_H, MARGIN + USABLE_W, rowY + ROW_H);

      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(30, 60, 120);
      doc.text(entry.brand.toUpperCase(), MARGIN + 4, rowY + 9);

      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(60, 80, 120);
      const statsText = `${entry.count} produto${entry.count === 1 ? "" : "s"}  ·  ${entry.totalAvail} em estoque  ·  ${entry.totalSales} vendida${entry.totalSales === 1 ? "" : "s"} ${filters.salesPeriodShort}`;
      const statsW = doc.getTextWidth(statsText);
      doc.text(statsText, MARGIN + USABLE_W - statsW - 4, rowY + 9);

      doc.setFontSize(6.5);
      doc.setTextColor(100, 120, 150);
      doc.text(
        `Ordenada por vendas ${filters.salesPeriodLabel}`,
        MARGIN + 4,
        rowY + 16
      );

      doc.setTextColor(0, 0, 0);
      rowOnPage++;
      continue;
    }

    const { item, index: i } = entry;

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
      String(i),
      MARGIN + layout.index.x + layout.index.w - 1,
      rowY + 12,
      { align: "right" }
    );

    // ── Imagem (centralizada na coluna, aproveitando toda a largura) ──
    if (layout.image.w > 0) {
      const imgSize = Math.min(IMG_SIZE, layout.image.w - 2);
      const imgX = MARGIN + layout.image.x + (layout.image.w - imgSize) / 2;
      const imgY = rowY + (ROW_H - imgSize) / 2;
      const imageData = item.thumbnail ? imageCache.get(item.thumbnail) : null;
      if (imageData) {
        drawContainedImage(doc, imageData, imgX, imgY, imgSize, imgSize);
      } else {
        drawPlaceholder(doc, imgX, imgY, imgSize, imgSize);
      }
    }

    // ── Produto + SKU + item_id (3 linhas distribuidas no Y) ──
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(30, 30, 30);
    const productLines = doc.splitTextToSize(
      item.title || "(sem título)",
      layout.product.w - 2
    );
    doc.text(productLines.slice(0, 1), MARGIN + layout.product.x + 1, rowY + 7);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    if (item.sku) {
      doc.setTextColor(110, 110, 115);
      doc.text(`SKU: ${item.sku}`, MARGIN + layout.product.x + 1, rowY + 12);
    } else {
      doc.setTextColor(200, 60, 60);
      doc.text("⚠ SEM SKU", MARGIN + layout.product.x + 1, rowY + 12);
    }

    doc.setTextColor(140, 140, 145);
    doc.setFontSize(6.5);
    doc.text(item.item_id, MARGIN + layout.product.x + 1, rowY + 17);

    // ── Localizacao (centralizada vertical) ──
    if (layout.location.w > 0) {
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
          MARGIN + layout.location.x + layout.location.w / 2,
          rowY + 12,
          { align: "center" }
        );
      } else {
        doc.setTextColor(180, 180, 185);
        doc.text(
          "—",
          MARGIN + layout.location.x + layout.location.w / 2,
          rowY + 12,
          { align: "center" }
        );
      }
    }

    // ── Disponivel (numero grande centralizado) ──
    if (layout.available.w > 0) {
      const isOut = item.available_quantity === 0;
      const isLow = item.available_quantity <= 3 && item.status === "active";
      if (isOut) doc.setTextColor(200, 50, 50);
      else if (isLow) doc.setTextColor(220, 130, 30);
      else doc.setTextColor(40, 40, 45);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text(
        String(item.available_quantity),
        MARGIN + layout.available.x + layout.available.w / 2,
        rowY + 13,
        { align: "center" }
      );
    }

    // ── Vendas no periodo (qty grande + qtd pedidos pequena) ──
    if (layout.sales.w > 0) {
      const salesQty = item.recent_sales_qty || 0;
      const salesOrders = item.recent_sales_orders || 0;
      if (salesQty > 0) {
        doc.setTextColor(220, 90, 30);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text(
          `${salesQty}`,
          MARGIN + layout.sales.x + layout.sales.w / 2,
          rowY + 11,
          { align: "center" }
        );
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(140, 140, 145);
        doc.text(
          `${salesOrders} ped${salesOrders !== 1 ? "s" : ""}`,
          MARGIN + layout.sales.x + layout.sales.w / 2,
          rowY + 16,
          { align: "center" }
        );
      } else {
        doc.setTextColor(180, 180, 185);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(
          "—",
          MARGIN + layout.sales.x + layout.sales.w / 2,
          rowY + 12,
          { align: "center" }
        );
        if (item.sold_quantity > 0) {
          doc.setFontSize(6);
          doc.setTextColor(170, 170, 175);
          doc.text(
            `tot:${item.sold_quantity}`,
            MARGIN + layout.sales.x + layout.sales.w / 2,
            rowY + 17,
            { align: "center" }
          );
        }
      }
    }

    // ── Ultima venda ──
    if (layout.lastSale.w > 0) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(item.last_sale_date ? 80 : 180, item.last_sale_date ? 80 : 180, item.last_sale_date ? 90 : 185);
      doc.text(
        item.last_sale_date ? formatDaysAgo(item.last_sale_date) : "—",
        MARGIN + layout.lastSale.x + layout.lastSale.w / 2,
        rowY + 13,
        { align: "center" }
      );
    }

    // ── Preco ──
    if (layout.price.w > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(40, 40, 45);
      doc.text(
        formatPrice(item.price),
        MARGIN + layout.price.x + layout.price.w - 1,
        rowY + 13,
        { align: "right" }
      );
    }

    // ── Status (badge colorido pequeno) ──
    if (layout.status.w > 0) {
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
    const badgeX = MARGIN + layout.status.x + (layout.status.w - badgeW) / 2;
    const badgeY = rowY + (ROW_H - badgeH) / 2;
    doc.setFillColor(statusBgR, statusBgG, statusBgB);
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 1.5, 1.5, "F");
    doc.setFontSize(6);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(statusFgR, statusFgG, statusFgB);
    doc.text(statusLabel, badgeX + badgeW / 2, badgeY + 3.4, { align: "center" });
    } // fim if (layout.status.w > 0)

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
