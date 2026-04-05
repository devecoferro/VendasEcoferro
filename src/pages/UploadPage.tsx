import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { FileUploadZone } from "@/components/FileUploadZone";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { processFiles } from "@/services/fileProcessor";
import { useExtraction } from "@/contexts/ExtractionContext";
import { toast } from "sonner";

export default function UploadPage() {
  const navigate = useNavigate();
  const { setResults } = useExtraction();
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);

  const handleFiles = async (files: File[]) => {
    setProcessing(true);
    setStatus("Iniciando processamento...");
    setProgress(0);

    try {
      const results = await processFiles(files, (s, p) => {
        setStatus(s);
        setProgress(Math.round(p));
      });

      setResults(results);
      toast.success(`${results.length} venda(s) extraída(s) com sucesso!`);
      navigate("/review");
    } catch (err: unknown) {
      console.error("Processing error:", err);
      toast.error("Erro ao processar arquivo", {
        description: err instanceof Error ? err.message : "Tente novamente com outro arquivo",
      });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-8 max-w-2xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Importação</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Envie um PDF ou imagem de venda para extrair os dados automaticamente
          </p>
        </div>

        {processing ? (
          <div className="glass-card p-16 flex flex-col items-center gap-4 animate-fade-in">
            <Loader2 className="w-10 h-10 text-primary animate-spin" />
            <div className="text-center">
              <p className="text-base font-semibold text-foreground">{status}</p>
              <p className="text-sm text-muted-foreground mt-1">
                Extraindo dados da venda via parser e OCR
              </p>
            </div>
            <div className="w-64 h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full gradient-primary rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground font-mono">{progress}%</p>
          </div>
        ) : (
          <FileUploadZone onFilesSelected={handleFiles} />
        )}

        {/* Supported formats */}
        <div className="glass-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Formatos Suportados</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { ext: "PDF", desc: "Documentos de venda" },
              { ext: "PNG", desc: "Screenshots" },
              { ext: "JPG", desc: "Fotos da tela" },
              { ext: "JPEG", desc: "Imagens da venda" },
            ].map((f) => (
              <div key={f.ext} className="text-center p-3 rounded-lg bg-secondary/50">
                <p className="text-sm font-bold font-mono text-primary">.{f.ext}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
