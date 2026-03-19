import { SaleData } from "@/types/sales";
import { Package, User, Hash, Calendar, ShoppingCart } from "lucide-react";

interface SaleCardPreviewProps {
  sale: SaleData;
}

export function SaleCardPreview({ sale }: SaleCardPreviewProps) {
  const productImageSrc = sale.productImageData || sale.productImageUrl;

  return (
    <div className="glass-card p-0 overflow-hidden animate-fade-in">
      <div className="flex flex-col sm:flex-row">
        {/* Product image */}
        <div className="sm:w-36 h-36 bg-secondary flex items-center justify-center p-4 flex-shrink-0">
          <div className="w-24 h-24 rounded-xl overflow-hidden border-2 border-border shadow-sm bg-card">
            {productImageSrc ? (
              <img
                src={productImageSrc}
                alt={sale.productName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "/placeholder.svg";
                }}
              />
            ) : (
              <img
                src="/placeholder.svg"
                alt="Sem imagem disponível"
                className="w-full h-full object-cover"
              />
            )}
          </div>
        </div>

        {/* Center info */}
        <div className="flex-1 p-4 space-y-2 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold bg-primary/10 text-primary px-2 py-0.5 rounded">
              {sale.sku}
            </span>
            <span className="text-xs text-muted-foreground">Qtd: {sale.quantity}</span>
          </div>
          <p className="text-sm font-semibold text-foreground truncate">{sale.productName}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Hash className="w-3 h-3" />
              <span className="truncate">{sale.saleNumber}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3 h-3" />
              <span>{sale.saleDate} {sale.saleTime}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <User className="w-3 h-3" />
              <span className="truncate">{sale.customerName}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ShoppingCart className="w-3 h-3" />
              <span>{sale.customerNickname}</span>
            </div>
          </div>
        </div>

        {/* Right codes */}
        <div className="sm:w-32 p-4 flex flex-row sm:flex-col items-center justify-center gap-3 border-t sm:border-t-0 sm:border-l border-border bg-secondary/50">
          <div className="text-center">
            <div className="w-20 h-10 bg-foreground/5 rounded border border-border flex items-center justify-center">
              <span className="text-[8px] font-mono text-muted-foreground">BARCODE</span>
            </div>
            <p className="text-[8px] text-muted-foreground mt-1 font-mono">{sale.sku || "—"}</p>
          </div>
          <div className="text-center">
            <div className="w-14 h-14 bg-foreground/5 rounded border border-border flex items-center justify-center">
              <span className="text-[8px] font-mono text-muted-foreground">QR</span>
            </div>
            <p className="text-[8px] text-muted-foreground mt-1 font-mono">{sale.sku || "—"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
