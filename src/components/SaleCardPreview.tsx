import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import { SaleData } from "@/types/sales";

interface SaleCardPreviewProps {
  sale: SaleData;
}

function CodePlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-20 items-center justify-center rounded-md border border-dashed border-border bg-white text-[10px] text-muted-foreground">
      {label}
    </div>
  );
}

function BarcodePreview({ value }: { value: string }) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    if (!value) {
      svgRef.current.innerHTML = "";
      return;
    }

    try {
      JsBarcode(svgRef.current, value, {
        format: "CODE128",
        width: 1.35,
        height: 34,
        margin: 0,
        background: "#ffffff",
        lineColor: "#111827",
        displayValue: false,
      });
    } catch {
      svgRef.current.innerHTML = "";
    }
  }, [value]);

  if (!value) {
    return <CodePlaceholder label="Sem codigo" />;
  }

  return (
    <div className="rounded-md border border-border bg-white p-2 shadow-sm">
      <svg ref={svgRef} className="h-14 w-full overflow-visible" />
      <p className="mt-1 text-center font-mono text-[10px] text-muted-foreground">
        {value}
      </p>
    </div>
  );
}

function QRCodePreview({ value }: { value: string }) {
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
      width: 180,
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
  }, [value]);

  if (!src) {
    return <CodePlaceholder label={value ? "Gerando QR..." : "Sem QR"} />;
  }

  return (
    <div className="rounded-md border border-border bg-white p-2 shadow-sm">
      <img src={src} alt={`QR code ${value}`} className="mx-auto h-24 w-24 object-contain" />
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
            <div className="flex h-32 w-32 items-center justify-center rounded-full border-[6px] border-slate-100 bg-white shadow-sm ring-1 ring-slate-200">
              {productImageSrc ? (
                <img
                  src={productImageSrc}
                  alt={sale.productName || "Produto"}
                  className="h-24 w-24 object-contain"
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
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-bold text-primary">
                  SKU: {sale.sku || "-"}
                </span>
                <span className="text-sm text-muted-foreground">
                  {sale.quantity} unidade{sale.quantity !== 1 ? "s" : ""}
                </span>
              </div>

              <div>
                <p className="text-2xl font-bold leading-tight text-foreground">
                  {sale.productName || "Produto sem nome"}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-2xl font-semibold leading-none text-slate-600">
                  #{sale.saleNumber || "-"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {sale.saleDate || "-"} {sale.saleTime || ""}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1.3fr_1fr]">
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  Cliente
                </p>
                <p className="truncate text-3xl font-bold leading-none text-foreground">
                  {sale.customerName || "-"}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  Nickname
                </p>
                <p className="truncate text-2xl font-bold leading-none text-slate-500">
                  {sale.customerNickname || "-"}
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-slate-50 p-4 md:w-44 md:border-l md:border-t-0">
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  Codigo de barras
                </p>
                <BarcodePreview value={sale.barcodeValue} />
              </div>

              <div>
                <p className="mb-1 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  QR code
                </p>
                <QRCodePreview value={sale.qrcodeValue} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
