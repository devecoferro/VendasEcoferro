import { describe, it, expect } from "vitest";
import { applyLocationsToSale } from "@/lib/stockLocation";
import type { SaleData } from "@/types/sales";

function makeSale(overrides: Partial<SaleData> = {}): SaleData {
  return {
    id: "test-1",
    saleNumber: "2000016102974372",
    saleDate: "24/04/2026",
    saleTime: "09:00",
    customerName: "Maria Eduarda",
    customerNickname: "MARIAEDUARDATERODORO",
    productName: "Eliminador Rabeta Universal Fixo",
    sku: "EC005",
    quantity: 1,
    barcodeValue: "EC005",
    qrcodeValue: "EC005",
    saleQrcodeValue: "2000016102974372",
    productImageUrl: "",
    expectedShippingDate: "25/04/2026",
    depositLabel: "Ourinhos Rua Dario Alonso",
    ...overrides,
  };
}

describe("etiqueta — validação visual de Corredor/Estante/Nível/Local", () => {
  it("applyLocationsToSale preenche os 4 campos (incluindo notes/Local)", () => {
    const sale = makeSale();
    const enriched = applyLocationsToSale(sale, {
      EC005: { corridor: "A", shelf: "3", level: "2", notes: "Prateleira topo" },
    });
    expect(enriched.locationCorridor).toBe("A");
    expect(enriched.locationShelf).toBe("3");
    expect(enriched.locationLevel).toBe("2");
    expect(enriched.locationNotes).toBe("Prateleira topo");
  });

  it("applyLocationsToSale preserva valores já setados (não sobrescreve)", () => {
    const sale = makeSale({ locationCorridor: "Z", locationNotes: "mantém" });
    const enriched = applyLocationsToSale(sale, {
      EC005: { corridor: "A", shelf: "3", level: "2", notes: "novo" },
    });
    expect(enriched.locationCorridor).toBe("Z");
    expect(enriched.locationNotes).toBe("mantém");
    expect(enriched.locationShelf).toBe("3");
  });

  it("applyLocationsToSale propaga em groupedItems por SKU próprio", () => {
    const sale = makeSale({
      groupedItems: [
        { itemTitle: "Item 1", sku: "EC005", quantity: 1 },
        { itemTitle: "Item 2", sku: "EC006", quantity: 1 },
      ],
    });
    const enriched = applyLocationsToSale(sale, {
      EC005: { corridor: "A", shelf: "1", level: "1", notes: null },
      EC006: { corridor: "B", shelf: "2", level: "3", notes: "gaveta" },
    });
    expect(enriched.groupedItems?.[0].locationCorridor).toBe("A");
    expect(enriched.groupedItems?.[1].locationCorridor).toBe("B");
    expect(enriched.groupedItems?.[1].locationNotes).toBe("gaveta");
  });

});
