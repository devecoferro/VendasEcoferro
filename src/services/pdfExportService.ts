import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { type SaleData, type SaleItemData } from "@/types/sales";

// ┌─────────────────────────────────────────────────────────────────┐
// │   Etiqueta interna Ecoferro — versão ajustada para aderir ao   │
// │   layout fornecido pelo usuário. Esta implementação mantém     │
// │   a mesma lógica do arquivo original (com múltiplos cards por   │
// │   página), porém ajusta a posição vertical de alguns elementos  │
// │   (localização e campo "Local:") e alinha o logo Ecoferro e os  │
// │   campos de estoque ao mesmo nível do QR code de venda.         │
// └─────────────────────────────────────────────────────────────────┘

/*
 * O desenho de cada card segue a mesma estrutura do arquivo base
 * (`856f5be4-fd68-44a6-92d7-a440db244589.ts`) com os seguintes
 * refinamentos para se aproximar do modelo de referência:   
 *   1. O logotipo Ecoferro passa a ser desenhado com o mesmo topo
 *      vertical do QR de venda, garantindo alinhamento com os campos
 *      de localização.
 *   2. Os campos "Corredor", "Estante" e "Nível" são reposicionados
 *      mais para cima, iniciando logo abaixo do topo do QR de venda.
 *      Isso garante que fiquem lado a lado com o logotipo Ecoferro e
 *      centralizados verticalmente em relação a ele, conforme a
 *      etiqueta de exemplo.
 *   3. O campo "Local:" (localização do depósito) deixa o rodapé do
 *      card e é movido para a altura do miolo do card, abaixo do
 *      grupo QR de venda / Ecoferro. Assim ele aparece antes de
 *      "Data Envio" e do número do pedido, como na referência.
 */

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

// Cor da borda laranja (modelo oficial)
const ORANGE_R = 243;
const ORANGE_G = 124;
const ORANGE_B = 32;

const ECOFERRO_LOGO_URL = "/ecoferro-logo.png";
const ML_LOGO_URL = "/ml-logo.png";
let ecoferroLogoDataUrlPromise: Promise<string | null> | null = null;
let mlLogoDataUrlPromise: Promise<string | null> | null = null;

const ML_IMAGE_HOSTS = ["mlstatic.com", "mercadolibre.com", "mercadolivre.com.br"];

