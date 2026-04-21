/**
 * Diálogo de seleção de colunas antes de gerar o Relatório de Estoque.
 *
 * Permite que o operador escolha quais colunas OPCIONAIS vão aparecer no
 * PDF. # e "Produto / SKU" são sempre incluídas (identificação mínima).
 *
 * Usado pela StockPage — abre ao clicar em "Imprimir Lista".
 */
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Image as ImageIcon,
  MapPin,
  Hash,
  TrendingUp,
  Clock,
  DollarSign,
  Circle,
  Printer,
  Loader2,
} from "lucide-react";
import {
  DEFAULT_STOCK_REPORT_COLUMNS,
  type StockReportColumnOptions,
} from "@/services/stockReportService";

const COLUMN_INFO: Array<{
  key: keyof StockReportColumnOptions;
  label: string;
  description: string;
  icon: typeof ImageIcon;
}> = [
  {
    key: "image",
    label: "Imagem do produto",
    description: "Thumbnail 18x18mm pra facilitar identificação visual",
    icon: ImageIcon,
  },
  {
    key: "location",
    label: "Localização",
    description: "Corredor · Estante · Nível (pra separação no estoque)",
    icon: MapPin,
  },
  {
    key: "available",
    label: "Disponível",
    description: "Quantidade em estoque (destaque vermelho se zerado)",
    icon: Hash,
  },
  {
    key: "sales",
    label: "Vendas no período",
    description: "Unidades vendidas + número de pedidos no período filtrado",
    icon: TrendingUp,
  },
  {
    key: "lastSale",
    label: "Última venda",
    description: "Há quantos dias foi a última venda",
    icon: Clock,
  },
  {
    key: "price",
    label: "Preço",
    description: "Preço unitário do anúncio",
    icon: DollarSign,
  },
  {
    key: "status",
    label: "Status",
    description: "Badge colorido: Ativo / Pausado / Fechado",
    icon: Circle,
  },
];

interface StockReportColumnsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (columns: StockReportColumnOptions) => void | Promise<void>;
  generating?: boolean;
  totalItems?: number;
}

export function StockReportColumnsDialog({
  open,
  onOpenChange,
  onConfirm,
  generating = false,
  totalItems = 0,
}: StockReportColumnsDialogProps) {
  const [columns, setColumns] = useState<StockReportColumnOptions>(
    DEFAULT_STOCK_REPORT_COLUMNS
  );

  const toggle = (key: keyof StockReportColumnOptions) => {
    setColumns((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const activeCount = Object.values(columns).filter(Boolean).length;
  const alwaysOnCount = 2; // # + Produto

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Printer className="h-5 w-5 text-[#3483fa]" />
            Configurar Relatório de Estoque
          </DialogTitle>
          <DialogDescription>
            Escolha quais colunas incluir no PDF. Desmarcar colunas deixa as
            restantes com mais espaço.
          </DialogDescription>
        </DialogHeader>

        <div className="my-4 space-y-2">
          {/* Colunas sempre ativas (fixas) */}
          <div className="rounded-lg border border-[#e6e6e6] bg-[#f9fafb] p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#666]">
              Sempre incluídas
            </p>
            <div className="flex flex-wrap gap-3 text-[13px] text-[#333]">
              <span className="inline-flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 text-[#3483fa]" />#
              </span>
              <span className="inline-flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5 text-[#3483fa]" />
                Produto / SKU / ID
              </span>
            </div>
          </div>

          {/* Colunas opcionais */}
          <div className="rounded-lg border border-[#e6e6e6] bg-white p-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#666]">
              Opcionais — clique pra marcar/desmarcar
            </p>
            <div className="space-y-1">
              {COLUMN_INFO.map((info) => {
                const Icon = info.icon;
                const checked = Boolean(columns[info.key]);
                return (
                  <Label
                    key={info.key}
                    htmlFor={`col-${info.key}`}
                    className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 transition hover:bg-[#f3f4f6]"
                  >
                    <Checkbox
                      id={`col-${info.key}`}
                      checked={checked}
                      onCheckedChange={() => toggle(info.key)}
                      className="mt-0.5"
                    />
                    <Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#3483fa]" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium text-[#333]">
                        {info.label}
                      </div>
                      <div className="text-[11px] text-[#666]">
                        {info.description}
                      </div>
                    </div>
                  </Label>
                );
              })}
            </div>
          </div>

          {/* Resumo */}
          <div className="rounded-lg bg-blue-50 p-3 text-[12px] text-blue-900">
            <p>
              📄 <strong>{totalItems}</strong> produto{totalItems === 1 ? "" : "s"} ·
              {" "}<strong>{activeCount + alwaysOnCount}</strong> coluna
              {activeCount + alwaysOnCount === 1 ? "" : "s"} no total
              {" "}<span className="text-blue-700">
                ({alwaysOnCount} fixas + {activeCount} opcionais)
              </span>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={generating}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => {
              void onConfirm(columns);
            }}
            disabled={generating || totalItems === 0}
            className="bg-[#3483fa] text-white hover:bg-[#2968c8]"
          >
            {generating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Gerando PDF…
              </>
            ) : (
              <>
                <Printer className="mr-2 h-4 w-4" />
                Gerar relatório
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
