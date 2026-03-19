import { SaleData } from "@/types/sales";

interface ExtractionResult {
  sale: SaleData;
  rawText: string;
  confidence: Record<string, "high" | "medium" | "low" | "empty">;
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

  // Sale number — ML format or generic long number
  const saleNumber = extract("saleNumber", [
    /(?:venda|pedido|order|compra)[:\s#]*(\d{10,20})/i,
    /ML\s*#?\s*(\d{10,20})/i,
    /(?:Nº|N°|numero|número)[:\s]*(\d{10,20})/i,
    /(\d{16,20})/,
  ]);

  // Date
  const saleDate = extract("saleDate", [
    /(\d{2}\/\d{2}\/\d{4})/,
    /(\d{4}-\d{2}-\d{2})/,
    /(\d{2}\s+de\s+\w+\s+de\s+\d{4})/i,
  ]);

  // Time
  const saleTime = extract("saleTime", [
    /(\d{2}:\d{2}(?::\d{2})?)\s*(?:h|hs)?/i,
  ]);

  // Customer name
  const customerName = extract("customerName", [
    /(?:comprador|cliente|buyer|destinat[áa]rio)[:\s]+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,5})/,
    /(?:nome|name)[:\s]+([A-ZÀ-Ú][a-zà-ú]+(?:\s+[A-ZÀ-Ú][a-zà-ú]+){1,5})/i,
  ]);

  // Customer nickname
  const customerNickname = extract("customerNickname", [
    /(?:nickname|apelido|usuário|user)[:\s]+([A-Z0-9._-]+)/i,
    /\(([A-Z][A-Z0-9._]{2,})\)/,
  ]);

  // Product name
  const productName = extract("productName", [
    /(?:produto|product|item|título|title)[:\s]+(.{10,120})/i,
    /(?:descrição|description)[:\s]+(.{10,120})/i,
  ]);

  // SKU
  const sku = extract("sku", [
    /(?:SKU|sku|cod|código)[:\s]+([A-Z0-9_-]{3,30})/i,
    /(?:MLB|MLA|MLM)[\s-]?(\d{6,15})/i,
  ]);

  // Quantity
  const quantityStr = extract("quantity", [
    /(?:quantidade|qty|qtd|qtde)[:\s]+(\d+)/i,
    /(\d+)\s*(?:unidade|unidades|un\.)/i,
  ], "1");
  const quantity = parseInt(quantityStr, 10) || 1;

  // Amount
  const amountStr = extract("amount", [
    /(?:valor|total|preço|price|amount)[:\s]*R?\$?\s*([\d.,]+)/i,
    /R\$\s*([\d.,]+)/,
  ]);
  const amount = amountStr
    ? parseFloat(amountStr.replace(/\./g, "").replace(",", "."))
    : undefined;

  // Barcode
  const barcodeValue = extract("barcodeValue", [
    /(?:barcode|código\s*de\s*barras|ean|gtin)[:\s]+(\d{8,14})/i,
    /(\d{13})/,
  ]);

  // QR code URL
  const qrcodeValue = extract("qrcodeValue", [
    /(https?:\/\/[^\s]{10,})/i,
  ]);

  // Normalize date to YYYY-MM-DD if in DD/MM/YYYY
  let normalizedDate = saleDate;
  const dateMatch = saleDate.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (dateMatch) {
    normalizedDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  }

  const sale: SaleData = {
    id: crypto.randomUUID(),
    saleNumber,
    saleDate: normalizedDate,
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
