import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";
import { type SaleData } from "@/types/sales";

interface SaleCardPreviewProps {
  sale: SaleData;
  // "default": wrapper com glass-card + padding (HistoryPage, ReviewPage).
  // "print": dimensoes fixas em mm para impressao.
  // "embedded": sem wrapper externo — use quando o preview ja esta dentro
  // de outro card (ex: MercadoLivrePage) pra evitar padding/borda duplicados.
  mode?: "default" | "print" | "embedded";
  // Oculta o bloco da thumbnail do produto no card da etiqueta. Usado na
  // ConferenciaVendaPage, onde a foto grande do anuncio ja e' exibida
  // lado-a-lado na coluna esquerda — a thumbnail seria redundante.
  hideProductImage?: boolean;
}

const ECOFERRO_LOGO_URL = "/ecoferro-logo.png";

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
  note,
  labelPosition = "bottom",
  framed = true,
  qrPixelWidth,
  imageClassName,
  labelClassName,
  valueClassName,
  noteClassName,
  containerClassName,
}: {
  value: string;
  label: string;
  compact?: boolean;
  note?: string;
  labelPosition?: "top" | "bottom";
  framed?: boolean;
  qrPixelWidth?: number;
  imageClassName?: string;
  labelClassName?: string;
  valueClassName?: string;
  noteClassName?: string;
  containerClassName?: string;
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
      width: qrPixelWidth ?? (compact ? 120 : 220),
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
  }, [compact, qrPixelWidth, value]);

  if (!src) {
    return <CodePlaceholder label={value ? "Gerando QR..." : "Sem QR"} compact={compact} />;
  }

  return (
    <div
      className={cn(
        framed && "rounded-md border border-border bg-white p-2 shadow-sm",
        containerClassName
      )}
    >
      {labelPosition === "top" && (
        <p
          className={cn(
            "mb-2 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground",
            labelClassName
          )}
        >
          {label}
        </p>
      )}
      <img
        src={src}
        alt={`${label} ${value}`}
        className={cn(
          "mx-auto object-contain",
          compact ? "h-16 w-16" : "h-28 w-28",
          imageClassName
        )}
      />
      {labelPosition === "bottom" && (
        <p
          className={cn(
            "mt-1 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground",
            labelClassName
          )}
        >
          {label}
        </p>
      )}
      <p
        className={cn(
          "mt-1 text-center font-mono text-[10px] text-muted-foreground",
          valueClassName
        )}
      >
        {value}
      </p>
      {note && (
        <p
          className={cn(
            "mt-1 text-center text-[11px] font-semibold text-muted-foreground",
            noteClassName
          )}
        >
          {note}
        </p>
      )}
    </div>
  );
}

