import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { exchangeMLCode } from "@/services/mercadoLivreService";
import {
  clearStoredMLOAuthSession,
  getStoredMLOAuthSession,
} from "@/services/mlOAuth";

export default function MLCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Conectando ao Mercado Livre...");

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const oauthError = searchParams.get("error");
    const oauthErrorDescription = searchParams.get("error_description");
    const oauthSession = getStoredMLOAuthSession();

    if (oauthError) {
      clearStoredMLOAuthSession();
      setStatus("error");
      setMessage(
        decodeURIComponent(
          oauthErrorDescription || `O Mercado Livre recusou a autorização (${oauthError}).`
        )
      );
      return;
    }

    if (!code) {
      setStatus("error");
      setMessage("Código de autorização não encontrado.");
      return;
    }

    // Se não há sessão OAuth armazenada (ex: link direto), usa redirect_uri padrão
    // e prossegue sem code_verifier (o backend aceita sem PKCE).
    const redirectUri = oauthSession?.redirectUri || `${window.location.origin}/ml-callback`;
    const codeVerifier = oauthSession?.codeVerifier || undefined;

    if (state && oauthSession && oauthSession.state !== state) {
      clearStoredMLOAuthSession();
      setStatus("error");
      setMessage("Estado de segurança inválido. Tente novamente.");
      return;
    }

    // Backend exige `state` no exchange_code — antes caía com "state is
    // required" porque ele chegava da URL mas não era reencaminhado.
    if (!state) {
      setStatus("error");
      setMessage("Parâmetro `state` ausente na URL de retorno do Mercado Livre.");
      return;
    }

    exchangeMLCode({
      code,
      state,
      redirectUri,
      codeVerifier,
    })
      .then(() => {
        clearStoredMLOAuthSession();
        setStatus("success");
        setMessage("Conta conectada com sucesso!");
        setTimeout(() => navigate("/mercado-livre"), 2000);
      })
      .catch((err) => {
        clearStoredMLOAuthSession();
        setStatus("error");
        setMessage(err.message || "Erro ao conectar conta.");
      });
  }, [navigate, searchParams]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="glass-card w-full max-w-md space-y-4 p-8 text-center">
        {status === "loading" && (
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
        )}
        {status === "success" && (
          <CheckCircle className="mx-auto h-12 w-12 text-success" />
        )}
        {status === "error" && (
          <XCircle className="mx-auto h-12 w-12 text-destructive" />
        )}
        <p className="font-medium text-foreground">{message}</p>
        {status === "error" && (
          <button
            onClick={() => navigate("/mercado-livre")}
            className="text-sm text-primary hover:underline"
          >
            Voltar para configurações
          </button>
        )}
      </div>
    </div>
  );
}
