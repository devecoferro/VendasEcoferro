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

// Grid invisivel de 8 linhas horizontais — padroniza alinhamento dos
// textos conforme imagem-referencia do operador (linhas verdes na
// foto eram so guia, nao aparecem no PDF). CARD_H ≈ 53mm.
//
//   Y_ROW_1 → SKU / topo do QR Objeto / topo do logo ML
//   Y_ROW_2 → Titulo do produto (linha 1 de 2)
//   Y_ROW_3 → Comprador (nome real, ou vazio se = nickname)
//   Y_ROW_4 → Nickname
//   Y_ROW_5 → Corredor (alinha com inicio do QR Venda+LogoEc)
//   Y_ROW_6 → Estante / EC005 (SKU lateral direito)
//   Y_ROW_7 → Nivel / Quant: 01
//   Y_ROW_8 → Local / Data Envio (rodape — usa CARD_H - 3.2)
const ROW_TOP = 5.8;
const ROW_GAP = 6.0;
const Y_ROW_1 = ROW_TOP;                  // 5.8
const Y_ROW_2 = ROW_TOP + ROW_GAP;        // 11.8
const Y_ROW_3 = ROW_TOP + ROW_GAP * 2;    // 17.8
const Y_ROW_4 = ROW_TOP + ROW_GAP * 3;    // 23.8
const Y_ROW_5 = ROW_TOP + ROW_GAP * 4;    // 29.8
const Y_ROW_6 = ROW_TOP + ROW_GAP * 5;    // 35.8
const Y_ROW_7 = ROW_TOP + ROW_GAP * 6;    // 41.8

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
  /**
   * Layout ajustado para ficar visualmente igual ao modelo enviado:
   * - etiqueta horizontal limpa;
   * - borda laranja fina e reta;
   * - logo ML no topo esquerdo;
   * - produto grande na esquerda;
   * - dados principais no topo central;
   * - QR Venda + logo Ecoferro no miolo;
   * - localização no centro/direita;
   * - QR Objeto no topo direito;
   * - SKU / Quantidade / Data Envio alinhados à direita.
   */

  const pad = 3;

  // ── Borda laranja quadrada ───────────────────────────────────────
  doc.setDrawColor(ORANGE_R, ORANGE_G, ORANGE_B);
  doc.setLineWidth(0.45);
  doc.rect(x0, y0, CARD_W, CARD_H, "S");

  // Áreas base em mm dentro do card
  const leftX = x0 + 4;
  const infoX = x0 + 45;
  const saleQrX = x0 + 90;
  const ecoLogoX = x0 + 116;
  const stockX = x0 + 139;
  const rightX = x0 + CARD_W - 31;

  // ── Logo Mercado Livre ───────────────────────────────────────────
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

  // ── Imagem do produto ────────────────────────────────────────────
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

  // Número da venda no rodapé esquerdo
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.2);
  doc.setTextColor(0, 0, 0);
  doc.text(`#${sale.saleNumber || "-"}`, x0 + 3.5, y0 + CARD_H - 3.2);

  // ── Dados principais ─────────────────────────────────────────────
  doc.setTextColor(0, 0, 0);

  // Linha 1: SKU
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.8);
  doc.text(`SKU: ${item.sku || "-"}`, infoX, y0 + Y_ROW_1);

  // Linha 2: Titulo (1 linha apenas, alinhado com Y_ROW_2)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.3);
  const productLines = doc.splitTextToSize(
    item.itemTitle || sale.productName || "-",
    70
  );
  doc.text(productLines.slice(0, 1), infoX, y0 + Y_ROW_2);

  // Saneamento do customerName em casos de privacidade do comprador:
  //
  // ID interno ML aparece quando ML retorna codigo de privacidade
  // (ex: "TS20241225130437", "GORO20240118090752"). Caracteristica:
  // tem MISTURA de letras + digitos (geralmente prefixo curto + timestamp).
  //
  // Nomes reais de pessoa (mesmo em UPPERCASE sem acento, ex:
  // "DARLYVANGAMACABRAL", "JOSADAILTONFERNANDES") NAO devem ser
  // confundidos com IDs — esses tem so letras, sem digitos.
  //
  // Antes a regex /^[A-Z0-9]{8,}\$/ marcava qualquer string uppercase
  // sem espaco como ID, escondendo nomes reais da etiqueta.
  const customerName = sale.customerName || "";
  const customerNickname = sale.customerNickname || "";
  // ID interno do ML: requer tanto letras QUANTO digitos no nome.
  // Ex: TS20241225130437, GORO20240118090752, RG20241016084812.
  // Nomes reais (DARLYVANGAMACABRAL) so tem letras → NAO sao flagados.
  const looksLikeMlInternalId =
    /^TS\d{10,}$/i.test(customerName) ||
    (customerName.length >= 8 &&
      !customerName.includes(" ") &&
      /[A-Z]/.test(customerName) &&
      /\d{4,}/.test(customerName));
  // Esconde apenas IDs internos. Nomes duplicados com nickname agora
  // tambem sao mostrados — melhor mostrar o nome (mesmo igual ao nick)
  // do que deixar o operador sem informacao do comprador.
  const hideCustomerName = looksLikeMlInternalId;

  // Linha 3: Comprador (nome real). Vazia se duplicar nickname OU se
  // for ID interno do ML (TS+digits, etc.).
  doc.setFontSize(7.2);
  doc.text(
    hideCustomerName ? "" : customerName || "-",
    infoX,
    y0 + Y_ROW_3,
    { maxWidth: 72 }
  );

  // Linha 4: Nickname. Se customerName parece ID, fallback so pro
  // nickname (sem repetir o lixo).
  doc.setFontSize(7.1);
  doc.text(
    customerNickname || (hideCustomerName ? "-" : customerName || "-"),
    infoX,
    y0 + Y_ROW_4,
    { maxWidth: 72 }
  );

  // ── QR Venda — alinhado com bloco Y_ROW_5..Y_ROW_7 ───────────────
  const saleQrSize = 19;
  const saleQrY = y0 + Y_ROW_5 + 0.5;

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

  // ── Logo Ecoferro — alinhado com QR Venda (Y_ROW_5..Y_ROW_7) ────
  const ecoLogoData = await loadEcoferroLogoDataUrl();
  if (ecoLogoData) {
    try {
      drawContainedImage(doc, ecoLogoData, ecoLogoX, y0 + Y_ROW_5 - 0.3, 21, 17);
    } catch {
      // mantém silencioso para não quebrar geração do PDF
    }
  }

  // Corredor / Estante / Nivel: vem APENAS do cadastro em /stock
  // (ml_stock_location), via fetchStockLocationsBySku → applyLocationsToSale.
  // SKU sem cadastro → campos ficam vazios (label sem valor, igual ao modelo).
  const corridor = item.locationCorridor || sale.locationCorridor || "";
  const shelf = item.locationShelf || sale.locationShelf || "";
  const level = item.locationLevel || sale.locationLevel || "";

  // Local: nome do deposito do pedido (ex: "Ourinhos Rua Dario Alonso",
  // "FULL", "Sem deposito"). Vem de sale.depositLabel, populado em
  // mapMLOrderToSaleData a partir do deposit_snapshot do raw_data.
  // Se nao houver deposito identificado, fica em branco.
  const localDeposito = sale.depositLabel || "";

  // Local no rodapé central
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.3);
  doc.setTextColor(0, 0, 0);
  doc.text(`Local: ${localDeposito}`, ecoLogoX - 5, y0 + CARD_H - 3.2);

  // ── Campos de estoque ────────────────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.4);
  doc.setTextColor(0, 0, 0);

  // Linhas 5-7: Corredor / Estante / Nível (alinhados com QR Venda+Logo Ec)
  doc.text(`Corredor: ${corridor}`, stockX, y0 + Y_ROW_5);
  doc.text(`Estante: ${shelf}`, stockX, y0 + Y_ROW_6);
  doc.text(`Nível: ${level}`, stockX, y0 + Y_ROW_7);

  // ── QR Objeto no topo direito ────────────────────────────────────
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

  // SKU / Quantidade / Data Envio à direita
  const rightCenterX = objectQrX + objectQrSize / 2;

  // Coluna direita alinhada com Estante (Y_ROW_6) e Nível (Y_ROW_7)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.setTextColor(0, 0, 0);
  doc.text(item.sku || "-", rightCenterX, y0 + Y_ROW_6, { align: "center" });

  doc.setFontSize(7.2);
  doc.text(
    `Quant: ${String(item.quantity ?? 1).padStart(2, "0")}`,
    rightCenterX,
    y0 + Y_ROW_7,
    { align: "center" }
  );

  const dataEnvioLabel = sale.expectedShippingDate
    ? `Data Envio ${sale.expectedShippingDate}`
    : "Data Envio";

  doc.setFontSize(7.2);
  doc.text(dataEnvioLabel, rightCenterX, y0 + CARD_H - 3.2, { align: "center" });
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
