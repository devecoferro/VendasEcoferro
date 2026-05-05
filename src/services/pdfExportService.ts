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
//   │ #2000016102974372  2026-05-05 10:42         EC005            │
//   │[ QR    ]  [Logo Eco]  Corredor:                              │
//   │[ Venda ]             Estante:              Quant: 01         │
//   │                      Nível:                                  │
//   │ QR Venda  Local:...                       Data Envio: ..    │
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

// Grid de linhas horizontais — padroniza alinhamento conforme
// modelo "modelo_etiqueta_ecoferro_interna.png".
// CARD_H ≈ 53mm.
//
//   Y_ROW_1 → SKU
//   Y_ROW_2 → Titulo do produto
//   Y_ROW_3 → Comprador (nome real)
//   Y_ROW_4 → Nickname
//   Y_ROW_5 → Corredor (alinha com topo do QR Venda+LogoEco)
//   Y_ROW_6 → Estante / SKU lateral direito (C4)
//   Y_ROW_7 → Nivel / Quant: 01
//   FOOTER  → Local / Data Envio / #saleNumber (CARD_H - 3)
const Y_ROW_1 = 6.5;
const Y_ROW_2 = 12.5;
const Y_ROW_3 = 18.5;
const Y_ROW_4 = 24;
const Y_ROW_5 = 31;
const Y_ROW_6 = 37.5;
const Y_ROW_7 = 44;
const Y_FOOTER = CARD_H - 3;  // ~50

const ECOFERRO_LOGO_URL = "/ecoferro-logo.png";
const FANTOM_LOGO_URL = "/fantom-logo.png";
const ML_LOGO_URL = "/ml-logo.png";

// Brief 2026-04-29: brand-aware label. Default "ecoferro" mantem
// comportamento legado (ReviewPage, etc). MercadoLivreFantomPage
// passa "fantom" pra trocar SO o logo no canto da etiqueta.
export type LabelBrand = "ecoferro" | "fantom";

let ecoferroLogoDataUrlPromise: Promise<string | null> | null = null;
let fantomLogoDataUrlPromise: Promise<string | null> | null = null;
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

async function loadFantomLogoDataUrl(): Promise<string | null> {
  if (!fantomLogoDataUrlPromise) {
    fantomLogoDataUrlPromise = loadImageAsDataUrl(FANTOM_LOGO_URL);
  }
  return fantomLogoDataUrlPromise;
}

