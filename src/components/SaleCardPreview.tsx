import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { SaleData } from "@/types/sales";

interface SaleCardPreviewProps {
  sale: SaleData;
}

function CodePlaceholder({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center rounded-md border border-dashed border-border bg-white text-[10px] text-muted-foreground ${
        compact ? "h-20 w-20" : "min-h-20"
      }`}
    >
      {label}
    </div>
  );
}

function QRCodePreview({
  value,
  label,
  compact = false,
}: {
  value: string;
  label: string;
  compact?: boolean;
}) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    let active = true;

    if (!value) {
      setSrc("");
      return () => {
        active = false;
      };
    }

    QRCode.toDataURL(value, {
      width: compact ? 120 : 220,
      margin: 1,
      color: { dark: "#111827", light: "#FFFFFF" },
    })
      .then((dataUrl) => {
        if (active) setSrc(dataUrl);
      })
      .catch(() => {
        if (active) setSrc("");
      });

    return () => {
      active = false;
    };
  }, [compact, value]);

  if (!src) {
    return <CodePlaceholder label={value ? "Gerando QR..." : "Sem QR"} compact={compact} />;
  }

  return (
    <div className="rounded-md border border-border bg-white p-2 shadow-sm">
      <img
        src={src}
        alt={`${label} ${value}`}
        className={`mx-auto object-contain ${compact ? "h-16 w-16" : "h-28 w-28"}`}
      />
      <p className="mt-1 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-center font-mono text-[10px] text-muted-foreground">
        {value}
      </p>
    </div>
  );
}

export function SaleCardPreview({ sale }: SaleCardPreviewProps) {
  const productImageSrc = sale.productImageData || sale.productImageUrl;

  return (
    <div className="glass-card animate-fade-in p-4">
      <div className="overflow-hidden rounded-xl border border-slate-300 bg-card shadow-sm">
        <div className="flex flex-col md:flex-row">
          <div className="flex items-center justify-center border-b border-slate-200 bg-slate-50 p-5 md:w-44 md:border-b-0 md:border-r">
            <div className="flex h-32 w-32 items-center justify-center bg-transparent">
              {productImageSrc ? (
                <img
                  src={productImageSrc}
                  alt={sale.productName || "Produto"}
                  className="h-28 w-28 object-contain"
                  onError={(event) => {
                    (event.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <span className="px-4 text-center text-xs text-muted-foreground">
                  Sem imagem
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 space-y-4 p-5">
            <div className="space-y-3">
              <p className="text-base font-bold text-foreground">SKU: {sale.sku || "-"}</p>

              <div>
                <p className="text-2xl font-bold leading-tight text-foreground">
                  {sale.productName || "Produto sem nome"}
                </p>
              </div>

              <div>
                <p className="truncate text-3xl font-bold leading-none text-foreground">
                  {sale.customerName || "-"}
                </p>
              </div>

              <div>
                <p className="truncate text-2xl font-bold leading-none text-slate-500">
                  {sale.customerNickname || "-"}
                </p>
              </div>

              <div>
                <p className="text-2xl font-semibold leading-none text-slate-600">
                  #{sale.saleNumber || "-"}
                </p>
              </div>

              <div>
                <p className="text-sm text-muted-foreground">
                  {sale.saleDate || "-"} {sale.saleTime || ""}
                </p>
              </div>

              <div>
                <div className="w-fit">
                  <QRCodePreview value={sale.saleQrcodeValue} label="QR VENDA" compact />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-slate-50 p-4 md:w-44 md:border-l md:border-t-0">
            <QRCodePreview value={sale.qrcodeValue} label="QR PEÇA" />
          </div>
        </div>
      </div>
    </div>
  );
}
