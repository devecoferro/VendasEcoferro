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
}

export interface SaleItemData {
  itemTitle: string;
  sku: string;
  quantity: number;
  amount?: number;
  productImageUrl?: string;
  productImageData?: string;
}

export interface DocumentRecord {
  id: string;
  fileName: string;
  fileType: string;
  processingStatus: "completed" | "review" | "processing" | "error";
  sales: SaleData[];
  createdAt: string;
}

export interface DashboardStats {
  totalDocuments: number;
  totalPdfsGenerated: number;
  successRate: number;
  totalSales: number;
}
