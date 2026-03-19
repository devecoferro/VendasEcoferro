import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { SaleForm } from "@/components/SaleForm";
import { SaleCardPreview } from "@/components/SaleCardPreview";
import { mockSales } from "@/data/mockData";
import { SaleData } from "@/types/sales";
import { Button } from "@/components/ui/button";
import { Eye, Download, ChevronLeft, ChevronRight, CheckCircle } from "lucide-react";
import { toast } from "sonner";

export default function ReviewPage() {
  const [sales, setSales] = useState<SaleData[]>([...mockSales]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentSale = sales[currentIndex];

  const updateSale = (updated: SaleData) => {
    setSales((prev) => prev.map((s, i) => (i === currentIndex ? updated : s)));
  };

  const handleExport = () => {
    toast.success("PDF gerado com sucesso!", {
      description: `Etiqueta para venda ${currentSale.saleNumber} exportada.`,
    });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Conferência</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Revise e edite os dados extraídos antes de gerar o PDF
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((i) => i - 1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-mono text-muted-foreground px-2">
              {currentIndex + 1} / {sales.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentIndex === sales.length - 1}
              onClick={() => setCurrentIndex((i) => i + 1)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Form */}
          <div className="glass-card p-5 space-y-5">
            <h2 className="text-sm font-semibold text-foreground">Dados Extraídos</h2>
            <SaleForm sale={currentSale} onChange={updateSale} />
          </div>

          {/* Preview */}
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Preview da Etiqueta</h2>
            <SaleCardPreview sale={currentSale} />
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => toast.info("Preview em tela cheia em breve!")}>
                <Eye className="w-4 h-4 mr-2" />
                Preview PDF
              </Button>
              <Button className="flex-1 gradient-primary text-primary-foreground" onClick={handleExport}>
                <Download className="w-4 h-4 mr-2" />
                Exportar PDF
              </Button>
            </div>
          </div>
        </div>

        {/* Batch actions */}
        {sales.length > 1 && (
          <div className="glass-card p-5 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">Exportação em Lote</p>
              <p className="text-xs text-muted-foreground">{sales.length} vendas prontas para exportar</p>
            </div>
            <Button
              className="gradient-accent text-accent-foreground"
              onClick={() => toast.success(`${sales.length} etiquetas exportadas em lote!`)}
            >
              <CheckCircle className="w-4 h-4 mr-2" />
              Exportar Todas ({sales.length})
            </Button>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
