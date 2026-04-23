import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { type SaleData } from "@/types/sales";

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

const LEFT_W = 45;
const RIGHT_W = 34;
const CENTER_W = CARD_W - LEFT_W - RIGHT_W;
const ECOFERRO_LOGO_URL = "/ecoferro-logo.png";
let ecoferroLogoDataUrlPromise: Promise<string | null> | null = null;

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

  // Imagens ML: roteia pelo backend pra evitar CORS no CDN.
  // Outros domínios (ex. /ecoferro-logo.png local): fetch direto.
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

function drawObservationBox(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  width: number,
  maxHeight: number,
  compactRows: boolean
): number {
  const trimmed = text.trim();
  if (!trimmed || maxHeight < 4) return 0;

  const labelFontSize = compactRows ? 4.9 : 5.6;
  const textFontSize = compactRows ? 5.6 : 6.3;
  const labelHeight = compactRows ? 2.2 : 2.8;
  const lineHeight = compactRows ? 2.1 : 2.5;
  const innerPadX = 1.7;
  const innerPadY = compactRows ? 1.1 : 1.4;
  const maxLines = Math.max(
    1,
    Math.floor((maxHeight - innerPadY * 2 - labelHeight) / lineHeight)
  );

  let lines = doc.splitTextToSize(trimmed, Math.max(10, width - innerPadX * 2));
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const lastLine = String(lines[lines.length - 1] || "");
    lines[lines.length - 1] =
      lastLine.length > 2
        ? `${lastLine.slice(0, Math.max(0, lastLine.length - 2))}...`
        : `${lastLine}...`;
  }

  const boxHeight = Math.min(
    maxHeight,
    innerPadY * 2 + labelHeight + lines.length * lineHeight + 0.6
  );

  doc.setFillColor(255, 247, 230);
  doc.setDrawColor(244, 210, 141);
  doc.roundedRect(x, y, width, boxHeight, 1.2, 1.2, "FD");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(labelFontSize);
  doc.setTextColor(161, 98, 7);
  doc.text("OBSERVACAO", x + innerPadX, y + innerPadY + labelHeight - 0.4);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(textFontSize);
  doc.setTextColor(124, 74, 3);
  doc.text(lines, x + innerPadX, y + innerPadY + labelHeight + lineHeight);

  return boxHeight + 1.2;
}

