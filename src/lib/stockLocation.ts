import { getMLConnectionStatus, getStockLocations, type StockLocation } from "@/services/mercadoLivreService";
import type { SaleData } from "@/types/sales";

export type StockLocationMap = Record<string, StockLocation>;

export async function fetchStockLocationsBySku(skus: string[]): Promise<StockLocationMap> {
  try {
    const cleanSkus = Array.from(new Set(skus.filter(Boolean)));
    if (cleanSkus.length === 0) return {};
    const conn = await getMLConnectionStatus();
    if (!conn?.id) return {};
    return await getStockLocations(conn.id, cleanSkus);
  } catch {
    return {};
  }
}

export function applyLocationsToSale(sale: SaleData, locations: StockLocationMap): SaleData {
  const topLoc = sale.sku ? locations[sale.sku] : null;
  return {
    ...sale,
    locationCorridor: sale.locationCorridor || topLoc?.corridor || null,
    locationShelf: sale.locationShelf || topLoc?.shelf || null,
    locationLevel: sale.locationLevel || topLoc?.level || null,
    locationNotes: sale.locationNotes || topLoc?.notes || null,
    groupedItems: (sale.groupedItems || []).map((item) => {
      const loc = item.sku ? locations[item.sku] : null;
      return {
        ...item,
        locationCorridor: item.locationCorridor || loc?.corridor || null,
        locationShelf: item.locationShelf || loc?.shelf || null,
        locationLevel: item.locationLevel || loc?.level || null,
        locationNotes: item.locationNotes || loc?.notes || null,
      };
    }),
  };
}

export async function enrichSalesWithLocations(sales: SaleData[]): Promise<SaleData[]> {
  const skus = sales.flatMap((s) => [s.sku, ...(s.groupedItems || []).map((i) => i.sku)]).filter(Boolean) as string[];
  const locations = await fetchStockLocationsBySku(skus);
  if (Object.keys(locations).length === 0) return sales;
  return sales.map((sale) => applyLocationsToSale(sale, locations));
}