async function loadBrandLogoDataUrl(brand: LabelBrand): Promise<string | null> {
  return brand === "fantom"
    ? loadFantomLogoDataUrl()
    : loadEcoferroLogoDataUrl();
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
  y0: number,
  brand: LabelBrand = "ecoferro"
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

  // ── Borda laranja arredondada (2026-04-30 v4 — alinha com modelo
  // "modelo_etiqueta_ecoferro_interna.png") ────────────────────────
  doc.setDrawColor(ORANGE_R, ORANGE_G, ORANGE_B);
  doc.setLineWidth(0.7);
  doc.roundedRect(x0, y0, CARD_W, CARD_H, 2.5, 2.5, "S");

  // Posicionamento X em mm — medido pixel-a-pixel sobre
  // modelo_etiqueta_ecoferro_interna.png (1183x319 → 194x53mm).
  // QR Venda + Logo Eco ocupam o miolo (x≈56–96mm); Corredor/
  // Estante/Nivel logo a direita (x≈99mm); QR Objeto no canto
  // direito (x≈156mm) com SKU/Quant centralizados embaixo.
  const infoX = x0 + 45;            // C2: SKU/titulo/comprador/nickname
  const saleQrX = x0 + 56;          // QR Venda no miolo
  const ecoLogoX = x0 + 75;         // Logo Eco a direita do QR Venda
  const stockX = x0 + 99;           // Corredor/Estante/Nivel ao lado do Logo Eco
  const objectQrX = x0 + 156;       // QR Objeto no canto direito

  // ── Logo Mercado Livre ───────────────────────────────────────────
  const mlLogoData = await loadMlLogoDataUrl();
  const mlLogoX = x0 + 12;
  const mlLogoY = y0 + 3;
  const mlLogoW = 27;
  const mlLogoH = 8;

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
  const imageX = x0 + 8;
  const imageY = y0 + 13;
  const imageW = 31;
  const imageH = 32;

  if (imgData) {
    try {
      drawContainedImage(doc, imgData, imageX, imageY, imageW, imageH);
    } catch {
      drawPlaceholder(doc, imageX, imageY, imageW, imageH);
    }
  } else {
    drawPlaceholder(doc, imageX, imageY, imageW, imageH);
  }

  // Número da venda + data no rodapé esquerdo (ex: #2000016280141300  2026-05-05 10:42)
  const saleNumberDateStr = sale.saleDate && sale.saleTime
    ? `#${sale.saleNumber || "-"} ${sale.saleDate} ${sale.saleTime}`
    : `#${sale.saleNumber || "-"}`;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);
  doc.text(saleNumberDateStr, x0 + 6, y0 + Y_FOOTER);

  // ── Dados principais ─────────────────────────────────────────────
  doc.setTextColor(0, 0, 0);

  // Linha 1: SKU (negrito grande, igual ao modelo)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`SKU: ${item.sku || "-"}`, infoX, y0 + Y_ROW_1);

  // Linha 2: Titulo (1 linha apenas, alinhado com Y_ROW_2).
  // maxWidth limita ao espaco entre infoX (45) e o inicio da
  // coluna de localizacao/QR Venda (~95mm).
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const titleMaxW = 65;
  const productLines = doc.splitTextToSize(
    item.itemTitle || sale.productName || "-",
    titleMaxW
  );
  doc.text(productLines.slice(0, 1), infoX, y0 + Y_ROW_2);

  // Briefing 2026-04-29: comprador SEMPRE mostra ambas as linhas (nome
  // + nickname). Sem heuristica de "ID interno ML" — operador prefere
  // ver o que ML mandou (mesmo TS-ID) a perder a informacao. Quando o
  // campo nao vem, usa fallback explicito.
  const customerNameRaw = (sale.customerName || "").trim();
  const customerNickRaw = (sale.customerNickname || "").trim();
  const customerNameLine = customerNameRaw || "Cliente não informado";
  const customerNickLine = customerNickRaw || "Nickname não informado";

  // Linha 3: Nome do comprador
  doc.setFontSize(8);
  doc.text(customerNameLine, infoX, y0 + Y_ROW_3, { maxWidth: titleMaxW });

  // Linha 4: Nickname
  doc.setFontSize(7.5);
  doc.text(customerNickLine, infoX, y0 + Y_ROW_4, { maxWidth: titleMaxW });

  // ── QR Venda — alinhado com bloco Y_ROW_5..Y_ROW_7 (meio do card) ─
  // Tamanho 16x16mm conforme modelo (mais compacto que antes).
  const saleQrSize = 16;
  const saleQrY = y0 + 29;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.6);
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

  // ── Logo da marca (Ecoferro ou Fantom) — alinhado com QR Venda ──
  // Box de 21x18mm; drawContainedImage preserva proporcao original.
  const brandLogoData = await loadBrandLogoDataUrl(brand);
  if (brandLogoData) {
    try {
      drawContainedImage(doc, brandLogoData, ecoLogoX, y0 + 28, 21, 18);
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

  // Local no rodapé central — alinhado horizontalmente com QR Venda
  // (igual modelo: "Local:" comeca abaixo do QR Venda, x≈56mm).
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text(`Local: ${localDeposito}`, saleQrX, y0 + Y_FOOTER);

  // ── Campos de estoque ────────────────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);

  // Linhas 5-7: Corredor / Estante / Nível (alinhados com QR Venda+Logo Ec).
  // maxWidth=52mm garante que valores longos cabem ate o QR Objeto
  // (que comeca em x0+156mm; stockX=99 → 156-99=57mm de espaco).
  const STOCK_MAX_W = 52;
  doc.text(`Corredor: ${corridor}`, stockX, y0 + Y_ROW_5, { maxWidth: STOCK_MAX_W });
  doc.text(`Estante: ${shelf}`, stockX, y0 + Y_ROW_6, { maxWidth: STOCK_MAX_W });
  doc.text(`Nível: ${level}`, stockX, y0 + Y_ROW_7, { maxWidth: STOCK_MAX_W });

  // ── QR Objeto no topo direito ────────────────────────────────────
  // 17x17mm conforme modelo (era 20mm — esticava demais).
  const objectQrSize = 17;
  const objectQrY = y0 + 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(5.6);
  doc.setTextColor(145, 145, 145);
  doc.text("QR Objeto", objectQrX + objectQrSize / 2, y0 + 5, { align: "center" });

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

  // SKU / Quantidade / Data Envio à direita do QR Objeto
  const rightCenterX = objectQrX + objectQrSize / 2;

  // SKU lateral — entre QR Objeto e Quant (modelo: y≈33mm)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text(item.sku || "-", rightCenterX, y0 + Y_ROW_6, { align: "center" });

  // Quant — alinhado com Y_ROW_7 (mesma altura de Nivel)
  doc.setFontSize(8);
  doc.text(
    `Quant: ${String(item.quantity ?? 1).padStart(2, "0")}`,
    rightCenterX,
    y0 + Y_ROW_7,
    { align: "center" }
  );

  // Data Envio — rodape direito. Usa expectedShippingDate se disponível,
  // senão usa saleDate + saleTime como fallback (ex: 2026-05-05 10:42).
  const dataEnvioValue = sale.expectedShippingDate
    ? sale.expectedShippingDate
    : (sale.saleDate && sale.saleTime)
      ? `${sale.saleDate} ${sale.saleTime}`
      : sale.saleDate || "";
  const dataEnvioLabel = dataEnvioValue
    ? `Data Envio: ${dataEnvioValue}`
    : "Data Envio";

  doc.setFontSize(8);
  doc.text(dataEnvioLabel, objectQrX, y0 + Y_FOOTER);
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

export async function exportSalePdf(
  sale: SaleData,
  brand: LabelBrand = "ecoferro"
): Promise<void> {
  const doc = createA4Doc();
  const units = expandSaleToRenderableUnits(sale);

  for (let index = 0; index < units.length; index += 1) {
    const pageIndex = Math.floor(index / CARDS_PER_PAGE);
    const posInPage = index % CARDS_PER_PAGE;
    if (pageIndex > 0 && posInPage === 0) {
      doc.addPage();
    }
    const offsetY = MARGIN_Y + posInPage * (CARD_H + GAP);
    await drawSaleCard(doc, units[index].sale, units[index].item, MARGIN_X, offsetY, brand);
  }

  doc.save(getFileName(sale));
}

export async function exportBatchPdf(
  sales: SaleData[],
  brand: LabelBrand = "ecoferro"
): Promise<void> {
  const doc = createA4Doc();
  const units = sales.flatMap((sale) => expandSaleToRenderableUnits(sale));

  for (let index = 0; index < units.length; index += 1) {
    const pageIndex = Math.floor(index / CARDS_PER_PAGE);
    const posInPage = index % CARDS_PER_PAGE;
    if (pageIndex > 0 && posInPage === 0) {
      doc.addPage();
    }
    const offsetY = MARGIN_Y + posInPage * (CARD_H + GAP);
    await drawSaleCard(doc, units[index].sale, units[index].item, MARGIN_X, offsetY, brand);
  }

  const today = new Date().toISOString().slice(0, 10);
  doc.save(`etiquetas-lote-${today}.pdf`);
}
