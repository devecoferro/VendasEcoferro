import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { type SaleData, type SaleItemData } from "@/types/sales";

// ═══════════════════════════════════════════════════════════════════
// Etiqueta interna Ecoferro — padrão visual definido em
// `arquivos em imagens para alteração/modelo para etiquetas/`.
//
// Layout A4 retrato com 5 etiquetas por página. Cada etiqueta (card):
//
//   ┌──────────────────────────────────────────────────────────────┐
//   │[ML logo]  SKU: EC005                       QR Objeto (label) │
//   │          Nome do Produto                                     │
//   │          Nome Comprador                  [  QR code grande  ]│
//   │          NICKNAME                                            │
//   │[ foto ]  [QR Venda] [Logo Eco]             EC005             │
//   │                                                              │
//   │          Corredor:                                           │
//   │          Estante:                          Quant: 01         │
//   │          Nível:                                              │
//   │          Local:                            Data Envio: ..    │
//   │                                                              │
//   │ #2000016102974372                                            │
//   └──────────────────────────────────────────────────────────────┘
//       (borda laranja ~#F37C20, 0.8mm)
//
// Agrupamento: quando uma venda (SaleData) tem múltiplos items
// diferentes (groupedItems com mais de 1 item), EACH item gera UM
// card separado — impressos em sequência no mesmo lote.
// ═══════════════════════════════════════════════════════════════════

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

// Cor da borda laranja — referência visual pa1 (modelo pronto).
const ORANGE_R = 243;
const ORANGE_G = 124;
const ORANGE_B = 32;

// Largura das 4 colunas do card (esquerda → direita).
const COL_LEFT_W = 38;   // Logo ML + foto + # venda
const COL_INFO_W = 82;   // SKU / produto / comprador / QR venda
const COL_LOC_W = 38;    // Corredor/Estante/Nível/Local + Logo Eco
const COL_RIGHT_W = CARD_W - COL_LEFT_W - COL_INFO_W - COL_LOC_W; // QR objeto + SKU + quant + data

const ECOFERRO_LOGO_URL = "/ecoferro-logo.png";
const ML_LOGO_URL = "/ml-logo.png";
let ecoferroLogoDataUrlPromise: Promise<string | null> | null = null;
let mlLogoDataUrlPromise: Promise<string | null> | null = null;

// Hosts ML que o backend /api/ml/image-proxy aceita (ver api/ml/image-proxy.js).
// Sem proxy, fetch direto no browser falha por CORS restrito no CDN do ML.
const ML_IMAGE_HOSTS = ["mlstatic.com", "mercadolibre.com", "mercadolivre.com.br"];

function needsImageProxy(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ML_IMAGE_HOSTS.some(
      (h) => hostname === h || hostname.endsWith("." + h)
    );
  } catch {
    return false;
  }
}

