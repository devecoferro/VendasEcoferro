import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { mockDocuments, mockSales } from "@/data/mockData";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, FileText, Download, RefreshCw, Filter } from "lucide-react";
import { SaleCardPreview } from "@/components/SaleCardPreview";
import { toast } from "sonner";

const statusMap = {
  processing: { label: "Processando", variant: "outline" as const },
  review: { label: "Em Revisão", variant: "secondary" as const },
  completed: { label: "Concluído", variant: "default" as const },
  failed: { label: "Falhou", variant: "destructive" as const },
};

export default function HistoryPage() {
  const [search, setSearch] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);

  const filtered = mockDocuments.filter(
    (d) =>
      d.fileName.toLowerCase().includes(search.toLowerCase()) ||
      d.sales.some(
        (s) =>
          s.saleNumber.includes(search) ||
          s.customerName.toLowerCase().includes(search.toLowerCase()) ||
          s.sku.toLowerCase().includes(search.toLowerCase())
      )
  );

  const selectedSales = selectedDoc
    ? mockDocuments.find((d) => d.id === selectedDoc)?.sales ?? []
    : [];

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Histórico</h1>
          <p className="text-sm text-muted-foreground mt-1">Documentos processados e etiquetas geradas</p>
        </div>

        {/* Search */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por arquivo, nº da venda, SKU ou cliente..."
              className="pl-10 bg-card border-border"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="outline" size="icon">
            <Filter className="w-4 h-4" />
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Document list */}
          <div className="lg:col-span-1 space-y-2">
            {filtered.map((doc) => (
              <div
                key={doc.id}
                onClick={() => setSelectedDoc(doc.id)}
                className={`glass-card p-4 cursor-pointer transition-all ${
                  selectedDoc === doc.id ? "ring-2 ring-primary" : "hover:bg-secondary/50"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <p className="text-sm font-medium text-foreground truncate">{doc.fileName}</p>
                  </div>
                  <Badge variant={statusMap[doc.processingStatus].variant} className="flex-shrink-0 text-[10px]">
                    {statusMap[doc.processingStatus].label}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                  <span>{new Date(doc.createdAt).toLocaleDateString("pt-BR")}</span>
                  <span>{doc.sales.length} venda(s)</span>
                  <span className="uppercase font-mono">{doc.fileType}</span>
                </div>
                <div className="flex gap-2 mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={(e) => {
                      e.stopPropagation();
                      toast.info("Re-gerando PDF...");
                    }}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" />
                    Regerar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7"
                    onClick={(e) => {
                      e.stopPropagation();
                      toast.success("Download iniciado!");
                    }}
                  >
                    <Download className="w-3 h-3 mr-1" />
                    Baixar
                  </Button>
                </div>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Nenhum documento encontrado
              </div>
            )}
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-2">
            {selectedDoc && selectedSales.length > 0 ? (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-foreground">
                  Vendas do Documento
                </h2>
                {selectedSales.map((sale) => (
                  <SaleCardPreview key={sale.id} sale={sale} />
                ))}
              </div>
            ) : (
              <div className="glass-card p-16 text-center">
                <FileText className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  Selecione um documento para visualizar as vendas
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
