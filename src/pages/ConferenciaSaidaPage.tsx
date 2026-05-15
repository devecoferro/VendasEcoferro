/**
 * ConferenciaSaidaPage — Conferência física de saída de caixas.
 *
 * Fluxo:
 *  1. Operador lê QR Code / código de barras
 *  2. Sistema busca o pedido no banco (lookup)
 *  3. Sistema registra a leitura na tabela conferencia_saida (persistência)
 *  4. Relatório de Caixas mostra apenas o que passou por aqui
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
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
import {
  lookupOrder,
  registrarConferencia,
  type BoxLookupResult,
} from "@/services/boxReportService";

// ─── ID de sessão ─────────────────────────────────────────────────────────────
// Gerado uma vez por montagem da página — identifica a "rodada" de conferência
function generateSessionId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ScannedItem {
  id: string; // shipping_id (chave de dedup)
  result: BoxLookupResult;
  scanned_at: Date;
  duplicate: boolean;
  saved: boolean; // true = registrado no banco com sucesso
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

          {/* Salvo no banco */}
          {item.saved && !item.duplicate && (
            <span className="flex items-center gap-1 rounded-full bg-[#f0fdf4] px-2 py-0.5 text-[11px] font-semibold text-[#166534]">
              <CheckCircle2 className="h-3 w-3" />
              Registrado
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
  const { currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  // ID de sessão — identifica esta rodada de conferência
  const sessionId = useRef(generateSessionId());

  const [items, setItems] = useState<ScannedItem[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [lastFeedback, setLastFeedback] = useState<{
    type: "ok" | "duplicate" | "error";
    message: string;
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        // 1. Busca o pedido no banco
        const result = await lookupOrder(q);

        // 2. Chave de dedup — usa shipping_id (mais confiável) ou pack_id ou sale_number
        const itemId =
          result.shipping_id ||
          (result.pack_id ? String(result.pack_id) : null) ||
          result.orders[0]?.sale_number ||
          q;

        const isDuplicate = items.some((i) => i.id === itemId);

        // 3. Registra no banco (mesmo se duplicado — o backend usa INSERT OR IGNORE)
        let saved = false;
        if (!isDuplicate && result.shipping_id) {
          try {
            await registrarConferencia({
              session_id: sessionId.current,
              shipping_id: result.shipping_id,
              order_id: result.orders[0]?.order_id,
              sale_number: result.orders[0]?.sale_number,
              pack_id: result.pack_id ?? undefined,
              connection_id: result.connection_id,
              seller_nickname: result.company,
              item_title: result.orders[0]?.item_title,
              buyer_name: result.orders[0]?.buyer_name,
              amount: result.total_amount,
              order_count: result.orders.length,
            });
            saved = true;
          } catch (saveErr) {
            // Falha ao salvar não bloqueia a UI — apenas loga
            console.warn("[conferencia] falha ao registrar no banco:", saveErr);
          }
        }

        const newItem: ScannedItem = {
          id: itemId,
          result,
          scanned_at: new Date(),
          duplicate: isDuplicate,
          saved,
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
            message: `✓ ${result.company} — ${
              result.orders.length > 1
                ? `Pack (${result.orders.length} pedidos)`
                : result.orders[0]?.item_title || q
            } — ${formatCurrency(result.total_amount)}`,
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

  // Auto-submit: processa automaticamente 500ms após parar de digitar
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);

    if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);

    if (val.trim().length >= 8) {
      autoSubmitTimer.current = setTimeout(() => {
        void handleScan(val);
      }, 500);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
      void handleScan(inputValue);
    }
  };

  // Limpar timer ao desmontar
  useEffect(() => {
    return () => {
      if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current);
    };
  }, []);

  const handleRemove = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const handleReset = () => {
    if (items.length === 0) return;
    if (!window.confirm("Limpar toda a conferência atual? Uma nova sessão será iniciada.")) return;
    setItems([]);
    setLastFeedback(null);
    // Nova sessão para a próxima rodada
    sessionId.current = generateSessionId();
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
              Leia o QR Code ou código de barras para registrar a saída da caixa.
            </p>
          </div>
          <Button
            variant="outline"
            className="h-9 text-[13px] text-[#e53e3e] hover:border-[#e53e3e] hover:bg-[#fff5f5] hover:text-[#e53e3e]"
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
              Aguardando leitura...
            </span>
            {loading && (
              <span className="ml-auto text-[12px] text-[#888]">Buscando...</span>
            )}
          </div>
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Aponte o leitor de QR Code ou código de barras"
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
        <div
          className={`mb-5 grid gap-3 ${
            isAdmin ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-2"
          }`}
        >
          <StatCard
            label="Total caixas"
            value={totals.total}
            icon={<Box className="h-4 w-4" />}
            color="#2968c8"
          />
          <StatCard
            label="Ecoferro"
            value={totals.ecoferro}
            sub={isAdmin ? formatCurrency(totals.amountEcoferro) : undefined}
            icon={<Building2 className="h-4 w-4" />}
            color="#2968c8"
          />
          <StatCard
            label="Fantom"
            value={totals.fantom}
            sub={isAdmin ? formatCurrency(totals.amountFantom) : undefined}
            icon={<Building2 className="h-4 w-4" />}
            color="#7c3aed"
          />
          {isAdmin && (
            <StatCard
              label="Faturamento"
              value={formatCurrency(totals.amount)}
              icon={<TrendingUp className="h-4 w-4" />}
              color="#22c55e"
            />
          )}
        </div>

        {/* Lista de itens escaneados */}
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#e5e5e5] py-16 text-center">
            <QrCode className="mb-3 h-10 w-10 text-[#ccc]" />
            <p className="text-[15px] font-semibold text-[#888]">
              Nenhuma caixa conferida ainda
            </p>
            <p className="mt-1 text-[13px] text-[#aaa]">
              Leia o QR Code ou código de barras da etiqueta para começar.
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
              <span className="ml-auto text-[11px] text-[#aaa]">
                Sessão: {sessionId.current.slice(0, 12)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-3">
              <div className="rounded-xl bg-white p-3 text-center shadow-sm">
                <p className="text-[22px] font-bold text-[#2968c8]">{totals.ecoferro}</p>
                <p className="text-[11px] text-[#888]">Ecoferro</p>
                {isAdmin && (
                  <p className="text-[11px] font-semibold text-[#22c55e]">
                    {formatCurrency(totals.amountEcoferro)}
                  </p>
                )}
              </div>
              <div className="rounded-xl bg-white p-3 text-center shadow-sm">
                <p className="text-[22px] font-bold text-[#7c3aed]">{totals.fantom}</p>
                <p className="text-[11px] text-[#888]">Fantom</p>
                {isAdmin && (
                  <p className="text-[11px] font-semibold text-[#22c55e]">
                    {formatCurrency(totals.amountFantom)}
                  </p>
                )}
              </div>
              <div className="col-span-2 rounded-xl bg-white p-3 text-center shadow-sm sm:col-span-1">
                <p className="text-[22px] font-bold text-[#1a1a1a]">{totals.total}</p>
                <p className="text-[11px] text-[#888]">Total caixas</p>
                {isAdmin && (
                  <p className="text-[11px] font-semibold text-[#22c55e]">
                    {formatCurrency(totals.amount)}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
