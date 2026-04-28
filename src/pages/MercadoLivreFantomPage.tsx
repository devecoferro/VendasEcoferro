import { useState } from "react";
import { toast } from "sonner";
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
import {
  AlertCircle,
  Calendar,
  FileOutput,
  Filter,
  Link2,
  Loader2,
  ShoppingCart,
} from "lucide-react";
import { startMLOAuth } from "@/services/mercadoLivreService";

const shipmentFilters = [
  "Envios de hoje",
  "Proximos dias",
  "Em transito",
  "Finalizadas",
];

export default function MercadoLivreFantomPage() {
  const [connecting, setConnecting] = useState(false);

  const handleConnectFantom = async () => {
    setConnecting(true);
    try {
      // Mesmo OAuth flow da EcoFerro — usa mesmo app (client_id) cadastrado
      // em developers.mercadolivre.com.br. ML pede login; usuario entra com
      // credenciais da conta Fantom Motoparts. Backend faz upsertConnection
      // por seller_id, criando 2a row em ml_connections sem afetar EcoFerro.
      // IMPORTANTE: pra autorizar com a conta Fantom, deslogue do ML no
      // browser primeiro OU use janela anonima/incognito.
      const url = await startMLOAuth();
      window.location.href = url;
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao iniciar autenticacao"
      );
      setConnecting(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">Fantom</h1>
              <Badge variant="outline">Canal Mercado Livre</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Estrutura criada para a segunda conta. A integracao desse canal fica
              pronta para configuracao depois, sem misturar com a EcoFerro.
            </p>
          </div>
          <Badge variant="secondary">Canal reservado</Badge>
        </div>

        <div className="glass-card space-y-4 p-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Link2 className="h-4 w-4 text-muted-foreground" />
              Conexao
            </h2>
            <Badge variant="outline">
              <AlertCircle className="mr-1 h-3 w-3" />
              Aguardando configuracao
            </Badge>
          </div>

          <div className="space-y-3 py-4">
            <p className="text-sm text-muted-foreground">
              Esse canal usa o <strong>mesmo app cadastrado no Mercado Livre</strong>{" "}
              da EcoFerro, mas conecta uma conta diferente (Fantom Motoparts).
              Os pedidos ficam separados por <code>seller_id</code> no banco.
            </p>
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-200">
              <strong>Antes de clicar:</strong> deslogue do Mercado Livre no
              browser ou abra uma janela anônima. Senão o ML autoriza com a conta
              que estiver logada (provavelmente a EcoFerro).
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleConnectFantom} disabled={connecting}>
                {connecting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="mr-2 h-4 w-4" />
                )}
                Conectar conta Fantom
              </Button>
              <Button disabled variant="secondary">
                <FileOutput className="mr-2 h-4 w-4" />
                Gerar Etiquetas
              </Button>
            </div>
          </div>
        </div>

        <div className="glass-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Input
                type="date"
                disabled
                className="h-8 w-40 bg-secondary/50 text-xs"
                value=""
                onChange={() => undefined}
              />
              <span className="text-xs text-muted-foreground">ate</span>
              <Input
                type="date"
                disabled
                className="h-8 w-40 bg-secondary/50 text-xs"
                value=""
                onChange={() => undefined}
              />
            </div>
            <Select disabled value="all">
              <SelectTrigger className="h-8 w-40 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" className="h-8 text-xs" disabled>
              Buscar
            </Button>
          </div>
        </div>

        <div className="glass-card p-5">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                Pedidos para etiquetas (0)
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Estrutura pronta para filtros, busca e geracao de etiquetas da segunda conta.
              </p>
            </div>

            <div className="w-full max-w-sm">
              <p className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                Vendas
              </p>
              <Select disabled value="all">
                <SelectTrigger className="h-11 bg-secondary/40 text-sm">
                  <SelectValue placeholder="Todas as vendas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as vendas</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mb-4 rounded-2xl border border-border/60 bg-secondary/40 p-2">
            <div className="flex flex-wrap gap-2">
              {shipmentFilters.map((label, index) => (
                <button
                  key={label}
                  type="button"
                  disabled
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                    index === 0
                      ? "bg-white text-foreground shadow-sm"
                      : "text-muted-foreground"
                  }`}
                >
                  <span>{label}</span>
                  <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-xs font-bold text-primary-foreground">
                    0
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <Input
              disabled
              value=""
              onChange={() => undefined}
              placeholder="Buscar por numero da venda, SKU, cliente ou nickname"
              className="h-11 bg-secondary/40 text-sm"
            />
          </div>

          <div className="rounded-lg border border-dashed border-border bg-secondary/20 px-4 py-10 text-center">
            <ShoppingCart className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-medium text-foreground">
              Canal Fantom criado com a mesma estrutura visual da EcoFerro.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Falta apenas conectar a segunda conta e definir a regra de sincronizacao.
            </p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