async function drawSaleCard(doc: jsPDF, sale: SaleData, x0: number, y0: number) {
  doc.setDrawColor(160, 160, 170);
  doc.setLineWidth(0.35);
  doc.roundedRect(x0, y0, CARD_W, CARD_H, 2, 2, "S");

  const pad = 3;
  const innerH = CARD_H - pad * 2;
  const groupedItems = sale.groupedItems || [];
  const displayItems =
    groupedItems.length > 1
      ? groupedItems
      : [
          {
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
          },
        ];
  const rowGap = 1.2;
  const rowCount = Math.max(1, displayItems.length);
  const rowHeight = (innerH - rowGap * (rowCount - 1)) / rowCount;
  const compactRows = rowCount > 1;
  const veryCompactRows = rowCount > 2;
  const centerX = x0 + LEFT_W + 2.5;
  const maxTextW = CENTER_W - 6;
  const rightX = x0 + LEFT_W + CENTER_W + 3.5;
  const dividerX = rightX - 2.5;
  const rightContentW = RIGHT_W - 6;
  const logoData = await loadEcoferroLogoDataUrl();
  const labelObservation = sale.labelObservation?.trim() || "";

  doc.setDrawColor(215, 215, 225);
  doc.setLineWidth(0.15);
  doc.line(dividerX, y0 + pad, dividerX, y0 + CARD_H - pad);

  for (let index = 0; index < displayItems.length; index += 1) {
    const item = displayItems[index];
    const rowTop = y0 + pad + index * (rowHeight + rowGap);
    const rowBottom = rowTop + rowHeight;

    if (index > 0) {
      const separatorY = rowTop - rowGap / 2;
      doc.setDrawColor(226, 232, 240);
      doc.line(x0 + 2.5, separatorY, x0 + CARD_W - 2.5, separatorY);
    }

    const imageX = x0 + 2.5;
    const imageY = rowTop + 0.6;
    const imageW = LEFT_W - 6;
    const imageH = rowHeight - 1.2;
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

    // Deposito no rodape da coluna esquerda — visual 1:1 com mockups do
    // usuario (arquivos em imagens para alteracao/etiqueta*.png):
    //
    //   [ ML badge amarelo circular ] [ texto do deposito ]
    //
    // Variacoes:
    //   FULL                 → badge amarelo "ML" + texto cinza thin "⚡ FULL"
    //   Ourinhos/outros      → badge amarelo "ML" + texto preto bold UPPERCASE
    //   Sem deposito         → badge amarelo "ML" + texto preto bold "Vendas sem depósito"
    //
    // Desenhado ANTES do texto lateral pra que centerX/textY abaixo nao
    // sejam deslocados. A posicao Y e abaixo da imagem + QR venda, no
    // rodape da celula — usa rowBottom referencia.
    if (sale.depositLabel) {
      const depositText = sale.depositLabel;
      const isFull = depositText.toUpperCase() === "FULL";
      const isWithoutDeposit =
        depositText.toLowerCase().includes("sem depósito") ||
        depositText.toLowerCase().includes("sem deposito");

      // +30% de fonte vs baseline — pedido do usuario pra ficar visivel
      const badgeRadius = veryCompactRows ? 1.56 : compactRows ? 1.95 : 2.34;
      const badgeFontSize = veryCompactRows ? 4.16 : compactRows ? 4.94 : 5.72;
      const textFontSize = veryCompactRows ? 6.5 : compactRows ? 7.54 : 8.84;

      // Posicao: rodape da coluna esquerda (alinhada com final da celula).
      // Padding aumentado junto com a fonte pra nao colar no fim da celula.
      const rowBottomPad = compactRows ? 2 : 2.6;
      const depositY = rowBottom - rowBottomPad;
      const badgeX = imageX + badgeRadius + 0.2;

      // ML badge amarelo (circulo)
      doc.setFillColor(255, 224, 64); // amarelo ML (#FFE040)
      doc.circle(badgeX, depositY, badgeRadius, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(badgeFontSize);
      doc.setTextColor(51, 51, 51); // cinza escuro
      doc.text("ML", badgeX, depositY + badgeFontSize / 3, {
        align: "center",
      });

      // Texto do deposito ao lado direito do badge
      const textX = badgeX + badgeRadius + 1.2;
      doc.setFontSize(textFontSize);
      if (isFull) {
        // FULL: texto cinza thin com raio antes
        doc.setTextColor(120, 120, 120);
        doc.setFont("helvetica", "normal");
        doc.text(`⚡ FULL`, textX, depositY + textFontSize / 3);
      } else if (isWithoutDeposit) {
        doc.setTextColor(17, 24, 39);
        doc.setFont("helvetica", "bold");
        doc.text("Vendas sem depósito", textX, depositY + textFontSize / 3);
      } else {
        // Ourinhos / outros — UPPERCASE em preto bold
        doc.setTextColor(17, 24, 39);
        doc.setFont("helvetica", "bold");
        doc.text(
          depositText.toUpperCase(),
          textX,
          depositY + textFontSize / 3,
          { maxWidth: LEFT_W - (textX - x0) - 2 }
        );
      }
    }

    // ─── LAYOUT SIMPLIFICADO + FONTES EM NEGRITO ───────────────────
    // Tudo em helvetica bold, com hierarquia por tamanho.
    // titleFont reduzido em 20% pra evitar que nomes longos (2 linhas)
    // empurrem o #numero-da-venda pra cima do logo Eg / QR da venda.
    let textY = rowTop + 2.8;
    const skuFont = veryCompactRows ? 6 : compactRows ? 7 : 8.5;
    const titleFont = veryCompactRows ? 5.6 : compactRows ? 6.4 : 7.8;
    const customerFont = veryCompactRows ? 6.4 : compactRows ? 7.4 : 9;
    const nicknameFont = veryCompactRows ? 5.8 : compactRows ? 6.6 : 7.8;
    const saleNumberFont = veryCompactRows ? 5.8 : compactRows ? 6.6 : 7.8;
    const saleMetaFont = veryCompactRows ? 5.4 : compactRows ? 6 : 7;

    // SKU: destacado no topo
    doc.setFont("helvetica", "bold");
    doc.setFontSize(skuFont);
    doc.setTextColor(17, 24, 39);
    doc.text(`SKU: ${item.sku || "-"}`, centerX, textY);
    textY += compactRows ? 3.8 : 4.8;

    // Nome do produto
    doc.setFont("helvetica", "bold");
    doc.setFontSize(titleFont);
    doc.setTextColor(17, 24, 39);
    const productLines = doc.splitTextToSize(
      item.itemTitle || sale.productName || "-",
      maxTextW
    );
    const maxProductLines = 2;
    doc.text(productLines.slice(0, maxProductLines), centerX, textY);
    textY += Math.min(productLines.length, maxProductLines) * (compactRows ? 3.2 : 4.1) + 0.8;

    // Nome do comprador
    doc.setFont("helvetica", "bold");
    doc.setFontSize(customerFont);
    doc.setTextColor(17, 24, 39);
    doc.text(sale.customerName || "-", centerX, textY, { maxWidth: maxTextW });
    textY += compactRows ? 3.5 : 4.3;

    // Nickname
    doc.setFont("helvetica", "bold");
    doc.setFontSize(nicknameFont);
    doc.setTextColor(185, 28, 28); // vermelho escuro
    doc.text(sale.customerNickname || "-", centerX, textY, { maxWidth: maxTextW });
    textY += compactRows ? 3.2 : 4;

    // Pré-calcula posição do QR da venda (e logo lateral) pra poder fazer
    // safe-guard de overlap antes de desenhar o número da venda.
    const saleQrSize = veryCompactRows ? 10.5 : compactRows ? 12.8 : 18.5;
    const saleQrX = centerX;
    const saleQrY = rowBottom - saleQrSize - (compactRows ? 4.8 : 6.6);

    // Safe-guard: se o nome do produto é longo e empurrou o textY pra
    // baixo, o #numero-da-venda e a data caem em cima do logo Eg.
    // Clampa textY pra ficar ACIMA do saleQrY com margem mínima.
    const saleNumberMaxY = saleQrY - (compactRows ? 1.8 : 2.4);
    if (textY > saleNumberMaxY) textY = saleNumberMaxY;

    // #Number + Data
    const saleNumberText = `#${sale.saleNumber || "-"}`;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(saleNumberFont);
    doc.setTextColor(17, 24, 39);
    doc.text(saleNumberText, centerX, textY, { maxWidth: maxTextW * 0.56 });

    const saleNumberWidth = doc.getTextWidth(saleNumberText);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(saleMetaFont);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `${sale.saleDate || "-"} ${sale.saleTime || ""}`.trim(),
      centerX + saleNumberWidth + 3,
      textY,
      { maxWidth: Math.max(10, maxTextW - saleNumberWidth - 3) }
    );
    const showObservation = index === 0 && Boolean(labelObservation);

    if (showObservation) {
      const noteTop = textY + 1.3;
      const availableNoteHeight = saleQrY - noteTop - 1;
      const noteWidth = Math.min(maxTextW, compactRows ? 40 : 58);
      textY += drawObservationBox(
        doc,
        labelObservation,
        centerX,
        noteTop,
        noteWidth,
        availableNoteHeight,
        compactRows
      );
    }

    const saleQrData = await generateQRCodeDataUrl(sale.saleQrcodeValue);

    if (saleQrData) {
      try {
        doc.addImage(saleQrData, "PNG", saleQrX, saleQrY, saleQrSize, saleQrSize);
      } catch {
        doc.setFontSize(5);
        doc.setTextColor(170, 170, 180);
        doc.text("Sem QR", saleQrX + saleQrSize / 2, saleQrY + saleQrSize / 2, {
          align: "center",
        });
      }
    } else {
      doc.setFontSize(5);
      doc.setTextColor(170, 170, 180);
      doc.text("Sem QR", saleQrX + saleQrSize / 2, saleQrY + saleQrSize / 2, {
        align: "center",
      });
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(veryCompactRows ? 4.6 : 5.4);
    doc.setTextColor(120, 120, 130);
    doc.text(
      "QR VENDA",
      saleQrX + saleQrSize / 2,
      saleQrY + saleQrSize + (compactRows ? 2 : 2.8),
      {
        align: "center",
      }
    );

    if (logoData) {
      try {
        drawContainedImage(
          doc,
          logoData,
          saleQrX + saleQrSize + (compactRows ? 4 : 6),
          saleQrY + (compactRows ? 1.3 : 2.4),
          compactRows ? 16 : 22,
          compactRows ? 11 : 16
        );
      } catch {
        // Keep PDF generation running even if logo render fails.
      }
    }

    // ─── Bloco CORREDOR / ESTANTE / NÍVEL / VARIAÇÃO ───────────────
    // Valores puxam do item (SKU específico) ou fallback do sale.
    // Posicionamento: à direita do logo, dimensionado para caber sem cortar.
    const locCorridor = item.locationCorridor || sale.locationCorridor || "";
    const locShelf = item.locationShelf || sale.locationShelf || "";
    const locLevel = item.locationLevel || sale.locationLevel || "";
    const variation = item.variation || sale.variation || "";

    // Posicionamento: calcula distância exata após o logo
    const infoX = saleQrX + saleQrSize + (compactRows ? 20 : 27);
    const infoFont = veryCompactRows ? 5.6 : compactRows ? 6.4 : 7.6;
    const infoLineH = veryCompactRows ? 3.2 : compactRows ? 3.8 : 4.6;
    let infoY = saleQrY + (compactRows ? 1.8 : 2.6);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(infoFont);
    doc.setTextColor(17, 24, 39);

    // Largura máxima disponível até o divider do QR PEÇA
    const infoMaxW = dividerX - infoX - 2;

    doc.text(`CORREDOR : ${locCorridor}`, infoX, infoY, { maxWidth: infoMaxW });
    infoY += infoLineH;
    doc.text(`ESTANTE : ${locShelf}`, infoX, infoY, { maxWidth: infoMaxW });
    infoY += infoLineH;
    doc.text(`NIVEL : ${locLevel}`, infoX, infoY, { maxWidth: infoMaxW });
    infoY += infoLineH;

    // VARIAÇÃO: trunca se muito longa
    doc.setFont("helvetica", "bold");
    doc.setTextColor(17, 24, 39);
    if (variation) {
      const varText = `VARIACAO : ${variation}`;
      const varLines = doc.splitTextToSize(varText, infoMaxW);
      doc.text(varLines.slice(0, 2), infoX, infoY);
    } else {
      doc.text(`VARIACAO :`, infoX, infoY);
    }

    let qrY = rowTop + 2.4;
    const pieceQrData = await generateQRCodeDataUrl(item.sku || "");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(compactRows ? 5.8 : 7);
    doc.setTextColor(156, 163, 175);
    doc.text("QR PECA", rightX + rightContentW / 2, qrY + 1.4, { align: "center" });
    qrY += compactRows ? 4.4 : 5.2;

    const pieceQrSize = Math.max(
      veryCompactRows ? 9.5 : compactRows ? 12 : 21.5,
      Math.min(rowHeight - (compactRows ? 10.5 : 11), compactRows ? 12 : 21.5)
    );

    if (pieceQrData) {
      const qrX = rightX + (rightContentW - pieceQrSize) / 2;
      try {
        doc.addImage(pieceQrData, "PNG", qrX, qrY, pieceQrSize, pieceQrSize);
      } catch {
        doc.setFontSize(5);
        doc.setTextColor(170, 170, 180);
        doc.text("Sem QR", rightX + rightContentW / 2, qrY + pieceQrSize / 2, {
          align: "center",
        });
      }
    } else {
      doc.setFontSize(5);
      doc.setTextColor(170, 170, 180);
      doc.text("Sem QR", rightX + rightContentW / 2, qrY + pieceQrSize / 2, {
        align: "center",
      });
    }

    doc.setFontSize(compactRows ? 6.5 : 8);
    doc.setTextColor(107, 114, 128);
    doc.text(item.sku || "-", rightX + rightContentW / 2, qrY + pieceQrSize + (compactRows ? 2.6 : 3.4), {
      align: "center",
    });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(compactRows ? 7.8 : 9.6);
    doc.setTextColor(51, 65, 85);
    doc.text(
      `Qtd: ${item.quantity || 1}`,
      rightX + rightContentW / 2,
      qrY + pieceQrSize + (compactRows ? 6 : 7.6),
      {
        align: "center",
      }
    );
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
