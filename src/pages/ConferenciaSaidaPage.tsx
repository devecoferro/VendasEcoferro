/**
 * ConferenciaSaidaPage — Conferência física de saída de caixas.
 *
 * O operador lê o QR Code da venda (etiqueta interna EcoFerro).
 * O sistema identifica automaticamente se é Fantom ou Ecoferro
 * e vai contabilizando as caixas em tempo real.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Box,
  Building2,
  CheckCircle2,
  Package,
  QrCode,
  RotateCcw,
  Scan,
  TrendingUp,
  X,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { lookupOrder, type BoxLookupResult } from "@/services/boxReportService";

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ScannedItem {
  id: string; // sale_number ou pack_id
  result: BoxLookupResult;
  scanned_at: Date;
  duplicate: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function isEcoferro(company: string) {
  return company.toLowerCase().includes("ecoferro");
}

function companyColor(company: string) {
  return isEcoferro(company) ? "#2968c8" : "#7c3aed";
}

function companyBg(company: string) {
  return isEcoferro(company) ? "#f0f4ff" : "#f5f0ff";
}

// ─── Card de stat ─────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon,
  color = "#2968c8",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  color?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#e5e5e5] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[#888]">
          {label}
        </span>
        <span style={{ color }}>{icon}</span>
      </div>
      <p className="text-[24px] font-bold leading-none text-[#1a1a1a]">{value}</p>
      {sub && <p className="mt-1 text-[12px] text-[#888]">{sub}</p>}
    </div>
  );
}

// ─── Item escaneado ───────────────────────────────────────────────────────────

function ScannedCard({
  item,
  index,
  onRemove,
}: {
  item: ScannedItem;
  index: number;
  onRemove: (id: string) => void;
}) {
  const color = companyColor(item.result.company);
  const bg = companyBg(item.result.company);

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-xl border p-3 transition-all",
        item.duplicate
          ? "border-[#fbbf24] bg-[#fffbeb]"
          : "border-[#e5e5e5] bg-white"
      )}
    >
      {/* Número sequencial */}
      <div
        className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
        style={{ backgroundColor: bg, color }}
      >
        {index + 1}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {/* Empresa */}
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-bold"
            style={{ backgroundColor: bg, color }}
          >
            {item.result.company}
          </span>

          {/* Pack */}
          {item.result.is_pack && (
            <span className="rounded-full bg-[#f0f4ff] px-2 py-0.5 text-[11px] font-semibold text-[#2968c8]">
              Pack · {item.result.orders.length} pedidos
            </span>
          )}

          {/* Duplicado */}
          {item.duplicate && (
            <span className="flex items-center gap-1 rounded-full bg-[#fef3c7] px-2 py-0.5 text-[11px] font-bold text-[#92400e]">
              <AlertCircle className="h-3 w-3" />
              Duplicado
            </span>
          )}

          {/* Horário */}
          <span className="ml-auto text-[11px] text-[#aaa]">
            {item.scanned_at.toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </div>

        {/* Pedidos */}
        <div className="mt-1.5 space-y-0.5">
          {item.result.orders.map((o) => (
            <div key={o.sale_number} className="flex items-center gap-2 text-[12px]">
              <span className="font-mono text-[11px] text-[#888]">#{o.sale_number}</span>
              <span className="truncate text-[#444]">{o.item_title}</span>
              <span className="ml-auto flex-shrink-0 font-semibold text-[#22c55e]">
                {formatCurrency(o.amount)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Remover */}
      <button
        className="flex-shrink-0 rounded-lg p-1 text-[#ccc] hover:bg-[#f5f5f5] hover:text-[#666]"
        onClick={() => onRemove(item.id)}
        title="Remover"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function ConferenciaSaidaPage() {
  const [items, setItems] = useState<ScannedItem[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<{
    type: "ok" | "duplicate" | "error";
    message: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focar no input automaticamente
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Totais calculados
  const totals = {
    total: items.filter((i) => !i.duplicate).length,
    ecoferro: items.filter((i) => !i.duplicate && isEcoferro(i.result.company)).length,
    fantom: items.filter((i) => !i.duplicate && !isEcoferro(i.result.company)).length,
    amount: items
      .filter((i) => !i.duplicate)
      .reduce((s, i) => s + i.result.total_amount, 0),
    amountEcoferro: items
      .filter((i) => !i.duplicate && isEcoferro(i.result.company))
      .reduce((s, i) => s + i.result.total_amount, 0),
    amountFantom: items
      .filter((i) => !i.duplicate && !isEcoferro(i.result.company))
      .reduce((s, i) => s + i.result.total_amount, 0),
  };

  const handleScan = useCallback(
    async (value: string) => {
      const q = value.trim();
      if (!q) return;

      setInputValue("");
      setLoading(true);
      setLastFeedback(null);

      try {
        const result = await lookupOrder(q);

        // Verificar duplicata — usa sale_number do primeiro pedido ou pack_id
        const itemId = result.pack_id ? String(result.pack_id) : result.orders[0]?.sale_number || q;
        const isDuplicate = items.some((i) => i.id === itemId);

        const newItem: ScannedItem = {
          id: itemId,
          result,
          scanned_at: new Date(),
          duplicate: isDuplicate,
        };

        setItems((prev) => [newItem, ...prev]);

        if (isDuplicate) {
          setLastFeedback({
            type: "duplicate",
            message: `⚠️ Duplicado! ${result.company} — #${itemId}`,
          });
          toast.warning(`Caixa duplicada: ${result.company} #${itemId}`);
        } else {
          setLastFeedback({
            type: "ok",
            message: `✓ ${result.company} — ${result.orders.length > 1 ? `Pack (${result.orders.length} pedidos)` : result.orders[0]?.item_title || q} — ${formatCurrency(result.total_amount)}`,
          });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Pedido não encontrado";
        setLastFeedback({ type: "error", message: `✗ ${message} — "${q}"` });
        toast.error(message);
      } finally {
        setLoading(false);
        // Refocar no input para próxima leitura
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    },
    [items]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      void handleScan(inputValue);
    }
  };

  const handleRemove = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleReset = () => {
    if (items.length === 0) return;
    if (!window.confirm("Limpar toda a conferência atual?")) return;
    setItems([]);
    setLastFeedback(null);
    inputRef.current?.focus();
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h1 className="text-[24px] font-bold text-[#1a1a1a] sm:text-[28px]">
              Conferência de Saída
            </h1>
            <p className="mt-0.5 text-[14px] text-[#666]">
              Leia o QR Code da etiqueta para registrar a saída da caixa.
            </p>
          </div>
          <Button
            variant="outline"
            className="h-9 text-[13px] text-[#e53e3e] hover:border-[#e53e3e] hover:bg-[#fff5f5]"
            onClick={handleReset}
            disabled={items.length === 0}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Limpar
          </Button>
        </div>

        {/* Campo de leitura */}
        <div className="mb-5 rounded-2xl border-2 border-[#2968c8] bg-white p-4 shadow-[0_2px_8px_rgba(41,104,200,0.12)]">
          <div className="mb-2 flex items-center gap-2">
            <Scan className="h-4 w-4 text-[#2968c8]" />
            <span className="text-[13px] font-semibold text-[#2968c8]">
              Aguardando leitura do QR Code...
            </span>
            {loading && (
              <span className="ml-auto text-[12px] text-[#888]">Buscando...</span>
            )}
          </div>
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Aponte o leitor para o QR Venda ou digite o número do pedido"
            className="h-12 border-[#d0e0ff] bg-[#f8faff] text-[15px] font-mono focus:border-[#2968c8] focus:ring-[#2968c8]"
            disabled={loading}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {/* Feedback da última leitura */}
          {lastFeedback && (
            <div
              className={cn(
                "mt-2 rounded-lg px-3 py-2 text-[13px] font-semibold",
                lastFeedback.type === "ok" && "bg-[#f0fdf4] text-[#166534]",
                lastFeedback.type === "duplicate" && "bg-[#fffbeb] text-[#92400e]",
                lastFeedback.type === "error" && "bg-[#fef2f2] text-[#991b1b]"
              )}
            >
              {lastFeedback.message}
            </div>
          )}
        </div>

        {/* Cards de totais */}
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Total caixas"
            value={totals.total}
            icon={<Box className="h-4 w-4" />}
            color="#2968c8"
          />
          <StatCard
            label="Ecoferro"
            value={totals.ecoferro}
            sub={formatCurrency(totals.amountEcoferro)}
            icon={<Building2 className="h-4 w-4" />}
            color="#2968c8"
          />
          <StatCard
            label="Fantom"
            value={totals.fantom}
            sub={formatCurrency(totals.amountFantom)}
            icon={<Building2 className="h-4 w-4" />}
            color="#7c3aed"
          />
          <StatCard
            label="Faturamento"
            value={formatCurrency(totals.amount)}
            icon={<TrendingUp className="h-4 w-4" />}
            color="#22c55e"
          />
        </div>

        {/* Lista de itens escaneados */}
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#e5e5e5] py-16 text-center">
            <QrCode className="mb-3 h-10 w-10 text-[#ccc]" />
            <p className="text-[15px] font-semibold text-[#888]">
              Nenhuma caixa conferida ainda
            </p>
            <p className="mt-1 text-[13px] text-[#aaa]">
              Leia o QR Code da etiqueta para começar.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[13px] font-semibold text-[#444]">
                {items.length} {items.length === 1 ? "leitura" : "leituras"} realizadas
              </span>
              {items.some((i) => i.duplicate) && (
                <span className="flex items-center gap-1 text-[12px] font-semibold text-[#92400e]">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {items.filter((i) => i.duplicate).length} duplicado(s)
                </span>
              )}
            </div>
            {items.map((item, idx) => (
              <ScannedCard
                key={`${item.id}-${item.scanned_at.getTime()}`}
                item={item}
                index={idx}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}

        {/* Resumo final quando há itens */}
        {items.length > 0 && (
          <div className="mt-5 rounded-2xl border border-[#e5e5e5] bg-[#fafafa] p-4">
            <div className="mb-3 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[#22c55e]" />
              <span className="text-[13px] font-bold text-[#444]">
                Resumo da conferência
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-3">
              <div className="rounded-xl bg-white p-3 text-center shadow-sm">
                <p className="text-[22px] font-bold text-[#2968c8]">{totals.ecoferro}</p>
                <p className="text-[11px] text-[#888]">Ecoferro</p>
                <p className="text-[11px] font-semibold text-[#22c55e]">
                  {formatCurrency(totals.amountEcoferro)}
                </p>
              </div>
              <div className="rounded-xl bg-white p-3 text-center shadow-sm">
                <p className="text-[22px] font-bold text-[#7c3aed]">{totals.fantom}</p>
                <p className="text-[11px] text-[#888]">Fantom</p>
                <p className="text-[11px] font-semibold text-[#22c55e]">
                  {formatCurrency(totals.amountFantom)}
                </p>
              </div>
              <div className="col-span-2 rounded-xl bg-white p-3 text-center shadow-sm sm:col-span-1">
                <p className="text-[22px] font-bold text-[#1a1a1a]">{totals.total}</p>
                <p className="text-[11px] text-[#888]">Total caixas</p>
                <p className="text-[11px] font-semibold text-[#22c55e]">
                  {formatCurrency(totals.amount)}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
