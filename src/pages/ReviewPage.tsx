import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { SaleForm } from "@/components/SaleForm";
import { SaleCardPreview } from "@/components/SaleCardPreview";
import { useExtraction } from "@/contexts/ExtractionContext";
import { mockSales } from "@/data/mockData";
import { SaleData } from "@/types/sales";
import { Button } from "@/components/ui/button";
import { Eye, Download, ChevronLeft, ChevronRight, CheckCircle, AlertTriangle, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { exportSalePdf, exportBatchPdf } from "@/services/pdfExportService";

export default function ReviewPage() {
  const { results } = useExtraction();

  // Use extracted data if available, otherwise fallback to mock
  const hasRealData = results.length > 0;
  const initialSales = hasRealData ? results.map((r) => r.sale) : [...mockSales];

  const [sales, setSales] = useState<SaleData[]>(initialSales);
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentSale = sales[currentIndex];
  const currentResult = hasRealData ? results[currentIndex] : null;

  const updateSale = (updated: SaleData) => {
    setSales((prev) => prev.map((s, i) => (i === currentIndex ? updated : s)));
  };

  const handleExport = () => {
    toast.success("PDF gerado com sucesso!", {
      description: `Etiqueta para venda ${currentSale.saleNumber || "(sem número)"} exportada.`,
    });
  };

  const confidenceColor = (level: string) => {
    switch (level) {
      case "high": return "default" as const;
      case "medium": return "secondary" as const;
      case "low": return "outline" as const;
      case "empty": return "destructive" as const;
      default: return "secondary" as const;
    }
  };

  const emptyFields = currentResult
    ? Object.entries(currentResult.confidence).filter(([, v]) => v === "empty" || v === "low")
    : [];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Conferência</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {hasRealData
                ? "Dados extraídos do arquivo enviado — revise antes de exportar"
                : "Revise e edite os dados antes de gerar o PDF"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={currentIndex === 0} onClick={() => setCurrentIndex((i) => i - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-mono text-muted-foreground px-2">
              {currentIndex + 1} / {sales.length}
            </span>
            <Button variant="outline" size="sm" disabled={currentIndex === sales.length - 1} onClick={() => setCurrentIndex((i) => i + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Extraction info banner */}
        {currentResult && (
          <div className="glass-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Info className="w-4 h-4 text-primary" />
              <span className="font-medium text-foreground">
                Método: <Badge variant="secondary" className="ml-1">{currentResult.method === "pdf-text" ? "Parser PDF" : "OCR"}</Badge>
              </span>
            </div>

            {emptyFields.length > 0 && (
              <div className="flex items-start gap-2 text-sm">
                <AlertTriangle className="w-4 h-4 text-warning mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">
                    {emptyFields.length} campo(s) precisam de revisão:
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {emptyFields.map(([field, level]) => (
                      <Badge key={field} variant={confidenceColor(level)} className="text-[10px]">
                        {field}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Form */}
          <div className="glass-card p-5 space-y-5">
            <h2 className="text-sm font-semibold text-foreground">Dados Extraídos</h2>
            <SaleForm
              sale={currentSale}
              onChange={updateSale}
              confidence={currentResult?.confidence}
            />
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

            {/* Raw text debug */}
            {currentResult?.rawText && (
              <details className="glass-card p-4">
                <summary className="text-xs font-medium text-muted-foreground cursor-pointer">
                  Ver texto bruto extraído
                </summary>
                <pre className="mt-3 text-xs text-muted-foreground whitespace-pre-wrap max-h-48 overflow-y-auto font-mono bg-secondary/50 p-3 rounded-lg">
                  {currentResult.rawText}
                </pre>
              </details>
            )}
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
