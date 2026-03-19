import { SaleData } from "@/types/sales";

interface ExtractionResult {
  sale: SaleData;
  rawText: string;
  confidence: Record<string, "high" | "medium" | "low" | "empty">;
}

const MONTH_MAP: Record<string, string> = {
  jan: "01", fev: "02", mar: "03", abr: "04",
  mai: "05", jun: "06", jul: "07", ago: "08",
  set: "09", out: "10", nov: "11", dez: "12",
};

/**
 * Split raw text into individual sale blocks using "ML" + optional city + "#" as delimiter.
 * Handles patterns like "ML #", "ML OURINHOS #", "ML CITY NAME #" etc.
 */
export function splitSaleBlocks(rawText: string): string[] {
  const parts = rawText.split(/(?=ML\s+(?:[A-ZÀ-Ú]+\s+)*#|\bML\s*#)/i);
  const blocks = parts.filter((b) => b.trim().length > 20);
  if (blocks.length > 1) return blocks;

  // Fallback: split by "Imprimir etiqueta"
  const parts2 = rawText.split(/(?=Imprimir\s+etiqueta)/i);
  const blocks2 = parts2.filter((b) => b.trim().length > 20);
  if (blocks2.length > 1) return blocks2;

  return [rawText];
}

/**
 * Extract the product line: the first meaningful line AFTER "Imprimir etiqueta".
 * Handles "Imprimir etiqueta" appearing mid-line or on its own line.
 * Falls back to any line matching the product+price pattern.
 */
function extractProductLine(block: string): string | null {
  // Strategy 1: find text after "Imprimir etiqueta"
  const imprimirIdx = block.search(/Imprimir\s+etiqueta/i);
  if (imprimirIdx !== -1) {
    const afterImprimir = block.slice(imprimirIdx);
    // Remove "Imprimir etiqueta" and any trailing text on the same line before newline
    const afterLabel = afterImprimir.replace(/^.*Imprimir\s+etiqueta[^\n]*/i, "");
    // Skip lines that are just continuation of reputation text
    const lines = afterLabel.split(/\n/).filter((l) => {
      const t = l.trim();
      return t.length > 5 && !/^afetar\s+sua/i.test(t) && !/^O comprador/i.test(t) && !/^Para\s+(organizar|entregar)/i.test(t);
    });
    // Find first line with R$
    const rLine = lines.find((l) => /R\$/.test(l));
    if (rLine) return rLine.trim();
    // Or first non-empty meaningful line
    if (lines.length > 0) return lines[0].trim();
  }

  // Strategy 2: find any line with the product pattern anywhere in block
  const productPattern = block.match(/^(.{5,}?)\s+R\$\s*[\d.,]+\s*\d+\s*unidades?/im);
  if (productPattern) return productPattern[0].trim();

  return null;
}

/**
 * Extract customer name and nickname from the zone between
 * "Não afeta sua reputação" and "Iniciar conversa".
 * Handles concatenated formats like "Luiz FelypheFELYPHELUI…"
 */
function extractCustomer(block: string): { name: string; nickname: string; confidence: "high" | "medium" | "low" | "empty" } {
  // Try to isolate the buyer zone between reputation text and "Iniciar conversa"
  let buyerZone = "";

  const reputacaoMatch = block.match(/(?:N[ãa]o\s+afeta\s+sua\s+reputa[çc][ãa]o|reputação)\s*(.*?)(?:Iniciar\s+conversa)/is);
  if (reputacaoMatch) {
    buyerZone = reputacaoMatch[1].trim();
  }

  if (!buyerZone) {
    return { name: "", nickname: "", confidence: "empty" };
  }

  // Real patterns from ML PDFs:
  // "Luiz FelypheFELYPHELUI…"  → name="Luiz Felyphe", nick="FELYPHELUI"
  // "João HenriqueHJ202501311…" → name="João Henrique", nick="HJ202501311"
  // "Iranildo AraujoMATOSIRANI…" → name="Iranildo Araujo", nick="MATOSIRATI"
  // "Fabricio Matos N…FABRICIOMA…" → name="Fabricio Matos N", nick="FABRICIOMA"
  // "FRANCISCO JE…JEORGEVALI…" → name="FRANCISCO JE", nick="JEORGEVALI"
  // "Ruderson Belar… RUDERSONB…" → name="Ruderson Belar", nick="RUDERSONB"

  // Strategy: find the last uppercase-only sequence (3+ chars) possibly ending with …
  // That's the nickname. Everything before it is the name.
  
  // Handle patterns with "…" separating name from nick, possibly with space
  const splitByEllipsis = buyerZone.match(/^(.+?)\s*…\s*([A-Z][A-Z0-9._]{2,})…?\s*$/);
  if (splitByEllipsis) {
    return {
      name: splitByEllipsis[1].replace(/…/g, "").trim(),
      nickname: splitByEllipsis[2].replace(/…/g, "").trim(),
      confidence: "high",
    };
  }

  // Handle concatenated: "Luiz FelypheFELYPHELUI…" — find where uppercase block starts
  // Look for transition from lowercase/mixed to ALL-UPPERCASE sequence
  const concatMatch = buyerZone.match(
    /^((?:[A-ZÀ-Ú][a-zà-ú]+\s*)+?)([A-Z][A-Z0-9._]{2,}[…]?)$/
  );
  if (concatMatch) {
    return {
      name: concatMatch[1].trim(),
      nickname: concatMatch[2].replace(/…$/, "").trim(),
      confidence: "high",
    };
  }

  // Handle all-caps names: "FRANCISCO JE…JEORGEVALI…"
  const allCapsMatch = buyerZone.match(
    /^([A-ZÀ-Ú][A-ZÀ-Ú\s.…]+?)\s*([A-Z][A-Z0-9._]{2,}[…]?)$/
  );
  if (allCapsMatch) {
    return {
      name: allCapsMatch[1].replace(/…/g, "").trim(),
      nickname: allCapsMatch[2].replace(/…$/, "").trim(),
      confidence: "medium",
    };
  }

  // Last resort: treat entire zone as name
  return {
    name: buyerZone.replace(/…/g, "").trim(),
    nickname: "",
    confidence: "low",
  };
}

/**
 * Extract sale fields from a single block of text (one sale).
 */
export function extractSaleFields(rawText: string): ExtractionResult {
  const confidence: Record<string, "high" | "medium" | "low" | "empty"> = {};

  // === SALE NUMBER === (handles "ML OURINHOS #123" and "ML #123")
  const saleNumMatch = rawText.match(/ML\s+(?:[A-ZÀ-Ú]+\s+)*#\s*(\d{10,20})/i) || rawText.match(/#\s*(\d{10,20})/);
  const saleNumber = saleNumMatch ? saleNumMatch[1] : "";
  confidence["saleNumber"] = saleNumber ? "high" : "empty";

  // === DATE + TIME ===
  let saleDate = "";
  let saleTime = "";

  // Pattern with day: "18 mar 19:35 hs"
  // Pattern without day: "mar 19:35 hs" (common in ML PDFs)
  const mlDateWithDay = rawText.match(
    /(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)(?:\s+(\d{4}))?\s+(\d{1,2}:\d{2})\s*(?:hs?)?/i
  );
  const mlDateNoDay = rawText.match(
    /(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s+(\d{1,2}:\d{2})\s*(?:hs?)?/i
  );

  if (mlDateWithDay) {
    const day = mlDateWithDay[1].padStart(2, "0");
    const monthNum = MONTH_MAP[mlDateWithDay[2].toLowerCase()];
    let year = mlDateWithDay[3] || "";
    if (!year) {
      const now = new Date();
      const candidate = new Date(now.getFullYear(), parseInt(monthNum, 10) - 1, parseInt(day, 10));
      year = candidate > now ? (now.getFullYear() - 1).toString() : now.getFullYear().toString();
    }
    saleDate = `${year}-${monthNum}-${day}`;
    saleTime = mlDateWithDay[4];
    confidence["saleDate"] = mlDateWithDay[3] ? "high" : "medium";
    confidence["saleTime"] = "high";
  } else if (mlDateNoDay) {
    // No day available — use month + time only
    const monthNum = MONTH_MAP[mlDateNoDay[1].toLowerCase()];
    const now = new Date();
    saleDate = `${now.getFullYear()}-${monthNum}`;
    saleTime = mlDateNoDay[2];
    confidence["saleDate"] = "low";
    confidence["saleTime"] = "high";
  } else {
    const dateMatch = rawText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (dateMatch) {
      saleDate = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
      confidence["saleDate"] = "high";
    } else {
      const isoMatch = rawText.match(/(\d{4}-\d{2}-\d{2})/);
      saleDate = isoMatch ? isoMatch[1] : "";
      confidence["saleDate"] = isoMatch ? "high" : "empty";
    }
    const timeMatch = rawText.match(/(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:h|hs)?/i);
    saleTime = timeMatch ? timeMatch[1] : "";
    confidence["saleTime"] = saleTime ? "high" : "empty";
  }

  // === CUSTOMER NAME + NICKNAME ===
  const customer = extractCustomer(rawText);
  const customerName = customer.name;
  const customerNickname = customer.nickname;
  confidence["customerName"] = customer.confidence;
  confidence["customerNickname"] = customer.nickname ? customer.confidence : "empty";

  // === PRODUCT (from line after "Imprimir etiqueta") ===
  let productName = "";
  let amount: number | undefined;
  let sku = "";
  let quantity = 1;

  const productLine = extractProductLine(rawText);

  if (productLine) {
    // Full pattern: "Name R$ 26 1 unidade SKU: EC007"
    const fullMatch = productLine.match(
      /^(.+?)\s+R\$\s*([\d.,]+)\s*(\d+)\s*unidades?\s+SKU:\s*([A-Z0-9_-]+)/i
    );
    if (fullMatch) {
      productName = fullMatch[1].trim();
      amount = parseFloat(fullMatch[2].replace(/\./g, "").replace(",", "."));
      quantity = parseInt(fullMatch[3], 10) || 1;
      sku = fullMatch[4];
      confidence["productName"] = "high";
      confidence["amount"] = "high";
      confidence["quantity"] = "high";
      confidence["sku"] = "high";
    } else {
      // Without SKU: "Name R$ 26 1 unidade"
      const noSkuMatch = productLine.match(
        /^(.+?)\s+R\$\s*([\d.,]+)\s*(\d+)\s*unidades?/i
      );
      if (noSkuMatch) {
        productName = noSkuMatch[1].trim();
        amount = parseFloat(noSkuMatch[2].replace(/\./g, "").replace(",", "."));
        quantity = parseInt(noSkuMatch[3], 10) || 1;
        confidence["productName"] = "high";
        confidence["amount"] = "high";
        confidence["quantity"] = "high";
      } else {
        // Just name before R$
        const nameOnly = productLine.match(/^(.+?)\s+R\$/i);
        if (nameOnly) {
          productName = nameOnly[1].trim();
          confidence["productName"] = "medium";
        } else {
          productName = productLine.slice(0, 120);
          confidence["productName"] = "low";
        }

        const amtMatch = productLine.match(/R\$\s*([\d.,]+)/);
        if (amtMatch) {
          amount = parseFloat(amtMatch[1].replace(/\./g, "").replace(",", "."));
          confidence["amount"] = "high";
        }

        const qtyMatch = productLine.match(/(\d+)\s*unidades?/i);
        quantity = qtyMatch ? parseInt(qtyMatch[1], 10) || 1 : 1;
      }

      // Try standalone SKU
      const skuMatch = productLine.match(/SKU:\s*([A-Z0-9_-]+)/i) || rawText.match(/SKU:\s*([A-Z0-9_-]+)/i);
      sku = skuMatch ? skuMatch[1] : "";
      confidence["sku"] = sku ? "high" : "empty";
    }
  } else {
    // No product line found — try global fallbacks
    const globalProduct = rawText.match(/(.{5,}?)\s+R\$\s*([\d.,]+)/i);
    if (globalProduct) {
      // Ensure we're not grabbing the header line
      const candidate = globalProduct[1].trim();
      if (!/ML\s*#/i.test(candidate) && !/\d{1,2}\s+(jan|fev|mar|abr|mai)/i.test(candidate)) {
        productName = candidate;
        amount = parseFloat(globalProduct[2].replace(/\./g, "").replace(",", "."));
        confidence["productName"] = "low";
        confidence["amount"] = "medium";
      }
    }
    confidence["productName"] = confidence["productName"] || "empty";
    confidence["amount"] = confidence["amount"] || "empty";

    const skuMatch = rawText.match(/SKU:\s*([A-Z0-9_-]+)/i);
    sku = skuMatch ? skuMatch[1] : "";
    confidence["sku"] = sku ? "high" : "empty";
  }

  confidence["quantity"] = confidence["quantity"] || (quantity > 1 ? "high" : "low");

  // Barcode and QR code derived from SKU (optional — never critical error)
  const barcodeValue = sku;
  const qrcodeValue = sku;
  confidence["barcodeValue"] = sku ? "high" : "low";
  confidence["qrcodeValue"] = sku ? "high" : "low";

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
    productImageData: "",
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
