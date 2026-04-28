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

// ─── Nome amigável do depósito (Ourinhos Rua Dario Alonso, FULL, etc.)
// O ML grava o `deposit_snapshot.label` com o code do node (ex: "BRSP04"),
// mas /api/ml/stores expõe o `description` amigável. Cache simples em
// memória pra evitar fetch a cada chamada de etiqueta.

let cachedSellerStoreName: string | null | undefined = undefined;
let inflightStoreFetch: Promise<string | null> | null = null;

export async function fetchSellerStoreName(): Promise<string | null> {
  if (cachedSellerStoreName !== undefined) return cachedSellerStoreName;
  if (inflightStoreFetch) return inflightStoreFetch;
  inflightStoreFetch = (async () => {
    try {
      const r = await fetch("/api/ml/stores", { credentials: "include" });
      if (!r.ok) return null;
      const data = await r.json();
      const stores = Array.isArray(data?.stores) ? data.stores : [];
      const first = stores.find((s: { description?: string | null }) => s?.description);
      const name = (first?.description as string | undefined) || null;
      cachedSellerStoreName = name;
      return name;
    } catch {
      cachedSellerStoreName = null;
      return null;
    } finally {
      inflightStoreFetch = null;
    }
  })();
  return inflightStoreFetch;
}

// Heurística: o code do node ML segue o padrão "BRSP04", "BRRJ12" etc.
// (2 letras país + 2 letras estado + 2-4 dígitos). Se o depositLabel
// bate esse padrão, é o code bruto e não o nome amigável → substituir
// pelo nome do store do seller.
function looksLikeNodeCode(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^[A-Z]{2,4}\d{2,4}$/.test(value.trim());
}

export function applyLocationsToSale(
  sale: SaleData,
  locations: StockLocationMap,
  storeName?: string | null,
): SaleData {
  const topLoc = sale.sku ? locations[sale.sku] : null;
  // Substitui depositLabel quando vem como code do node ML (ex: BRSP04)
  // pelo nome amigável do store do seller (ex: "Ourinhos Rua Dario Alonso").
  const friendlyDeposit =
    storeName && looksLikeNodeCode(sale.depositLabel ?? null)
      ? storeName
      : sale.depositLabel;
  return {
    ...sale,
    depositLabel: friendlyDeposit,
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
  const [locations, storeName] = await Promise.all([
    fetchStockLocationsBySku(skus),
    fetchSellerStoreName(),
  ]);
  if (Object.keys(locations).length === 0 && !storeName) return sales;
  return sales.map((sale) => applyLocationsToSale(sale, locations, storeName));
}
