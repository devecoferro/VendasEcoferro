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
import { Filter, Loader2, Package, RefreshCw, Search, TrendingDown, X } from "lucide-react";

type SortKey = "available_quantity" | "sold_quantity" | "title" | "price";
type SortDir = "asc" | "desc";

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

  // Extrair opcoes unicas de marca, modelo e ano para os filtros
  const filterOptions = useMemo(() => {
    const brands = new Set<string>();
    const models = new Set<string>();
    const years = new Set<string>();

    for (const item of items) {
      if (item.brand) brands.add(item.brand);
      if (item.model) models.add(item.model);
      if (item.vehicle_year) years.add(item.vehicle_year);
    }

    return {
      brands: [...brands].sort((a, b) => a.localeCompare(b, "pt-BR")),
      models: [...models].sort((a, b) => a.localeCompare(b, "pt-BR")),
      years: [...years].sort((a, b) => b.localeCompare(a)), // Ano mais recente primeiro
    };
  }, [items]);

  const hasActiveFilters = brandFilter !== "all" || modelFilter !== "all" || yearFilter !== "all";

  const clearFilters = () => {
    setBrandFilter("all");
    setModelFilter("all");
    setYearFilter("all");
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
  }, [items, search, brandFilter, modelFilter, yearFilter, sortKey, sortDir]);

  const lowStockCount = useMemo(
    () => items.filter((i) => i.available_quantity <= 3 && i.status === "active").length,
    [items]
  );

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
            {lowStockCount > 0 && (
              <span className="ml-2 text-orange-500 font-medium">
                · {lowStockCount} com estoque baixo (≤ 3)
              </span>
            )}
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex flex-col gap-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Buscar por titulo, SKU, marca ou modelo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {(filterOptions.brands.length > 0 || filterOptions.models.length > 0 || filterOptions.years.length > 0) && (
            <div className="flex flex-wrap items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground flex-shrink-0" />

              {filterOptions.brands.length > 0 && (
                <Select value={brandFilter} onValueChange={setBrandFilter}>
                  <SelectTrigger className="w-[180px] h-9 text-sm">
                    <SelectValue placeholder="Marca" />
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
              )}

              {filterOptions.models.length > 0 && (
                <Select value={modelFilter} onValueChange={setModelFilter}>
                  <SelectTrigger className="w-[180px] h-9 text-sm">
                    <SelectValue placeholder="Modelo" />
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
              )}

              {filterOptions.years.length > 0 && (
                <Select value={yearFilter} onValueChange={setYearFilter}>
                  <SelectTrigger className="w-[140px] h-9 text-sm">
                    <SelectValue placeholder="Ano" />
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
              )}

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="h-9 px-2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4 mr-1" />
                  Limpar filtros
                </Button>
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
