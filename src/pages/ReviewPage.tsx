import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { SaleCardPreview } from "@/components/SaleCardPreview";
import { useExtraction } from "@/contexts/ExtractionContext";
import { type SaleData } from "@/types/sales";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Info,
  Loader2,
  ShoppingCart,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { exportBatchPdf, exportSalePdf } from "@/services/pdfExportService";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ReviewField {
  label: string;
  value: string;
}

function buildReviewFields(sale: SaleData): ReviewField[] {
  return [
    { label: "SKU", value: sale.sku || "-" },
    { label: "Nome da peca", value: sale.productName || "-" },
    { label: "Nome do cliente", value: sale.customerName || "-" },
    { label: "Nickname", value: sale.customerNickname || "-" },
    { label: "Numero da venda", value: sale.saleNumber || "-" },
    {
      label: "Data e hora",
      value: `${sale.saleDate || "-"} ${sale.saleTime || ""}`.trim() || "-",
    },
    { label: "Quantidade", value: String(sale.quantity || 1) },
    { label: "QR venda", value: sale.saleQrcodeValue || "-" },
    { label: "QR peca", value: sale.qrcodeValue || "-" },
  ];
}

function getConfidenceVariant(level: string) {
  switch (level) {
    case "high":
      return "default" as const;
    case "medium":
      return "secondary" as const;
    case "low":
      return "outline" as const;
    case "empty":
      return "destructive" as const;
    default:
      return "secondary" as const;
  }
}

