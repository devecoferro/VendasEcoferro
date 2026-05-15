/**
 * Conferência de Saída — gerencia caixas de despacho por empresa.
 * Permite criar caixas, adicionar pedidos, confirmar e despachar.
 */
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Box,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  PackageCheck,
  PackagePlus,
  Plus,
  RefreshCw,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { listMLConnections, type MLConnection } from "@/services/mercadoLivreService";
import {
  confirmBox,
  createBox,
  deleteBox,
  dispatchBox,
  getBox,
  listBoxes,
  updateBox,
  type BoxOrder,
  type ShippingBox,
} from "@/services/boxesService";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABEL: Record<string, string> = {
  open: "Aberta",
  confirmed: "Conferida",
  dispatched: "Despachada",
};

const STATUS_COLOR: Record<string, string> = {
  open: "bg-[#fff4ec] text-[#c2410c] border-[#ffa07a]",
  confirmed: "bg-[#eff6ff] text-[#1d4ed8] border-[#60a5fa]",
  dispatched: "bg-[#f0fdf4] text-[#15803d] border-[#22c55e]",
};

// ─── Componente de card de caixa ─────────────────────────────────────────────

interface BoxCardProps {
  box: ShippingBox;
  onRefresh: () => void;
}

function BoxCard({ box, onRefresh }: BoxCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [orders, setOrders] = useState<BoxOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [trackingCode, setTrackingCode] = useState(box.tracking_code || "");
  const [carrier, setCarrier] = useState(box.carrier || "");
  const [showDispatchForm, setShowDispatchForm] = useState(false);

  const loadOrders = useCallback(async () => {
    if (box.order_count === 0) { setOrders([]); return; }
    setLoadingOrders(true);
    try {
      const { box: detail } = await getBox(box.id);
      setOrders(detail.orders || []);
    } catch {
      toast.error("Erro ao carregar pedidos da caixa");
    } finally {
      setLoadingOrders(false);
    }
  }, [box.id, box.order_count]);

  useEffect(() => {
    if (expanded) loadOrders();
  }, [expanded, loadOrders]);

  const handleConfirm = async () => {
    setConfirming(true);
    try {
      await confirmBox(box.id);
      toast.success(`Caixa ${box.box_number} confirmada`);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao confirmar caixa");
    } finally {
      setConfirming(false);
    }
  };

  const handleDispatch = async () => {
    setDispatching(true);
    try {
      await dispatchBox(box.id, {
        tracking_code: trackingCode || undefined,
        carrier: carrier || undefined,
      });
      toast.success(`Caixa ${box.box_number} despachada`);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao despachar caixa");
    } finally {
      setDispatching(false);
      setShowDispatchForm(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remover caixa ${box.box_number}?`)) return;
    setDeleting(true);
    try {
      await deleteBox(box.id);
      toast.success(`Caixa ${box.box_number} removida`);
      onRefresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao remover caixa");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
      {/* Header da caixa */}
      <div className="flex items-center justify-between gap-3 border-b border-[#ededed] px-4 py-3">
        <div className="flex items-center gap-3">
          <Box className="h-5 w-5 text-[#888]" />
          <span className="text-[15px] font-bold text-[#222]">{box.box_number}</span>
          <Badge
            variant="outline"
            className={cn("text-[11px] font-semibold", STATUS_COLOR[box.status])}
          >
            {STATUS_LABEL[box.status]}
          </Badge>
          <span className="text-[13px] text-[#888]">{box.seller_nickname}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[#444]">
            {box.order_count} pedido{box.order_count !== 1 ? "s" : ""}
          </span>
          <span className="text-[13px] text-[#888]">·</span>
          <span className="text-[13px] font-semibold text-[#22c55e]">
            {formatCurrency(box.total_amount)}
          </span>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="ml-1 rounded-lg p-1 hover:bg-[#f5f5f5]"
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-[#888]" />
            ) : (
              <ChevronDown className="h-4 w-4 text-[#888]" />
            )}
          </button>
        </div>
      </div>

      {/* Detalhes expandidos */}
      {expanded && (
        <div className="px-4 py-4">
          {/* Lista de pedidos */}
          {loadingOrders ? (
            <div className="flex items-center gap-2 py-2 text-[13px] text-[#888]">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando pedidos...
            </div>
          ) : orders.length === 0 ? (
            <p className="py-2 text-[13px] text-[#aaa]">Nenhum pedido nesta caixa.</p>
          ) : (
            <div className="mb-4 overflow-hidden rounded-xl border border-[#e5e5e5]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#ededed] bg-[#fafafa]">
                    <th className="px-3 py-2 text-left font-semibold text-[#666]">Pedido</th>
                    <th className="px-3 py-2 text-left font-semibold text-[#666]">Comprador</th>
                    <th className="px-3 py-2 text-left font-semibold text-[#666]">SKU</th>
                    <th className="px-3 py-2 text-right font-semibold text-[#666]">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.order_id} className="border-b border-[#f0f0f0] last:border-0">
                      <td className="px-3 py-2 font-mono text-[12px] text-[#444]">
                        #{o.sale_number || o.order_id}
                      </td>
                      <td className="max-w-[160px] truncate px-3 py-2 text-[#444]">
                        {o.buyer_name || o.buyer_nickname || "—"}
                      </td>
                      <td className="px-3 py-2 font-mono text-[12px] text-[#666]">
                        {o.sku || "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-[#22c55e]">
                        {formatCurrency(o.amount || 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Informações adicionais */}
          <div className="mb-4 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
            <div>
              <span className="text-[#888]">Criada em</span>
              <p className="font-semibold text-[#444]">{formatDate(box.created_at)}</p>
            </div>
            {box.confirmed_at && (
              <div>
                <span className="text-[#888]">Conferida em</span>
                <p className="font-semibold text-[#444]">{formatDate(box.confirmed_at)}</p>
              </div>
            )}
            {box.dispatched_at && (
              <div>
                <span className="text-[#888]">Despachada em</span>
                <p className="font-semibold text-[#444]">{formatDate(box.dispatched_at)}</p>
              </div>
            )}
            {box.tracking_code && (
              <div>
                <span className="text-[#888]">Rastreio</span>
                <p className="font-mono font-semibold text-[#444]">{box.tracking_code}</p>
              </div>
            )}
            {box.carrier && (
              <div>
                <span className="text-[#888]">Transportadora</span>
                <p className="font-semibold text-[#444]">{box.carrier}</p>
              </div>
            )}
            {box.notes && (
              <div className="col-span-2">
                <span className="text-[#888]">Observações</span>
                <p className="text-[#444]">{box.notes}</p>
              </div>
            )}
          </div>

          {/* Formulário de despacho */}
          {showDispatchForm && box.status === "confirmed" && (
            <div className="mb-4 rounded-xl border border-[#d9e7ff] bg-[#f8fbff] p-4">
              <p className="mb-3 text-[13px] font-semibold text-[#2968c8]">Dados de despacho</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label className="mb-1 text-[12px] text-[#666]">Código de rastreio</Label>
                  <Input
                    value={trackingCode}
                    onChange={(e) => setTrackingCode(e.target.value)}
                    placeholder="Ex: BR123456789BR"
                    className="h-9 text-[13px]"
                  />
                </div>
                <div>
                  <Label className="mb-1 text-[12px] text-[#666]">Transportadora</Label>
                  <Input
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                    placeholder="Ex: Correios, Jadlog..."
                    className="h-9 text-[13px]"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Ações */}
          <div className="flex flex-wrap gap-2">
            {box.status === "open" && (
              <>
                <Button
                  size="sm"
                  className="h-9 bg-[#2968c8] text-white hover:bg-[#1d4fa0]"
                  onClick={handleConfirm}
                  disabled={confirming}
                >
                  {confirming ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <PackageCheck className="mr-1.5 h-4 w-4" />
                  )}
                  Confirmar conferência
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 border-[#fca5a5] text-[#dc2626] hover:bg-[#fef2f2]"
                  onClick={handleDelete}
                  disabled={deleting}
                >
                  {deleting ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1.5 h-4 w-4" />
                  )}
                  Remover
                </Button>
              </>
            )}
            {box.status === "confirmed" && (
              <>
                {!showDispatchForm ? (
                  <Button
                    size="sm"
                    className="h-9 bg-[#22c55e] text-white hover:bg-[#16a34a]"
                    onClick={() => setShowDispatchForm(true)}
                  >
                    <Truck className="mr-1.5 h-4 w-4" />
                    Despachar caixa
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      className="h-9 bg-[#22c55e] text-white hover:bg-[#16a34a]"
                      onClick={handleDispatch}
                      disabled={dispatching}
                    >
                      {dispatching ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <Truck className="mr-1.5 h-4 w-4" />
                      )}
                      Confirmar despacho
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9"
                      onClick={() => setShowDispatchForm(false)}
                    >
                      <X className="mr-1.5 h-4 w-4" />
                      Cancelar
                    </Button>
                  </>
                )}
              </>
            )}
            {box.status === "dispatched" && (
              <div className="flex items-center gap-2 text-[13px] text-[#15803d]">
                <CheckCircle2 className="h-4 w-4" />
                Caixa despachada em {formatDate(box.dispatched_at)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Formulário de nova caixa ────────────────────────────────────────────────

interface NewBoxFormProps {
  connections: MLConnection[];
  onCreated: () => void;
  onCancel: () => void;
}

function NewBoxForm({ connections, onCreated, onCancel }: NewBoxFormProps) {
  const [connectionId, setConnectionId] = useState(connections[0]?.id || "");
  const [orderIdsText, setOrderIdsText] = useState("");
  const [notes, setNotes] = useState("");
  const [trackingCode, setTrackingCode] = useState("");
  const [carrier, setCarrier] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!connectionId) {
      toast.error("Selecione uma empresa");
      return;
    }
    const orderIds = orderIdsText
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    setCreating(true);
    try {
      await createBox({
        connection_id: connectionId,
        order_ids: orderIds,
        notes: notes || undefined,
        tracking_code: trackingCode || undefined,
        carrier: carrier || undefined,
      });
      toast.success("Caixa criada com sucesso");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar caixa");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[#d9e7ff] bg-[#f8fbff] p-5">
      <p className="mb-4 text-[15px] font-bold text-[#2968c8]">Nova caixa de saída</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label className="mb-1.5 text-[13px] font-semibold text-[#444]">Empresa *</Label>
          <Select value={connectionId} onValueChange={setConnectionId}>
            <SelectTrigger className="h-10 text-[13px]">
              <SelectValue placeholder="Selecione a empresa" />
            </SelectTrigger>
            <SelectContent>
              {connections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.seller_nickname || c.seller_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="mb-1.5 text-[13px] font-semibold text-[#444]">Transportadora</Label>
          <Input
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            placeholder="Ex: Correios, Jadlog..."
            className="h-10 text-[13px]"
          />
        </div>
        <div>
          <Label className="mb-1.5 text-[13px] font-semibold text-[#444]">Código de rastreio</Label>
          <Input
            value={trackingCode}
            onChange={(e) => setTrackingCode(e.target.value)}
            placeholder="Ex: BR123456789BR"
            className="h-10 text-[13px]"
          />
        </div>
        <div>
          <Label className="mb-1.5 text-[13px] font-semibold text-[#444]">Observações</Label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observações opcionais"
            className="h-10 text-[13px]"
          />
        </div>
        <div className="sm:col-span-2">
          <Label className="mb-1.5 text-[13px] font-semibold text-[#444]">
            IDs dos pedidos (opcional — um por linha ou separados por vírgula)
          </Label>
          <textarea
            value={orderIdsText}
            onChange={(e) => setOrderIdsText(e.target.value)}
            placeholder={"2000016445670366\n2000016445670367\n..."}
            rows={3}
            className="w-full rounded-lg border border-[#e5e5e5] px-3 py-2 text-[13px] font-mono focus:border-[#2968c8] focus:outline-none focus:ring-1 focus:ring-[#2968c8]"
          />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          className="h-10 bg-[#2968c8] text-white hover:bg-[#1d4fa0]"
          onClick={handleCreate}
          disabled={creating}
        >
          {creating ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <PackagePlus className="mr-2 h-4 w-4" />
          )}
          Criar caixa
        </Button>
        <Button variant="outline" className="h-10" onClick={onCancel}>
          <X className="mr-2 h-4 w-4" />
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ─── Página principal ────────────────────────────────────────────────────────

export default function ConferenciaSaidaPage() {
  const [connections, setConnections] = useState<MLConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [boxes, setBoxes] = useState<ShippingBox[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showNewForm, setShowNewForm] = useState(false);

  const loadConnections = useCallback(async () => {
    try {
      const conns = await listMLConnections();
      setConnections(conns);
    } catch {
      toast.error("Erro ao carregar conexões ML");
    }
  }, []);

  const loadBoxes = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (selectedConnectionId !== "all") params.connection_id = selectedConnectionId;
      if (selectedStatus !== "all") params.status = selectedStatus;
      const result = await listBoxes(params);
      setBoxes(result.boxes);
      setTotal(result.total);
    } catch {
      toast.error("Erro ao carregar caixas");
    } finally {
      setLoading(false);
    }
  }, [selectedConnectionId, selectedStatus]);

  useEffect(() => { loadConnections(); }, [loadConnections]);
  useEffect(() => { loadBoxes(); }, [loadBoxes]);

  const handleCreated = () => {
    setShowNewForm(false);
    loadBoxes();
  };

  // Contadores por status
  const counts = {
    all: boxes.length,
    open: boxes.filter((b) => b.status === "open").length,
    confirmed: boxes.filter((b) => b.status === "confirmed").length,
    dispatched: boxes.filter((b) => b.status === "dispatched").length,
  };

  return (
    <AppLayout>
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-[24px] font-bold text-[#1a1a1a] sm:text-[28px]">
              Conferência de Saída
            </h1>
            <p className="mt-1 text-[14px] text-[#666]">
              Gerencie caixas de despacho por empresa. Crie, confira e despache.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-10 text-[13px]"
              onClick={loadBoxes}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 h-4 w-4" />
              )}
              Atualizar
            </Button>
            <Button
              className="h-10 bg-[#2968c8] text-[13px] text-white hover:bg-[#1d4fa0]"
              onClick={() => setShowNewForm((v) => !v)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Nova caixa
            </Button>
          </div>
        </div>

        {/* Formulário de nova caixa */}
        {showNewForm && (
          <div className="mb-6">
            <NewBoxForm
              connections={connections}
              onCreated={handleCreated}
              onCancel={() => setShowNewForm(false)}
            />
          </div>
        )}

        {/* Filtros */}
        <div className="mb-5 flex flex-wrap gap-3">
          {/* Filtro por empresa */}
          <Select value={selectedConnectionId} onValueChange={setSelectedConnectionId}>
            <SelectTrigger className="h-9 w-[180px] text-[13px]">
              <SelectValue placeholder="Empresa" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as empresas</SelectItem>
              {connections.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.seller_nickname || c.seller_id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Filtro por status */}
          <div className="flex gap-2">
            {(["all", "open", "confirmed", "dispatched"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSelectedStatus(s)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[12px] font-semibold transition",
                  selectedStatus === s
                    ? "border-[#2968c8] bg-[#2968c8] text-white"
                    : "border-[#e5e5e5] bg-white text-[#666] hover:border-[#2968c8] hover:text-[#2968c8]"
                )}
              >
                {s === "all" ? "Todas" : STATUS_LABEL[s]}
                <span className="ml-1.5 rounded-full bg-white/20 px-1.5 text-[11px]">
                  {counts[s]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Lista de caixas */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-[#2968c8]" />
          </div>
        ) : boxes.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#e5e5e5] py-16 text-center">
            <Box className="mb-3 h-10 w-10 text-[#ccc]" />
            <p className="text-[15px] font-semibold text-[#888]">Nenhuma caixa encontrada</p>
            <p className="mt-1 text-[13px] text-[#aaa]">
              Crie uma nova caixa para começar a conferência de saída.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {boxes.map((box) => (
              <BoxCard key={box.id} box={box} onRefresh={loadBoxes} />
            ))}
            {total > boxes.length && (
              <p className="text-center text-[13px] text-[#888]">
                Exibindo {boxes.length} de {total} caixas
              </p>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