function needsImageProxy(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return ML_IMAGE_HOSTS.some((h) => hostname === h || hostname.endsWith("." + h));
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

function drawMlLogoFallback(doc: jsPDF, x: number, y: number, w: number, h: number) {
  doc.setFillColor(255, 230, 0);
  doc.roundedRect(x, y, w, h, 1.2, 1.2, "F");
  const iconCx = x + h * 0.55;
  const iconCy = y + h / 2;
  const iconR = h * 0.22;
  doc.setFillColor(255, 255, 255);
  doc.circle(iconCx - iconR * 0.55, iconCy, iconR, "F");
  doc.circle(iconCx + iconR * 0.55, iconCy, iconR, "F");
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
  // Borda externa do card
  doc.setDrawColor(ORANGE_R, ORANGE_G, ORANGE_B);
  doc.setLineWidth(0.45);
  doc.rect(x0, y0, CARD_W, CARD_H, "S");
  // Definições de colunas fixas (valores herdados do layout original)
  const leftX = x0 + 4;
  const infoX = x0 + 45;
  const saleQrX = x0 + 90;
  const ecoLogoX = x0 + 116;
  const stockX = x0 + 139;
  const rightX = x0 + CARD_W - 31;
  // Logo Mercado Livre
  const mlLogoData = await loadMlLogoDataUrl();
  const mlLogoX = leftX + 3;
  const mlLogoY = y0 + 2.2;
  const mlLogoW = 24;
  const mlLogoH = 6.8;
  if (mlLogoData) {
    try {
      drawContainedImage(doc, mlLogoData, mlLogoX, mlLogoY, mlLogoW, mlLogoH);
    } catch {
      drawMlLogoFallback(doc, mlLogoX, mlLogoY, mlLogoW, mlLogoH);
    }
  } else {
    drawMlLogoFallback(doc, mlLogoX, mlLogoY, mlLogoW, mlLogoH);
  }
  // Imagem do produto
  const imageSource =
    item.productImageData ||
    item.productImageUrl ||
    sale.productImageData ||
    sale.productImageUrl;
  const imgData = imageSource ? await loadImageAsDataUrl(imageSource) : null;
  const imageX = x0 + 3;
  const imageY = y0 + 12;
  const imageW = 40;
  const imageH = 30;
  if (imgData) {
    try {
      drawContainedImage(doc, imgData, imageX, imageY, imageW, imageH);
    } catch {
      drawPlaceholder(doc, imageX, imageY, imageW, imageH);
    }
  } else {
    drawPlaceholder(doc, imageX, imageY, imageW, imageH);
  }
  // Número do pedido
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  doc.setTextColor(0, 0, 0);
  doc.text(`#${sale.saleNumber || "-"}`, x0 + 3.5, y0 + CARD_H - 3.2);
  // Dados principais: SKU, descrição, comprador
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.8);
  doc.text(`SKU: ${item.sku || "-"}`, infoX, y0 + 5.8);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.3);
  const productLines = doc.splitTextToSize(item.itemTitle || sale.productName || "-", 70);
  doc.text(productLines.slice(0, 2), infoX, y0 + 12.8);
  const customerName = sale.customerName || "";
  const customerNickname = sale.customerNickname || "";
  const nameDuplicatesNickname =
    customerName.length > 0 && customerName.toLowerCase() === customerNickname.toLowerCase();
  doc.setFontSize(7.2);
  doc.text(nameDuplicatesNickname ? "" : customerName || "-", infoX, y0 + 21.8, { maxWidth: 72 });
  doc.setFontSize(7.1);
  doc.text(customerNickname || customerName || "-", infoX, y0 + 28.6, { maxWidth: 72 });
  // QR de Venda
  const saleQrSize = 19;
  const saleQrY = y0 + 20.3;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.2);
  doc.setTextColor(145, 145, 145);
  doc.text("QR Venda", saleQrX + saleQrSize / 2, saleQrY - 1.2, { align: "center" });
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
  // Logo Ecoferro alinhado verticalmente com QR de venda
  const ecoLogoData = await loadEcoferroLogoDataUrl();
  const ecoLogoY = saleQrY;
  if (ecoLogoData) {
    try {
      drawContainedImage(doc, ecoLogoData, ecoLogoX, ecoLogoY, 21, 17);
    } catch {
      /* silencioso */
    }
  }
  // Campos de localização (Corredor/Estante/Nível)
  const corridor = item.locationCorridor || sale.locationCorridor || "";
  const shelf = item.locationShelf || sale.locationShelf || "";
  const level = item.locationLevel || sale.locationLevel || "";
  const locStartY = saleQrY + 2.0;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.4);
  doc.setTextColor(0, 0, 0);
  doc.text(`Corredor: ${corridor}`, stockX, locStartY);
  doc.text(`Estante: ${shelf}`, stockX, locStartY + 7.4);
  doc.text(`Nível: ${level}`, stockX, locStartY + 14.8);
  // Campo Local (nome do depósito) reposicionado
  const localDeposito = sale.depositLabel || "";
  const localX = saleQrX;
  const localY = y0 + CARD_H - 9.0;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.3);
  doc.setTextColor(0, 0, 0);
  doc.text(`Local: ${localDeposito}`, localX, localY);
  // QR de Objeto
  const objectQrSize = 20;
  const objectQrX = rightX + 4;
  const objectQrY = y0 + 6.2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.2);
  doc.setTextColor(145, 145, 145);
  doc.text("QR  Objeto", objectQrX + objectQrSize / 2, y0 + 4.2, { align: "center" });
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
  // Campos à direita: SKU/Quant/Data Envio
  const rightCenterX = objectQrX + objectQrSize / 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.setTextColor(0, 0, 0);
  doc.text(item.sku || "-", rightCenterX, y0 + 35.2, { align: "center" });
  doc.text(
    `Quant: ${String(item.quantity ?? 1).padStart(2, "0")}`,
    rightCenterX,
    y0 + 43.5,
    { align: "center" }
  );
  const dataEnvioLabel = sale.expectedShippingDate
    ? `Data Envio ${sale.expectedShippingDate}`
    : "Data Envio";
  doc.text(dataEnvioLabel, rightCenterX, y0 + CARD_H - 3.2, { align: "center" });
}

function expandSaleToRenderableUnits(
  sale: SaleData
): Array<{ sale: SaleData; item: SaleItemData }> {
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
      locationNotes: sale.locationNotes,
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