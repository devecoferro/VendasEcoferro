import { SaleData } from "@/types/sales";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface SaleFormProps {
  sale: SaleData;
  onChange: (updated: SaleData) => void;
  confidence?: Record<string, "high" | "medium" | "low" | "empty">;
}

export function SaleForm({ sale, onChange, confidence }: SaleFormProps) {
  const update = (field: keyof SaleData, value: string | number) => {
    onChange({ ...sale, [field]: value });
  };

  const fields: { key: keyof SaleData; label: string; type?: string }[] = [
    { key: "saleNumber", label: "Nº da Venda" },
    { key: "saleDate", label: "Data", type: "date" },
    { key: "saleTime", label: "Hora", type: "time" },
    { key: "customerName", label: "Nome do Cliente" },
    { key: "customerNickname", label: "Nickname" },
    { key: "productName", label: "Produto" },
    { key: "sku", label: "SKU" },
    { key: "quantity", label: "Quantidade", type: "number" },
    { key: "amount", label: "Valor (R$)", type: "number" },
    { key: "barcodeValue", label: "Código de Barras" },
    { key: "qrcodeValue", label: "QR Code URL" },
    { key: "productImageUrl", label: "URL da Imagem" },
  ];

  const getBorderClass = (key: string) => {
    if (!confidence) return "";
    const level = confidence[key];
    if (level === "empty") return "border-destructive bg-destructive/5";
    if (level === "low") return "border-warning bg-warning/5";
    return "";
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {fields.map(({ key, label, type }) => (
        <div key={key} className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {label}
            {confidence?.[key] === "empty" && (
              <span className="text-destructive ml-1">⚠ não identificado</span>
            )}
            {confidence?.[key] === "low" && (
              <span className="text-warning ml-1">⚠ baixa confiança</span>
            )}
          </Label>
          <Input
            type={type || "text"}
            value={sale[key]?.toString() ?? ""}
            onChange={(e) =>
              update(key, type === "number" ? Number(e.target.value) : e.target.value)
            }
            className={cn("bg-secondary/50 border-border focus:border-primary", getBorderClass(key))}
          />
        </div>
      ))}
    </div>
  );
}
