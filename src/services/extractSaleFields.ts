import { SaleData } from "@/types/sales";

interface ExtractionResult {
  sale: SaleData;
  rawText: string;
  confidence: Record<string, "high" | "medium" | "low" | "empty">;
}

// Month abbreviation mapping for Portuguese
const MONTH_MAP: Record<string, string> = {
  jan: "01", fev: "02", mar: "03", abr: "04",
  mai: "05", jun: "06", jul: "07", ago: "08",
  set: "09", out: "10", nov: "11", dez: "12",
};

/**
 * Split raw text into individual sale blocks using ML # or "Imprimir etiqueta" as delimiters
 */
export function splitSaleBlocks(rawText: string): string[] {
  // Split by "ML #" keeping the delimiter
  const parts = rawText.split(/(?=ML\s*#)/i);
  const blocks = parts.filter((b) => b.trim().length > 20);
  if (blocks.length > 1) return blocks;

  // Fallback: split by "Imprimir etiqueta"
  const parts2 = rawText.split(/(?=Imprimir\s+etiqueta)/i);
  const blocks2 = parts2.filter((b) => b.trim().length > 20);
  if (blocks2.length > 1) return blocks2;

  // No split possible — treat entire text as one sale
  return [rawText];
}

/**
 * Extract sale fields from raw text using regex patterns
 * tailored for Mercado Livre sale documents
 */
export function extractSaleFields(rawText: string): ExtractionResult {
  const confidence: Record<string, "high" | "medium" | "low" | "empty"> = {};

  const extract = (
    field: string,
    patterns: RegExp[],
    fallback = ""
  ): string => {
    for (const pattern of patterns) {
      const match = rawText.match(pattern);
      if (match && match[1]?.trim()) {
        confidence[field] = "high";
        return match[1].trim();
      }
    }
    confidence[field] = fallback ? "low" : "empty";
    return fallback;
  };

  // Sale number — ML format: "ML #200001210464639118"
  const saleNumber = extract("saleNumber", [
    /ML\s*#\s*(\d{10,20})/i,
    /(?:venda|pedido|order|compra)[:\s#]*(\d{10,20})/i,
    /(?:Nº|N°|numero|número)[:\s]*(\d{10,20})/i,
  ]);

  // Date + Time — "18 mar 19:35 hs" format
  let saleDate = "";
  let saleTime = "";

  // Try ML short date: "18 mar 19:35 hs"
  // Try ML short date with optional year: "18 mar 2025 19:35 hs" or "18 mar 19:35 hs"
  const mlDateMatch = rawText.match(/(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)(?:\s+(\d{4}))?\s+(\d{1,2}:\d{2})\s*(?:hs?)?/i);
  if (mlDateMatch) {
    const day = mlDateMatch[1].padStart(2, "0");
    const monthNum = MONTH_MAP[mlDateMatch[2].toLowerCase()];
    // Use explicit year if present, otherwise infer: if date is in future, use last year
    let year = mlDateMatch[3] || "";
    if (!year) {
      const now = new Date();
      const candidateDate = new Date(now.getFullYear(), parseInt(monthNum, 10) - 1, parseInt(day, 10));
      year = candidateDate > now ? (now.getFullYear() - 1).toString() : now.getFullYear().toString();
    }
    saleDate = `${year}-${monthNum}-${day}`;
    saleTime = mlDateMatch[4];
    confidence["saleDate"] = mlDateMatch[3] ? "high" : "medium";
    confidence["saleTime"] = "high";
  } else {
    // Fallback: dd/mm/yyyy or yyyy-mm-dd
    saleDate = extract("saleDate", [
      /(\d{2}\/\d{2}\/\d{4})/,
      /(\d{4}-\d{2}-\d{2})/,
      /(\d{2}\s+de\s+\w+\s+de\s+\d{4})/i,
    ]);
    // Normalize DD/MM/YYYY to YYYY-MM-DD
    const dateMatch = saleDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (dateMatch) {
      saleDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
    }

    saleTime = extract("saleTime", [
      /(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:h|hs)?/i,
    ]);
  }

  // Customer name + nickname
  // Pattern: "Name SurnameNICKNAME… Iniciar conversa"
  // e.g. "Luiz FelypheFELYPHELUI…" or "João HenriqueHJ202501311…"
  let customerName = "";
  let customerNickname = "";

  const buyerMatch = rawText.match(
    /([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){0,4})([A-Z][A-Z0-9._]{2,}[…]?)\s*(?:Iniciar\s+conversa)?/
  );
  if (buyerMatch) {
    customerName = buyerMatch[1].trim();
    customerNickname = buyerMatch[2].replace(/…$/, "").trim();
    confidence["customerName"] = "high";
    confidence["customerNickname"] = "high";
  } else {
    customerName = extract("customerName", [
      /(?:comprador|cliente|buyer|destinat[áa]rio)[:\s]+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,5})/,
      /(?:nome|name)[:\s]+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,5})/i,
    ]);
    customerNickname = extract("customerNickname", [
      /(?:nickname|apelido|usuário|user)[:\s]+([A-Z0-9._-]+)/i,
      /\(([A-Z][A-Z0-9._]{2,})\)/,
    ]);
  }

  // Product name + amount + quantity + SKU from ML pattern:
  // "Suporte Olho De Gato - Ecoferro R$ 26 1 unidade SKU: EC007"
  let productName = "";
  let amount: number | undefined;
  let sku = "";
  let quantityStr = "1";

  const productLineMatch = rawText.match(
    /([A-ZÀ-Ú][^\n\r]{5,}?)\s+R\$\s*([\d.,]+)\s*(\d+)\s*unidades?\s+SKU:\s*([A-Z0-9_-]+)/i
  );
  if (productLineMatch) {
    productName = productLineMatch[1].trim();
    amount = parseFloat(productLineMatch[2].replace(/\./g, "").replace(",", "."));
    quantityStr = productLineMatch[3];
    sku = productLineMatch[4];
    confidence["productName"] = "high";
    confidence["amount"] = "high";
    confidence["quantity"] = "high";
    confidence["sku"] = "high";
  } else {
    // Fallback: try to extract product name before "R$"
    const prodBeforeR = rawText.match(/([A-ZÀ-Ú][^\n\r]{5,}?)\s+R\$/i);
    if (prodBeforeR) {
      productName = prodBeforeR[1].trim();
      confidence["productName"] = "medium";
    } else {
      productName = extract("productName", [
        /(?:produto|product|item|título|title)[:\s]+(.{10,120})/i,
        /(?:descrição|description)[:\s]+(.{10,120})/i,
      ]);
    }

    // SKU
    sku = sku || extract("sku", [
      /SKU[:\s]+([A-Z0-9_-]{3,30})/i,
      /(?:cod|código)[:\s]+([A-Z0-9_-]{3,30})/i,
      /(?:MLB|MLA|MLM)[\s-]?(\d{6,15})/i,
    ]);

    // Quantity
    quantityStr = extract("quantity", [
      /(?:quantidade|qty|qtd|qtde)[:\s]+(\d+)/i,
      /(\d+)\s*(?:unidade|unidades|un\.)/i,
    ], "1");

    // Amount
    const amountStr = extract("amount", [
      /R\$\s*([\d.,]+)/,
      /(?:valor|total|preço|price|amount)[:\s]*R?\$?\s*([\d.,]+)/i,
    ]);
    amount = amountStr
      ? parseFloat(amountStr.replace(/\./g, "").replace(",", "."))
      : undefined;
  }

  const quantity = parseInt(quantityStr, 10) || 1;

  // Barcode and QR code are both derived from SKU
  const barcodeValue = sku;
  const qrcodeValue = sku;
  confidence["barcodeValue"] = sku ? "high" : "empty";
  confidence["qrcodeValue"] = sku ? "high" : "empty";

  const sale: SaleData = {
    id: crypto.randomUUID(),
    saleNumber,
    saleDate,
    saleTime,
    customerName,
    customerNickname,
    productName,
    sku,
    quantity,
    amount,
    barcodeValue,
    qrcodeValue,
    productImageUrl: "",
  };

  return { sale, rawText, confidence };
}

/**
 * Extract multiple sales from raw text (handles multi-sale PDFs)
 */
export function extractMultipleSales(rawText: string): ExtractionResult[] {
  const blocks = splitSaleBlocks(rawText);
  return blocks.map((block) => extractSaleFields(block));
}
