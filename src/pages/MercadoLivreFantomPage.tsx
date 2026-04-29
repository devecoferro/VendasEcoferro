import { useEffect, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { listMLConnections, type MLConnection } from "@/services/mercadoLivreService";
import MercadoLivrePage from "./MercadoLivrePage";

/**
 * Brief 2026-04-28 multi-seller fase 2 UI: pagina da Fantom Motoparts
 * reusa a estrutura completa da MercadoLivrePage (cards, filtros,
 * lista, classificacoes), mas escopa todos os dados pelo connection_id
 * da Fantom.
 *
 * Resolucao do connection_id e dinamica via /api/ml/auth?action=list —
 * encontra a conexao cujo seller_nickname inclui "FANTOM" (case-insensitive).
 * Se houver mais de uma conexao Fantom no futuro, refinar criterio.
 */
export default function MercadoLivreFantomPage() {
  const [fantomConn, setFantomConn] = useState<MLConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const all = await listMLConnections();
        const fantom = all.find((c) =>
          (c.seller_nickname || "").toLowerCase().includes("fantom")
        );
        if (cancelled) return;
        if (!fantom) {
          setError(
            "Nenhuma conta Fantom Motoparts conectada. Use o botão 'Conectar conta Fantom' primeiro."
          );
        } else {
          setFantomConn(fantom);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Falha ao buscar conexão da Fantom Motoparts."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-center">
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
            <p className="mt-4 text-sm text-muted-foreground">
              Carregando conexão Fantom Motoparts…
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  if (error || !fantomConn) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-lg rounded-[18px] border border-amber-200 bg-amber-50 p-8 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-amber-600" />
          <h2 className="mt-3 text-lg font-semibold text-amber-900">
            Conta Fantom não conectada
          </h2>
          <p className="mt-2 text-sm text-amber-800">
            {error || "Conta da Fantom Motoparts ainda não foi conectada."}
          </p>
          <p className="mt-4 text-xs text-amber-700">
            Vá em <strong>/mercado-livre/reconnect</strong> em janela anônima logado
            com a conta Fantom para conectar.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => window.location.reload()}
          >
            Tentar novamente
          </Button>
        </div>
      </AppLayout>
    );
  }

  return <MercadoLivrePage connectionId={fantomConn.id} brand="fantom" />;
}
