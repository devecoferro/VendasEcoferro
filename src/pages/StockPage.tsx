import { useCallback, useEffect, useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getMLConnectionStatus, getMLStock, syncMLStock, type MLStockItem } from "@/services/mercadoLivreService";
import { AlertCircle, ChevronDown, Filter, Loader2, Package, RefreshCw, Search, TrendingDown, X } from "lucide-react";

type SortKey = "available_quantity" | "sold_quantity" | "title" | "price";
type SortDir = "asc" | "desc";
type StatusFilter = "all" | "active" | "paused" | "closed";

export default function StockPage() {
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [items, setItems] = useState<MLStockItem[]>([]);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("available_quantity");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    getMLConnectionStatus()
      .then((conn) => {
        if (conn?.id) setConnectionId(conn.id);
        else setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const loadStock = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        const result = await getMLStock(id);
        setItems(result.items);
        setStale(result.stale);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Erro ao carregar estoque.");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (connectionId) loadStock(connectionId);
  }, [connectionId, loadStock]);

  const handleSync = useCallback(async () => {
    if (!connectionId) return;
    setSyncing(true);
    setError(null);
    try {
      await syncMLStock(connectionId);
      await loadStock(connectionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao sincronizar estoque.");
    } finally {
      setSyncing(false);
    }
  }, [connectionId, loadStock]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "title" ? "asc" : "asc");
    }
  };

  // Extrair opcoes unicas de marca, modelo e ano — CASCATA
  // Marcas: sempre todas. Modelos: filtrados pela marca. Anos: filtrados pela marca+modelo.
  const filterOptions = useMemo(() => {
    const brands = new Set<string>();
    const models = new Set<string>();
    const years = new Set<string>();

    for (const item of items) {
      if (item.brand) brands.add(item.brand);

      // Modelos: só da marca selecionada (ou todos se nenhuma marca)
      const matchesBrand = brandFilter === "all" || item.brand === brandFilter;
      if (matchesBrand && item.model) models.add(item.model);

      // Anos: só da marca+modelo selecionados
      const matchesModel = modelFilter === "all" || item.model === modelFilter;
      if (matchesBrand && matchesModel && item.vehicle_year) years.add(item.vehicle_year);
    }

    return {
      brands: [...brands].sort((a, b) => a.localeCompare(b, "pt-BR")),
      models: [...models].sort((a, b) => a.localeCompare(b, "pt-BR")),
      years: [...years].sort((a, b) => b.localeCompare(a)),
    };
  }, [items, brandFilter, modelFilter]);

  // Resetar modelo/ano quando a marca muda e o valor nao existe mais
  useEffect(() => {
    if (modelFilter !== "all" && !filterOptions.models.includes(modelFilter)) {
      setModelFilter("all");
    }
  }, [filterOptions.models, modelFilter]);

  useEffect(() => {
    if (yearFilter !== "all" && !filterOptions.years.includes(yearFilter)) {
      setYearFilter("all");
    }
  }, [filterOptions.years, yearFilter]);

  const hasActiveFilters = brandFilter !== "all" || modelFilter !== "all" || yearFilter !== "all" || statusFilter !== "all";
  const activeFilterCount = [brandFilter, modelFilter, yearFilter, statusFilter].filter(f => f !== "all").length;

  const clearFilters = () => {
    setBrandFilter("all");
    setModelFilter("all");
    setYearFilter("all");
    setStatusFilter("all");
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    let result = items;

    // Filtro de texto
    if (q) {
      result = result.filter(
        (item) =>
          item.title?.toLowerCase().includes(q) ||
          item.sku?.toLowerCase().includes(q) ||
          item.item_id.toLowerCase().includes(q) ||
          item.brand?.toLowerCase().includes(q) ||
          item.model?.toLowerCase().includes(q)
      );
    }

    // Filtros de marca/modelo/ano
    if (brandFilter !== "all") {
      result = result.filter((item) => item.brand === brandFilter);
    }
    if (modelFilter !== "all") {
      result = result.filter((item) => item.model === modelFilter);
    }
    if (yearFilter !== "all") {
      result = result.filter((item) => item.vehicle_year === yearFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((item) => item.status === statusFilter);
    }

    return [...result].sort((a, b) => {
      let va: string | number | null = a[sortKey] ?? null;
      let vb: string | number | null = b[sortKey] ?? null;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "string" && typeof vb === "string") {
        return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return sortDir === "asc"
        ? (va as number) - (vb as number)
        : (vb as number) - (va as number);
    });
  }, [items, search, brandFilter, modelFilter, yearFilter, statusFilter, sortKey, sortDir]);

  const stockStats = useMemo(() => {
    const active = items.filter((i) => i.status === "active").length;
    const paused = items.filter((i) => i.status === "paused").length;
    const closed = items.filter((i) => i.status === "closed" || i.status === "under_review").length;
    const lowStock = items.filter((i) => i.available_quantity <= 3 && i.status === "active").length;
    const outOfStock = items.filter((i) => i.available_quantity === 0 && i.status === "active").length;
    return { active, paused, closed, lowStock, outOfStock };
  }, [items]);

  const lowStockCount = stockStats.lowStock;

  const SortBtn = ({ label, col }: { label: string; col: SortKey }) => (
    <button
      className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
      onClick={() => toggleSort(col)}
      type="button"
    >
      {label}
      {sortKey === col && (
        <span className="text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>
      )}
    </button>
  );

  return (
    <AppLayout>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold">Estoque</h1>
              {stale && (
                <Badge variant="secondary" className="text-xs">
                  Desatualizado
                </Badge>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSync}
              disabled={syncing || !connectionId}
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-1" />
              )}
              Sincronizar
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {hasActiveFilters || search
              ? `${filtered.length} de ${items.length} produto(s)`
              : `${items.length} produto(s) sincronizados do Mercado Livre`}
          </p>
        </div>

        {/* Cards de resumo */}
        {items.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              type="button"
              onClick={() => { setStatusFilter(statusFilter === "active" ? "all" : "active"); setShowFilters(true); }}
              className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${statusFilter === "active" ? "border-primary bg-primary/5" : ""}`}
            >
              <p className="text-xs font-medium text-muted-foreground">Ativos</p>
              <p className="text-2xl font-bold text-green-600">{stockStats.active}</p>
            </button>
            <button
              type="button"
              onClick={() => { setStatusFilter(statusFilter === "paused" ? "all" : "paused"); setShowFilters(true); }}
              className={`rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 ${statusFilter === "paused" ? "border-primary bg-primary/5" : ""}`}
            >
              <p className="text-xs font-medium text-muted-foreground">Pausados</p>
              <p className="text-2xl font-bold text-yellow-600">{stockStats.paused}</p>
            </button>
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Estoque baixo</p>
              <p className={`text-2xl font-bold ${stockStats.lowStock > 0 ? "text-orange-500" : "text-foreground"}`}>
                {stockStats.lowStock}
              </p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs font-medium text-muted-foreground">Sem estoque</p>
              <p className={`text-2xl font-bold ${stockStats.outOfStock > 0 ? "text-destructive" : "text-foreground"}`}>
                {stockStats.outOfStock}
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Busca + Filtros */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9 h-10"
                placeholder="Buscar por titulo, SKU, marca ou modelo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <Button
              variant={showFilters ? "default" : "outline"}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="h-10 px-3 gap-1.5"
            >
              <Filter className="h-4 w-4" />
              <span className="hidden sm:inline">Filtros</span>
              {activeFilterCount > 0 && (
                <Badge variant="secondary" className="h-5 min-w-[20px] px-1.5 text-xs rounded-full">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-10 px-3 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4 mr-1" />
                <span className="hidden sm:inline">Limpar</span>
              </Button>
            )}
          </div>

          {/* Painel de filtros colapsavel */}
          {showFilters && (
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {filterOptions.brands.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Marca</label>
                    <Select value={brandFilter} onValueChange={setBrandFilter}>
                      <SelectTrigger className="h-10 bg-background">
                        <SelectValue placeholder="Todas as marcas" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todas as marcas</SelectItem>
                        {filterOptions.brands.map((brand) => (
                          <SelectItem key={brand} value={brand}>
                            {brand}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {filterOptions.models.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Modelo</label>
                    <Select value={modelFilter} onValueChange={setModelFilter}>
                      <SelectTrigger className="h-10 bg-background">
                        <SelectValue placeholder="Todos os modelos" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os modelos</SelectItem>
                        {filterOptions.models.map((model) => (
                          <SelectItem key={model} value={model}>
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {filterOptions.years.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Ano</label>
                    <Select value={yearFilter} onValueChange={setYearFilter}>
                      <SelectTrigger className="h-10 bg-background">
                        <SelectValue placeholder="Todos os anos" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Todos os anos</SelectItem>
                        {filterOptions.years.map((year) => (
                          <SelectItem key={year} value={year}>
                            {year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</label>
                  <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                    <SelectTrigger className="h-10 bg-background">
                      <SelectValue placeholder="Todos os status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos os status</SelectItem>
                      <SelectItem value="active">Ativo</SelectItem>
                      <SelectItem value="paused">Pausado</SelectItem>
                      <SelectItem value="closed">Encerrado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Tags dos filtros ativos */}
              {hasActiveFilters && (
                <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t">
                  {brandFilter !== "all" && (
                    <Badge variant="secondary" className="gap-1 pr-1">
                      {brandFilter}
                      <button type="button" onClick={() => setBrandFilter("all")} className="ml-0.5 rounded-full hover:bg-muted p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                  {modelFilter !== "all" && (
                    <Badge variant="secondary" className="gap-1 pr-1">
                      {modelFilter}
                      <button type="button" onClick={() => setModelFilter("all")} className="ml-0.5 rounded-full hover:bg-muted p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                  {yearFilter !== "all" && (
                    <Badge variant="secondary" className="gap-1 pr-1">
                      {yearFilter}
                      <button type="button" onClick={() => setYearFilter("all")} className="ml-0.5 rounded-full hover:bg-muted p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                  {statusFilter !== "all" && (
                    <Badge variant="secondary" className="gap-1 pr-1">
                      {statusFilter === "active" ? "Ativo" : statusFilter === "paused" ? "Pausado" : "Encerrado"}
                      <button type="button" onClick={() => setStatusFilter("all")} className="ml-0.5 rounded-full hover:bg-muted p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm">Carregando estoque...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <Package className="h-10 w-10 opacity-30" />
            <p className="text-sm">
              {items.length === 0
                ? "Nenhum produto sincronizado. Clique em Sincronizar."
                : "Nenhum produto encontrado para a busca."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-left">
                    <SortBtn label="Produto" col="title" />
                  </th>
                  <th className="px-4 py-3 text-left hidden sm:table-cell">SKU</th>
                  <th className="px-4 py-3 text-right">
                    <SortBtn label="Disponível" col="available_quantity" />
                  </th>
                  <th className="px-4 py-3 text-right hidden md:table-cell">
                    <SortBtn label="Vendido" col="sold_quantity" />
                  </th>
                  <th className="px-4 py-3 text-right hidden lg:table-cell">
                    <SortBtn label="Preço" col="price" />
                  </th>
                  <th className="px-4 py-3 text-center hidden md:table-cell">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map((item) => {
                  const isLow = item.available_quantity <= 3 && item.status === "active";
                  const isOut = item.available_quantity === 0;
                  return (
                    <tr
                      key={item.item_id}
                      className="hover:bg-muted/30 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {item.thumbnail ? (
                            <img
                              src={item.thumbnail}
                              alt=""
                              className="h-9 w-9 rounded object-cover flex-shrink-0"
                              loading="lazy"
                            />
                          ) : (
                            <div className="h-9 w-9 rounded bg-muted flex items-center justify-center flex-shrink-0">
                              <Package className="h-4 w-4 text-muted-foreground" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-medium truncate max-w-xs">{item.title ?? "—"}</p>
                            <p className="text-xs text-muted-foreground">ID: {item.item_id}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                        {item.sku ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        <span
                          className={
                            isOut
                              ? "text-destructive"
                              : isLow
                              ? "text-orange-500"
                              : "text-foreground"
                          }
                        >
                          {item.available_quantity}
                          {isLow && !isOut && (
                            <TrendingDown className="inline ml-1 h-3 w-3 text-orange-500" />
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">
                        {item.sold_quantity}
                      </td>
                      <td className="px-4 py-3 text-right hidden lg:table-cell">
                        {item.price != null
                          ? item.price.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-center hidden md:table-cell">
                        <Badge
                          variant={
                            item.status === "active"
                              ? "default"
                              : item.status === "paused"
                              ? "secondary"
                              : "outline"
                          }
                          className="text-xs"
                        >
                          {item.status ?? "—"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
