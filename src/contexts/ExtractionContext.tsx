import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { type ProcessingResult } from "@/services/fileProcessor";

interface ExtractionContextType {
  results: ProcessingResult[];
  setResults: Dispatch<SetStateAction<ProcessingResult[]>>;
  updateSaleObservation: (saleId: string, observation: string) => void;
  clearResults: () => void;
}

const ExtractionContext = createContext<ExtractionContextType | null>(null);
const EXTRACTION_STORAGE_KEY = "ecoferro.extraction.results";

function readStoredResults(): ProcessingResult[] {
  if (typeof window === "undefined") return [];

  try {
    const rawValue = window.sessionStorage.getItem(EXTRACTION_STORAGE_KEY);
    if (!rawValue) return [];
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? (parsed as ProcessingResult[]) : [];
  } catch {
    return [];
  }
}

export function ExtractionProvider({ children }: { children: ReactNode }) {
  const [results, setResults] = useState<ProcessingResult[]>(() => readStoredResults());

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      if (results.length === 0) {
        window.sessionStorage.removeItem(EXTRACTION_STORAGE_KEY);
        return;
      }
      // F-M4: try/catch envolve setItem pra capturar QuotaExceededError
      // (Safari privado + quota cheia). Antes, quebrava o fluxo do app.
      window.sessionStorage.setItem(EXTRACTION_STORAGE_KEY, JSON.stringify(results));
    } catch (error) {
      console.warn("Falha ao persistir extração (quota exceeded?):", error);
    }
  }, [results]);

  const value = useMemo<ExtractionContextType>(
    () => ({
      results,
      setResults,
      updateSaleObservation: (saleId, observation) =>
        setResults((current) =>
          current.map((result) =>
            result.sale.id === saleId
              ? {
                  ...result,
                  sale: {
                    ...result.sale,
                    labelObservation: observation,
                  },
                }
              : result
          )
        ),
      clearResults: () => setResults([]),
    }),
    [results]
  );

  return (
    <ExtractionContext.Provider value={value}>{children}</ExtractionContext.Provider>
  );
}

export function useExtraction() {
  const ctx = useContext(ExtractionContext);
  if (!ctx) throw new Error("useExtraction must be used inside ExtractionProvider");
  return ctx;
}
