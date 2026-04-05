import { useEffect, useState } from "react";
import { Loader2, CircleAlert } from "lucide-react";
import { startMLOAuth } from "@/services/mercadoLivreService";

export default function MLReconnectPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const runReconnect = async () => {
      try {
        const authUrl = await startMLOAuth();
        if (!cancelled) {
          window.location.assign(authUrl);
        }
      } catch (reconnectError) {
        if (!cancelled) {
          setError(
            reconnectError instanceof Error
              ? reconnectError.message
              : "Nao foi possivel iniciar a reconexao com o Mercado Livre."
          );
        }
      }
    };

    void runReconnect();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="glass-card w-full max-w-lg rounded-[28px] px-8 py-10 text-center">
        {error ? (
          <>
            <CircleAlert className="mx-auto h-12 w-12 text-destructive" />
            <h1 className="mt-5 text-2xl font-semibold text-foreground">
              Reconexao nao iniciada
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{error}</p>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
            <h1 className="mt-5 text-2xl font-semibold text-foreground">
              Reconectando Mercado Livre
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Estamos abrindo a autorizacao nova da conta para atualizar o token
              com as permissoes mais recentes.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
