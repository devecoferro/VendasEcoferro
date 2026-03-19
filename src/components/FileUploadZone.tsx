import { useCallback, useState } from "react";
import { Upload, FileText, Image, X, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FileUploadZoneProps {
  onFilesSelected: (files: File[]) => void;
}

export function FileUploadZone({ onFilesSelected }: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);

  const acceptedTypes = ["application/pdf", "image/png", "image/jpg", "image/jpeg"];

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFiles = Array.from(e.dataTransfer.files).filter((f) =>
        acceptedTypes.includes(f.type)
      );
      if (droppedFiles.length > 0) {
        setFiles((prev) => [...prev, ...droppedFiles]);
      }
    },
    []
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selected = Array.from(e.target.files).filter((f) =>
        acceptedTypes.includes(f.type)
      );
      setFiles((prev) => [...prev, ...selected]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleProcess = () => {
    onFilesSelected(files);
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-xl p-12 text-center transition-all duration-300 cursor-pointer",
          isDragging
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-border hover:border-primary/50 hover:bg-secondary/50"
        )}
        onClick={() => document.getElementById("file-input")?.click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          multiple
          onChange={handleFileInput}
          className="hidden"
        />
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center">
            <Upload className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <p className="text-base font-semibold text-foreground">
              Arraste e solte seus arquivos aqui
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              ou clique para selecionar · PDF, PNG, JPG, JPEG · Máx. 20MB
            </p>
          </div>
        </div>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            {files.length} arquivo(s) selecionado(s)
          </p>
          {files.map((file, i) => (
            <div
              key={i}
              className="flex items-center gap-3 glass-card p-3 animate-fade-in"
            >
              {file.type === "application/pdf" ? (
                <FileText className="w-5 h-5 text-destructive flex-shrink-0" />
              ) : (
                <Image className="w-5 h-5 text-primary flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(0)} KB
                </p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeFile(i);
                }}
                className="text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <Button onClick={handleProcess} className="w-full gradient-primary text-primary-foreground mt-2">
            <CheckCircle className="w-4 h-4 mr-2" />
            Processar Arquivo(s)
          </Button>
        </div>
      )}
    </div>
  );
}