async function loadImageAsDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;

  const fetchUrl = needsImageProxy(url)
    ? `/api/ml/image-proxy?url=${encodeURIComponent(url)}`
    : url;

  try {
    const response = await fetch(fetchUrl, {
      mode: needsImageProxy(url) ? "same-origin" : "cors",
      credentials: needsImageProxy(url) ? "include" : "omit",
    });
    if (!response.ok) return null;
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

async function loadEcoferroLogoDataUrl(): Promise<string | null> {
  if (!ecoferroLogoDataUrlPromise) {
    ecoferroLogoDataUrlPromise = loadImageAsDataUrl(ECOFERRO_LOGO_URL);
  }
  return ecoferroLogoDataUrlPromise;
}

async function loadMlLogoDataUrl(): Promise<string | null> {
  if (!mlLogoDataUrlPromise) {
    mlLogoDataUrlPromise = loadImageAsDataUrl(ML_LOGO_URL);
  }
  return mlLogoDataUrlPromise;
}

function getImageFormat(dataUrl: string): "PNG" | "JPEG" | "WEBP" {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

async function generateQRCodeDataUrl(value: string): Promise<string | null> {
  if (!value) return null;

  try {
    return await QRCode.toDataURL(value, {
      width: 180,
      margin: 1,
      color: { dark: "#111827", light: "#FFFFFF" },
    });
  } catch {
    return null;
  }
}

function drawPlaceholder(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.setFillColor(235, 235, 240);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, "F");
  doc.setFontSize(5.5);
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

// Desenha um fallback do logo ML quando o PNG oficial nao esta em
// public/ml-logo.png. Reproduz o visual do logo: retangulo amarelo
// arredondado com 2 circulos brancos sobrepostos (aperto de mao) a
// esquerda e texto "mercado livre" em 2 linhas a direita.
function drawMlLogoFallback(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.setFillColor(255, 230, 0); // amarelo ML #FFE600
  doc.roundedRect(x, y, w, h, 1.2, 1.2, "F");

  // "Aperto de mao" — 2 circulos brancos sobrepostos a esquerda
  const iconCx = x + h * 0.55;
  const iconCy = y + h / 2;
  const iconR = h * 0.22;
  doc.setFillColor(255, 255, 255);
  doc.circle(iconCx - iconR * 0.55, iconCy, iconR, "F");
  doc.circle(iconCx + iconR * 0.55, iconCy, iconR, "F");

  // Texto "mercado livre" em 2 linhas a direita do icone
  const textX = x + h * 1.1;
  const maxTextW = w - (textX - x) - 1;
  const fontSize = Math.max(4, Math.min(5.6, maxTextW / 5.5));
  doc.setFont("helvetica", "bold");
  doc.setFontSize(fontSize);
  doc.setTextColor(0, 0, 0);
  doc.text("mercado", textX, y + h / 2 - 0.4);
  doc.text("livre", textX, y + h / 2 + fontSize * 0.42);
}

async function drawSaleCard(
  doc: jsPDF,
  sale: SaleData,
  item: SaleItemData,
  x0: number,
  y0: number
) {
  // ── Borda laranja grossa ──────────────────────────────────────────
  doc.setDrawColor(ORANGE_R, ORANGE_G, ORANGE_B);
  doc.setLineWidth(0.8);
  doc.roundedRect(x0, y0, CARD_W, CARD_H, 2, 2, "S");

  // Guias de coluna (não desenhadas — apenas cálculo).
  const colLeftX = x0;
  const colInfoX = x0 + COL_LEFT_W;
  const colLocX = colInfoX + COL_INFO_W;
  const colRightX = colLocX + COL_LOC_W;

  const pad = 3;

  // ── COLUNA 1 (LEFT): Logo ML + foto + # venda ─────────────────────
  const mlLogoW = COL_LEFT_W - pad * 2;
  const mlLogoH = 10;
  const mlLogoX = colLeftX + pad;
  const mlLogoY = y0 + pad;
  const mlLogoData = await loadMlLogoDataUrl();
  if (mlLogoData) {
    try {
      drawContainedImage(doc, mlLogoData, mlLogoX, mlLogoY, mlLogoW, mlLogoH);
    } catch {
      drawMlLogoFallback(doc, mlLogoX, mlLogoY, mlLogoW, mlLogoH);
    }
  } else {
    drawMlLogoFallback(doc, mlLogoX, mlLogoY, mlLogoW, mlLogoH);
  }

  const imageX = colLeftX + pad;
  const imageW = COL_LEFT_W - pad * 2;
  const imageY = mlLogoY + mlLogoH + 1.5;
  const imageH = CARD_H - (imageY - y0) - pad - 5; // deixa espaço pro #venda no rodapé
  const imageSource =
    item.productImageData ||
    item.productImageUrl ||
    sale.productImageData ||
    sale.productImageUrl;
  const imgData = imageSource ? await loadImageAsDataUrl(imageSource) : null;
  if (imgData) {
    try {
      drawContainedImage(doc, imgData, imageX, imageY, imageW, imageH);
    } catch {
      drawPlaceholder(doc, imageX, imageY, imageW, imageH);
    }
  } else {
    drawPlaceholder(doc, imageX, imageY, imageW, imageH);
  }

  // #Número da venda — rodapé da coluna esquerda
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(17, 24, 39);
  doc.text(`#${sale.saleNumber || "-"}`, colLeftX + pad, y0 + CARD_H - pad, {
    maxWidth: COL_LEFT_W - pad * 2,
  });

  // ── COLUNA 2 (INFO): SKU / Produto / Comprador / QR venda ─────────
  const infoLeftPad = 2;
  const infoTextX = colInfoX + infoLeftPad;
  const infoMaxW = COL_INFO_W - infoLeftPad * 2;
  let textY = y0 + pad + 2.5;

  // SKU em destaque
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(17, 24, 39);
  doc.text(`SKU: ${item.sku || "-"}`, infoTextX, textY);
  textY += 4.8;

  // Nome do produto (até 2 linhas)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const productLines = doc.splitTextToSize(
    item.itemTitle || sale.productName || "-",
    infoMaxW
  );
  doc.text(productLines.slice(0, 2), infoTextX, textY);
  textY += Math.min(productLines.length, 2) * 3.8 + 0.6;

  // Nome do comprador
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(17, 24, 39);
  doc.text(sale.customerName || "-", infoTextX, textY, { maxWidth: infoMaxW });
  textY += 4;

  // Nickname
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(17, 24, 39);
  doc.text(sale.customerNickname || "-", infoTextX, textY, { maxWidth: infoMaxW });

  // QR Venda + Logo Eco no rodapé da coluna info
  const saleQrSize = 16;
  const saleQrX = infoTextX;
  const saleQrY = y0 + CARD_H - saleQrSize - pad - 1;

  const saleQrData = await generateQRCodeDataUrl(sale.saleQrcodeValue || "");
  if (saleQrData) {
    try {
      doc.addImage(saleQrData, "PNG", saleQrX, saleQrY, saleQrSize, saleQrSize);
    } catch {
      drawPlaceholder(doc, saleQrX, saleQrY, saleQrSize, saleQrSize);
    }
  } else {
    drawPlaceholder(doc, saleQrX, saleQrY, saleQrSize, saleQrSize);
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setTextColor(120, 120, 130);
  doc.text("QR Venda", saleQrX + saleQrSize / 2, saleQrY - 0.8, { align: "center" });

  // Logo EcoFerro ao lado do QR Venda
  const ecoLogoData = await loadEcoferroLogoDataUrl();
  if (ecoLogoData) {
    try {
      drawContainedImage(
        doc,
        ecoLogoData,
        saleQrX + saleQrSize + 3,
        saleQrY + 1,
        16,
        saleQrSize - 2
      );
    } catch {
      // silent
    }
  }

  // ── COLUNA 3 (LOC): Corredor / Estante / Nível / Local ────────────
  // Campos sempre VAZIOS — serão preenchidos no futuro via /stock.
  const locTextX = colLocX + 2;
  const locFontSize = 8;
  const locLineH = 5;
  let locY = y0 + pad + 4;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(locFontSize);
  doc.setTextColor(17, 24, 39);
  doc.text("Corredor:", locTextX, locY);
  locY += locLineH;
  doc.text("Estante:", locTextX, locY);
  locY += locLineH;
  doc.text("Nível:", locTextX, locY);
  locY += locLineH;
  doc.text("Local:", locTextX, locY);

  // ── COLUNA 4 (RIGHT): QR Objeto + SKU + Quant + Data Envio ────────
  const rightPad = 2;
  const rightInnerW = COL_RIGHT_W - rightPad * 2;
  const rightCenterX = colRightX + COL_RIGHT_W / 2;

  // Label "QR Objeto" no topo
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.5);
  doc.setTextColor(120, 120, 130);
  doc.text("QR Objeto", rightCenterX, y0 + pad + 2, { align: "center" });

  // QR Objeto (= qrcodeValue — geralmente SKU)
  const objectQrSize = Math.min(rightInnerW - 4, 18);
  const objectQrX = rightCenterX - objectQrSize / 2;
  const objectQrY = y0 + pad + 3.2;
  const objectQrData = await generateQRCodeDataUrl(sale.qrcodeValue || item.sku || "");
  if (objectQrData) {
    try {
      doc.addImage(objectQrData, "PNG", objectQrX, objectQrY, objectQrSize, objectQrSize);
    } catch {
      drawPlaceholder(doc, objectQrX, objectQrY, objectQrSize, objectQrSize);
    }
  } else {
    drawPlaceholder(doc, objectQrX, objectQrY, objectQrSize, objectQrSize);
  }

  // SKU em destaque à direita
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(17, 24, 39);
  doc.text(item.sku || "-", rightCenterX, objectQrY + objectQrSize + 3.5, { align: "center" });

  // Quant
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(17, 24, 39);
  doc.text(`Quant: ${String(item.quantity ?? 1).padStart(2, "0")}`, rightCenterX, objectQrY + objectQrSize + 8.5, {
    align: "center",
  });

  // Data Envio — no rodapé
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(17, 24, 39);
  const dataEnvioLabel = sale.expectedShippingDate
    ? `Data Envio: ${sale.expectedShippingDate}`
    : "Data Envio:";
  doc.text(dataEnvioLabel, rightCenterX, y0 + CARD_H - pad - 1, { align: "center" });
}

// Expande uma SaleData em N "renderable units" — um por item agrupado.
// Quando a venda tem 1 item, retorna 1 unit com esse item.
// Quando tem múltiplos items, retorna 1 unit por item (todas compartilhando
// dados da venda/comprador, diferindo só no produto/SKU/foto).
function expandSaleToRenderableUnits(sale: SaleData): Array<{ sale: SaleData; item: SaleItemData }> {
  const groupedItems = sale.groupedItems || [];
  if (groupedItems.length <= 1) {
    const singleItem: SaleItemData = groupedItems[0] || {
      itemTitle: sale.productName,
      sku: sale.sku,
      quantity: sale.quantity,
      amount: sale.amount,
      productImageUrl: sale.productImageData || sale.productImageUrl,
      productImageData: sale.productImageData,
      variation: sale.variation,
      locationCorridor: sale.locationCorridor,
      locationShelf: sale.locationShelf,
      locationLevel: sale.locationLevel,
    };
    return [{ sale, item: singleItem }];
  }
  return groupedItems.map((item) => ({ sale, item }));
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
  const units = expandSaleToRenderableUnits(sale);

  for (let index = 0; index < units.length; index += 1) {
    const pageIndex = Math.floor(index / CARDS_PER_PAGE);
    const posInPage = index % CARDS_PER_PAGE;
    if (pageIndex > 0 && posInPage === 0) {
      doc.addPage();
    }
    const offsetY = MARGIN_Y + posInPage * (CARD_H + GAP);
    await drawSaleCard(doc, units[index].sale, units[index].item, MARGIN_X, offsetY);
  }

  doc.save(getFileName(sale));
}

export async function exportBatchPdf(sales: SaleData[]): Promise<void> {
  const doc = createA4Doc();
  const units = sales.flatMap((sale) => expandSaleToRenderableUnits(sale));

  for (let index = 0; index < units.length; index += 1) {
    const pageIndex = Math.floor(index / CARDS_PER_PAGE);
    const posInPage = index % CARDS_PER_PAGE;
    if (pageIndex > 0 && posInPage === 0) {
      doc.addPage();
    }
    const offsetY = MARGIN_Y + posInPage * (CARD_H + GAP);
    await drawSaleCard(doc, units[index].sale, units[index].item, MARGIN_X, offsetY);
  }

  const today = new Date().toISOString().slice(0, 10);
  doc.save(`etiquetas-lote-${today}.pdf`);
}
