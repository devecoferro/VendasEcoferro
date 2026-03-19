import { AppLayout } from "@/components/AppLayout";
import { StatsCard } from "@/components/StatsCard";
import { SaleCardPreview } from "@/components/SaleCardPreview";
import { mockStats, mockSales, mockDocuments } from "@/data/mockData";
import { FileText, Package, CheckCircle, TrendingUp, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";

const statusMap = {
  processing: { label: "Processando", variant: "outline" as const },
  review: { label: "Em Revisão", variant: "secondary" as const },
  completed: { label: "Concluído", variant: "default" as const },
  failed: { label: "Falhou", variant: "destructive" as const },
};

export default function DashboardPage() {
  const navigate = useNavigate();

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Visão geral do sistema de geração de etiquetas</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatsCard title="Documentos" value={mockStats.totalDocuments} icon={FileText} accentColor="primary" subtitle="Total processados" />
          <StatsCard title="PDFs Gerados" value={mockStats.totalPdfsGenerated} icon={Package} accentColor="accent" subtitle="Etiquetas exportadas" />
          <StatsCard title="Taxa de Sucesso" value={`${mockStats.successRate}%`} icon={CheckCircle} accentColor="success" subtitle="Extração automática" />
          <StatsCard title="Vendas" value={mockStats.totalSales} icon={TrendingUp} accentColor="warning" subtitle="Registros extraídos" />
        </div>

        {/* Recent activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent documents */}
          <div className="glass-card p-5">
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Clock className="w-4 h-4 text-muted-foreground" />
              Documentos Recentes
            </h2>
            <div className="space-y-3">
              {mockDocuments.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors cursor-pointer"
                  onClick={() => navigate("/history")}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{doc.fileName}</p>
                      <p className="text-xs text-muted-foreground">{new Date(doc.createdAt).toLocaleDateString("pt-BR")}</p>
                    </div>
                  </div>
                  <Badge variant={statusMap[doc.processingStatus].variant}>
                    {statusMap[doc.processingStatus].label}
                  </Badge>
                </div>
              ))}
            </div>
          </div>

          {/* Last sale card */}
          <div>
            <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Package className="w-4 h-4 text-muted-foreground" />
              Última Etiqueta Gerada
            </h2>
            <SaleCardPreview sale={mockSales[0]} />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
