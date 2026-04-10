export interface SaleItemData {
  itemTitle: string;
  sku: string;
  quantity: number;
  amount?: number;
  productImageUrl?: string;
  productImageData?: string;
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
