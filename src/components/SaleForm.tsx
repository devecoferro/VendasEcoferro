import { SaleData } from "@/types/sales";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SaleFormProps {
  sale: SaleData;
  onChange: (updated: SaleData) => void;
}

export function SaleForm({ sale, onChange }: SaleFormProps) {
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

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {fields.map(({ key, label, type }) => (
        <div key={key} className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {label}
          </Label>
          <Input
            type={type || "text"}
            value={sale[key]?.toString() ?? ""}
            onChange={(e) =>
              update(key, type === "number" ? Number(e.target.value) : e.target.value)
            }
            className="bg-secondary/50 border-border focus:border-primary"
          />
        </div>
      ))}
    </div>
  );
}