function ProductImageBlock({
  src,
  alt,
  compact,
}: {
  src?: string;
  alt: string;
  compact: boolean;
}) {
  return (
    <div
      className={cn(
        "flex w-full items-center justify-center overflow-hidden bg-transparent",
        compact ? "h-[116px]" : "h-[170px]"
      )}
    >
      {src ? (
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-contain"
          onError={(event) => {
            (event.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <span className="px-4 text-center text-xs text-muted-foreground">Sem imagem</span>
      )}
    </div>
  );
}

function ObservationBlock({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-[#f4d28d] bg-[#fff7e6] px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#a16207]">
        Observacao
      </p>
      <p className="mt-1 text-[13px] font-medium leading-[1.35] text-[#7c4a03]">{text}</p>
    </div>
  );
}

export function SaleCardPreview({
  sale,
  mode = "default",
  hideProductImage = false,
}: SaleCardPreviewProps) {
  const productImageSrc = sale.productImageData || sale.productImageUrl;
  const isPrintMode = mode === "print";
  const groupedItems = sale.groupedItems || [];
  const labelObservation = sale.labelObservation?.trim() || "";
  const hasGroupedItems = groupedItems.length > 1;
  const previewItems = hasGroupedItems
    ? groupedItems
    : [
        {
          itemTitle: sale.productName,
          sku: sale.sku,
          quantity: sale.quantity,
          amount: sale.amount,
          productImageUrl: productImageSrc,
          productImageData: sale.productImageData,
          variation: sale.variation,
          locationCorridor: sale.locationCorridor,
          locationShelf: sale.locationShelf,
          locationLevel: sale.locationLevel,
          locationNotes: sale.locationNotes,
        },
      ];

  return (
    <div className={cn(mode === "default" && "glass-card animate-fade-in p-4")}>
      <div
        className={cn(
          "overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm sm:rounded-2xl",
          isPrintMode && "mx-auto"
        )}
        style={
          isPrintMode
            ? {
                width: "194mm",
                minHeight: "53mm",
              }
            : undefined
        }
      >
        <div className="divide-y divide-slate-200">
          {previewItems.map((item, index) => {
            const rowImageSrc = item.productImageData || item.productImageUrl || productImageSrc;
            const shouldShowObservation = index === 0 && Boolean(labelObservation);

            return (
              <div
                key={`${item.sku || item.itemTitle}-${index}`}
                className="flex flex-col md:flex-row"
              >
                {!hideProductImage && (
                  <div className="p-3 sm:p-4 md:w-[24%] md:pr-2">
                    <ProductImageBlock
                      src={rowImageSrc}
                      alt={item.itemTitle || sale.productName || "Produto"}
                      compact={hasGroupedItems}
                    />
                  </div>
                )}

                <div
                  className={cn(
                    "flex-1 p-3 sm:p-4 md:pr-4",
                    hideProductImage ? "md:pl-4" : "md:pl-2"
                  )}
                >
                  <div className="space-y-2.5">
                    <p className="text-[18px] font-bold leading-none text-slate-800">
                      SKU: {item.sku || "-"}
                    </p>

                    <div>
                      <p className="text-[21px] font-bold leading-[1.15] text-slate-900">
                        {item.itemTitle || sale.productName || "Produto sem nome"}
                      </p>
                    </div>

                    <div>
                      <p className="truncate text-[18px] font-bold leading-none text-slate-900">
                        {sale.customerName || "-"}
                      </p>
                    </div>

                    <div>
                      <p className="truncate text-[16px] font-bold leading-none text-slate-500">
                        {sale.customerNickname || "-"}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 text-slate-500">
                      <p className="text-[20px] font-bold leading-none text-slate-700">
                        #{sale.saleNumber || "-"}
                      </p>
                      <p className="text-[18px] font-semibold">
                        {sale.saleDate || "-"} {sale.saleTime || ""}
                      </p>
                    </div>

                    {shouldShowObservation && <ObservationBlock text={labelObservation} />}

                    <div className="flex flex-wrap items-end gap-6 pt-2">
                      <div className="w-fit shrink-0">
                        <QRCodePreview
                          value={sale.saleQrcodeValue}
                          label="QR VENDA"
                          compact
                          framed={false}
                          qrPixelWidth={176}
                          imageClassName="h-[92px] w-[92px]"
                          labelClassName="mt-2 text-[11px] tracking-[0.2em] text-slate-500"
                          valueClassName="hidden"
                          containerClassName="p-0"
                        />
                      </div>

                      <div className="flex min-h-[104px] items-end justify-center pb-1 md:justify-start">
                        <img
                          src={ECOFERRO_LOGO_URL}
                          alt="Logo EcoFerro"
                          className="h-[68px] w-[96px] object-contain"
                        />
                      </div>

                      {/* Bloco CORREDOR / ESTANTE / NIVEL / LOCAL (igual ao modelo da etiqueta interna Ecoferro) */}
                      <div className="flex flex-col justify-center min-h-[104px] text-slate-800 font-bold">
                        <p className="text-[14px] leading-tight">
                          CORREDOR : {item.locationCorridor || sale.locationCorridor || ""}
                        </p>
                        <p className="text-[14px] leading-tight mt-1">
                          ESTANTE : {item.locationShelf || sale.locationShelf || ""}
                        </p>
                        <p className="text-[14px] leading-tight mt-1">
                          NIVEL : {item.locationLevel || sale.locationLevel || ""}
                        </p>
                        <p className="text-[14px] leading-tight mt-1">
                          LOCAL : {item.locationNotes || sale.locationNotes || ""}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-slate-200 p-3 sm:p-4 md:w-[18%] md:border-l md:border-t-0">
                  <QRCodePreview
                    value={item.sku || ""}
                    label="QR PECA"
                    labelPosition="top"
                    framed={false}
                    note={`Qtd: ${item.quantity || 1}`}
                    qrPixelWidth={220}
                    imageClassName="h-[122px] w-[122px]"
                    labelClassName="text-[14px] font-medium tracking-[0.2em] text-slate-400"
                    valueClassName="mt-2 text-[18px] font-medium text-slate-500"
                    noteClassName="mt-3 text-[20px] font-bold text-slate-700"
                    containerClassName="flex h-full flex-col items-center justify-center p-0"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
