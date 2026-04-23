// Dropdown do filtro de depósito no topo da página /mercado-livre.
// Extraído de MercadoLivrePage.tsx (sprint 2 P2) pra reduzir tamanho do
// arquivo principal e permitir reuso futuro (ex: StockPage).

import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { DepositOptionPresentation } from "@/services/mercadoLivreHelpers";

export interface DepositFilterMenuProps {
  selectedLabel: string;
  selectedValues: string[];
  onToggle: (value: string) => void;
  onReset: () => void;
  options: DepositOptionPresentation[];
}

export function DepositFilterMenu({
  selectedLabel,
  selectedValues,
  onToggle,
  onReset,
  options,
}: DepositFilterMenuProps) {
  const withoutDeposit = options.find((option) => option.kind === "without-deposit");
  const depositOptions = options.filter((option) => option.kind === "deposit");
  const allSelected = selectedValues.length === 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex w-full items-center justify-between gap-2 rounded-full border border-[#dfe3ea] bg-white px-5 py-3 text-[16px] font-medium text-[#333333] shadow-[0_1px_2px_rgba(0,0,0,0.05)] sm:w-auto sm:justify-start sm:text-[17px]"
        >
          <span>{selectedLabel}</span>
          <ChevronDown className="h-4 w-4 text-[#666666]" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] max-w-[calc(100vw-2rem)] rounded-2xl p-0">
        <div className="px-4 py-3">
          <button
            type="button"
            onClick={onReset}
            className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-[16px] ${
              allSelected
                ? "bg-[#f4f8ff] font-semibold text-[#3483fa]"
                : "text-[#333333] hover:bg-[#f8f8f8]"
            }`}
          >
            <span>Todas as vendas</span>
            {allSelected && <Check className="h-4 w-4" />}
          </button>

          {withoutDeposit && (
            <button
              type="button"
              onClick={() => onToggle(withoutDeposit.key)}
              className={`mt-1 flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-[16px] ${
                selectedValues.includes(withoutDeposit.key)
                  ? "bg-[#f4f8ff] font-semibold text-[#3483fa]"
                  : "text-[#333333] hover:bg-[#f8f8f8]"
              }`}
            >
              <span>{withoutDeposit.displayLabel}</span>
              {selectedValues.includes(withoutDeposit.key) && <Check className="h-4 w-4" />}
            </button>
          )}
        </div>

        {depositOptions.length > 0 && (
          <div className="border-t border-[#efefef] px-4 py-3">
            <div className="px-3 pb-2 text-[13px] font-medium text-[#8a8a8a]">Por depósito</div>
            <div className="space-y-1">
              {depositOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => onToggle(option.key)}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-[16px] ${
                    selectedValues.includes(option.key)
                      ? "bg-[#f4f8ff] font-semibold text-[#3483fa]"
                      : "text-[#333333] hover:bg-[#f8f8f8]"
                  }`}
                >
                  <span>{option.displayLabel}</span>
                  {selectedValues.includes(option.key) && <Check className="h-4 w-4" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
