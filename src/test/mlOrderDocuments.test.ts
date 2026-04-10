import { describe, expect, it } from "vitest";
import { extractInvoiceMetadataFromXml } from "../../api/ml/_lib/order-documents.js";

describe("extractInvoiceMetadataFromXml", () => {
  it("extracts invoice number and key from NFe XML tags", () => {
    const xml = `
      <NFe>
        <infNFe Id="NFe35260412345678000123550010000012341000012345">
          <ide>
            <nNF>1234</nNF>
          </ide>
        </infNFe>
        <protNFe>
          <infProt>
            <chNFe>35260412345678000123550010000012341000012345</chNFe>
          </infProt>
        </protNFe>
      </NFe>
    `;

    expect(extractInvoiceMetadataFromXml(xml)).toEqual({
      invoice_number: "1234",
      invoice_key: "35260412345678000123550010000012341000012345",
    });
  });

  it("returns null metadata when XML is empty", () => {
    expect(extractInvoiceMetadataFromXml("")).toEqual({
      invoice_number: null,
      invoice_key: null,
    });
  });
});
