export interface SaleItemData {
  itemTitle: string;
  sku: string;
  quantity: number;
  amount?: number;
  productImageUrl?: string;
  productImageData?: string;
  variation?: string | null;
  locationCorridor?: string | null;
  locationShelf?: string | null;
  locationLevel?: string | null;
}

export interface SaleData {
  id: string;
  saleNumber: string;
  saleDate: string;
  saleTime: string;
  customerName: string;
  customerNickname: string;
  productName: string;
  sku: string;
  quantity: number;
  amount?: number;
  barcodeValue: string;
  qrcodeValue: string;
  saleQrcodeValue: string;
  productImageUrl: string;
  productImageData?: string;
  labelObservation?: string;
  groupedItems?: SaleItemData[];
  variation?: string | null;
  locationCorridor?: string | null;
  locationShelf?: string | null;
  locationLevel?: string | null;
  /**
   * Depósito de origem do pedido — mostrado em negrito abaixo da imagem
   * na etiqueta interna Ecoferro pra o operador distinguir visualmente
   * o canal logístico. Valores tipicos:
   * - "FULL" (Mercado Envios — estoque no ML)
   * - "Ourinhos Rua Dario Alonso"
   * - "Sem depósito"
   */
  depositLabel?: string | null;
}

export interface DocumentRecord {
  id: string;
  fileName: string;
  fileType: "pdf" | "png" | "jpg" | "jpeg";
  processingStatus: "processing" | "review" | "completed" | "failed";
  sales: SaleData[];
  createdAt: string;
}

export interface DashboardStats {
  totalDocuments: number;
  totalPdfsGenerated: number;
  successRate: number;
  totalSales: number;
}
