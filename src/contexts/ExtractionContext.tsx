import { createContext, useContext, useState, ReactNode } from "react";
import { ProcessingResult } from "@/services/fileProcessor";

interface ExtractionContextType {
  results: ProcessingResult[];
  setResults: (results: ProcessingResult[]) => void;
}

const ExtractionContext = createContext<ExtractionContextType | null>(null);

export function ExtractionProvider({ children }: { children: ReactNode }) {
  const [results, setResults] = useState<ProcessingResult[]>([]);
  return (
    <ExtractionContext.Provider value={{ results, setResults }}>
      {children}
    </ExtractionContext.Provider>
  );
}

export function useExtraction() {
  const ctx = useContext(ExtractionContext);
  if (!ctx) throw new Error("useExtraction must be used inside ExtractionProvider");
  return ctx;
}
