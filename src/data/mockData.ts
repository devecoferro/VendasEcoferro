import { DocumentRecord, DashboardStats, SaleData } from "@/types/sales";

export const mockSales: SaleData[] = [
  {
    id: "s1",
    saleNumber: "2000004875631248",
    saleDate: "2025-03-15",
    saleTime: "14:32",
    customerName: "João Carlos Pereira",
    customerNickname: "JOAOC.PEREIRA",
    productName: "Kit 3 Películas Vidro Temperado Samsung Galaxy S24 Ultra",
    sku: "PEL-S24U-3PK",
    quantity: 2,
    amount: 49.9,
    barcodeValue: "7891234567890",
    qrcodeValue: "https://mercadolivre.com.br/venda/2000004875631248",
    productImageUrl: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=200&h=200&fit=crop",
  },
  {
    id: "s2",
    saleNumber: "2000004875631399",
    saleDate: "2025-03-15",
    saleTime: "16:10",
    customerName: "Maria Fernanda Souza",
    customerNickname: "MAFE.SOUZA",
    productName: "Capinha Anti-impacto iPhone 15 Pro Max Transparente",
    sku: "CAP-IP15PM-TR",
    quantity: 1,
    amount: 34.5,
    barcodeValue: "7891234567891",
    qrcodeValue: "https://mercadolivre.com.br/venda/2000004875631399",
    productImageUrl: "https://images.unsplash.com/photo-1592899677977-9c10ca588bbd?w=200&h=200&fit=crop",
  },
  {
    id: "s3",
    saleNumber: "2000004875631500",
    saleDate: "2025-03-14",
    saleTime: "09:45",
    customerName: "Ricardo Almeida",
    customerNickname: "RICK.ALM",
    productName: "Carregador Turbo USB-C 25W Samsung Original",
    sku: "CHRG-USB-25W",
    quantity: 3,
    amount: 79.9,
    barcodeValue: "7891234567892",
    qrcodeValue: "https://mercadolivre.com.br/venda/2000004875631500",
    productImageUrl: "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=200&h=200&fit=crop",
  },
];

export const mockDocuments: DocumentRecord[] = [
  {
    id: "d1",
    fileName: "vendas_15_marco.pdf",
    fileType: "pdf",
    processingStatus: "completed",
    sales: [mockSales[0], mockSales[1]],
    createdAt: "2025-03-15T14:30:00Z",
  },
  {
    id: "d2",
    fileName: "venda_carregador.png",
    fileType: "png",
    processingStatus: "completed",
    sales: [mockSales[2]],
    createdAt: "2025-03-14T09:45:00Z",
  },
  {
    id: "d3",
    fileName: "vendas_lote_marco.pdf",
    fileType: "pdf",
    processingStatus: "review",
    sales: [],
    createdAt: "2025-03-16T11:00:00Z",
  },
];

export const mockStats: DashboardStats = {
  totalDocuments: 12,
  totalPdfsGenerated: 28,
  successRate: 92,
  totalSales: 34,
};