export default function ReviewPage() {
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const { results, updateSaleObservation, clearResults } = useExtraction();

  const sales = useMemo<SaleData[]>(() => results.map((result) => result.sale), [results]);

  useEffect(() => {
    setCurrentIndex(0);
  }, [sales]);

  const currentSale = sales[currentIndex];
  const currentResult = results[currentIndex] ?? null;

  const handleExport = async () => {
    if (!currentSale) return;

    setExporting(true);
    try {
      await exportSalePdf(currentSale);
      toast.success("PDF gerado com sucesso!", {
        description: `Etiqueta da venda ${currentSale.saleNumber || "(sem numero)"} baixada.`,
      });
    } catch {
      toast.error("Erro ao gerar PDF");
    } finally {
      setExporting(false);
    }
  };

  const handleBatchExport = async () => {
    setExporting(true);
    try {
      await exportBatchPdf(sales);
      toast.success(`${sales.length} etiquetas exportadas em lote!`);
    } catch {
      toast.error("Erro ao gerar PDF em lote");
    } finally {
      setExporting(false);
    }
  };

  const methodLabel =
    currentResult?.method === "mercado-livre"
      ? "Mercado Livre API"
      : currentResult?.method === "pdf-text"
        ? "Parser PDF"
        : "OCR";

  const emptyFields = currentResult
    ? Object.entries(currentResult.confidence).filter(
        ([, value]) => value === "empty" || value === "low"
      )
    : [];

  const reviewFields = currentSale ? buildReviewFields(currentSale) : [];

  const handleObservationChange = (value: string) => {
    if (!currentSale) return;
    updateSaleObservation(currentSale.id, value.slice(0, 180));
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {sales.length === 0 ? (
          <>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Conferencia</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Nenhuma etiqueta foi enviada para conferencia nesta sessao.
              </p>
            </div>

            <div className="glass-card flex flex-col items-center gap-4 px-6 py-14 text-center">
              <ShoppingCart className="h-10 w-10 text-muted-foreground/40" />
              <div className="space-y-2">
                <p className="text-lg font-semibold text-foreground">
                  Nenhuma venda pronta para visualizar
                </p>
                <p className="max-w-xl text-sm text-muted-foreground">
                  Gere etiquetas pela tela EcoFerro ou processe um arquivo manual para
                  preencher esta conferencia com dados reais.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-3">
                <Button onClick={() => navigate("/mercado-livre")}>Ir para EcoFerro</Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-foreground">Conferencia</h1>
                  <Badge variant="secondary" className="text-xs">
                    {sales.length} venda{sales.length !== 1 ? "s" : ""} detectada
                    {sales.length !== 1 ? "s" : ""}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Revise os dados finais e visualize a etiqueta em tamanho real antes de
                  imprimir.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentIndex === 0}
                  onClick={() => setCurrentIndex((index) => index - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="px-2 text-sm font-mono text-muted-foreground">
                  {currentIndex + 1} / {sales.length}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={currentIndex === sales.length - 1}
                  onClick={() => setCurrentIndex((index) => index + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {currentResult && (
              <div className="glass-card space-y-3 p-4">
                <div className="flex items-center gap-2 text-sm">
                  <Info className="h-4 w-4 text-primary" />
                  <span className="font-medium text-foreground">
                    Metodo:
                    <Badge variant="secondary" className="ml-2">
                      {methodLabel}
                    </Badge>
                  </span>
                </div>

                {emptyFields.length > 0 && (
                  <div className="flex items-start gap-2 text-sm">
                    <AlertTriangle className="mt-0.5 h-4 w-4 text-warning" />
                    <div>
                      <p className="font-medium text-foreground">
                        {emptyFields.length} campo(s) precisam de atencao:
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {emptyFields.map(([field, level]) => (
                          <Badge
                            key={field}
                            variant={getConfidenceVariant(level)}
                            className="text-[10px]"
                          >
                            {field}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {currentSale && (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="glass-card p-5">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">
                        Dados da etiqueta
                      </h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Revise os dados finais e preencha a observacao que precisa sair na
                        etiqueta.
                      </p>
                    </div>
                    <Badge variant="outline">Observacao editavel</Badge>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {reviewFields.map((field) => (
                      <div
                        key={field.label}
                        className="rounded-2xl border border-border/60 bg-background/80 p-4"
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          {field.label}
                        </p>
                        <p className="mt-2 break-words text-sm font-semibold text-foreground">
                          {field.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 rounded-2xl border border-border/60 bg-background/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                          Observacao da etiqueta
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                          Use este campo para lembretes operacionais, como brinde,
                          conferencia extra ou orientacao de embalagem.
                        </p>
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        ate 180 caracteres
                      </Badge>
                    </div>
                    <Textarea
                      value={currentSale.labelObservation || ""}
                      onChange={(event) => handleObservationChange(event.target.value)}
                      placeholder="Ex.: Cliente comprou 2 itens, enviar brinde junto nesta etiqueta."
                      className="mt-4 min-h-[110px] resize-none rounded-2xl border-border/60 bg-background/90 text-sm"
                    />
                  </div>

                  {currentResult?.rawText && (
                    <details className="mt-5 rounded-2xl border border-border/60 bg-secondary/20 p-4">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                        Ver texto bruto extraido
                      </summary>
                      <pre className="mt-3 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-secondary/60 p-3 font-mono text-xs text-muted-foreground">
                        {currentResult.rawText}
                      </pre>
                    </details>
                  )}
                </div>

                <div className="space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">
                      Preview da etiqueta
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Use a visualizacao em tamanho real antes de imprimir.
                    </p>
                  </div>

                  <SaleCardPreview sale={currentSale} />

                  <div className="flex flex-wrap gap-3">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setPreviewOpen(true)}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      Tamanho real
                    </Button>
                    <Button
                      className="gradient-primary flex-1 text-primary-foreground"
                      onClick={handleExport}
                      disabled={exporting}
                    >
                      {exporting ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      Exportar PDF
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {sales.length > 1 && (
              <div className="glass-card flex flex-wrap items-center justify-between gap-4 p-5">
                <div>
                  <p className="text-sm font-semibold text-foreground">Exportacao em lote</p>
                  <p className="text-xs text-muted-foreground">
                    {sales.length} vendas prontas para exportar
                  </p>
                </div>
                <Button
                  className="gradient-accent text-accent-foreground"
                  onClick={handleBatchExport}
                  disabled={exporting}
                >
                  {exporting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle className="mr-2 h-4 w-4" />
                  )}
                  Exportar Todas ({sales.length})
                </Button>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => {
                  clearResults();
                  toast.success("Conferencia limpa.");
                }}
              >
                Limpar conferencia
              </Button>
            </div>

            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
              <DialogContent className="max-h-[96vh] w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] overflow-auto border-slate-200 bg-slate-100 p-4 sm:p-6">
                <DialogHeader>
                  <DialogTitle>Etiqueta em tamanho real</DialogTitle>
                  <DialogDescription>
                    Visualizacao em folha A4 com a etiqueta no tamanho de impressao.
                  </DialogDescription>
                </DialogHeader>

                {currentSale && (
                  <div className="overflow-auto rounded-[28px] bg-slate-200/80 p-3 sm:p-6">
                    <div
                      className="mx-auto rounded-[1.5rem] bg-white p-[8mm] shadow-[0_24px_80px_rgba(15,23,42,0.15)]"
                      style={{
                        width: "210mm",
                        minHeight: "297mm",
                      }}
                    >
                      <SaleCardPreview sale={currentSale} mode="print" />
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </AppLayout>
  );
}
