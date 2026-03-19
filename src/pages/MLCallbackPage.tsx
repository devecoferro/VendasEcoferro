import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { exchangeMLCode } from "@/services/mercadoLivreService";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

export default function MLCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Conectando ao Mercado Livre...");

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const savedState = sessionStorage.getItem("ml_oauth_state");

    if (!code) {
      setStatus("error");
      setMessage("Código de autorização não encontrado.");
      return;
    }

    if (state && savedState && state !== savedState) {
      setStatus("error");
      setMessage("Estado de segurança inválido. Tente novamente.");
      return;
    }

    sessionStorage.removeItem("ml_oauth_state");

    exchangeMLCode(code)
      .then(() => {
        setStatus("success");
        setMessage("Conta conectada com sucesso!");
        setTimeout(() => navigate("/mercado-livre"), 2000);
      })
      .catch((err) => {
        setStatus("error");
        setMessage(err.message || "Erro ao conectar conta.");
      });
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="glass-card p-8 max-w-md w-full text-center space-y-4">
        {status === "loading" && (
          <Loader2 className="w-12 h-12 text-primary mx-auto animate-spin" />
        )}
        {status === "success" && (
          <CheckCircle className="w-12 h-12 text-success mx-auto" />
        )}
        {status === "error" && (
          <XCircle className="w-12 h-12 text-destructive mx-auto" />
        )}
        <p className="text-foreground font-medium">{message}</p>
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
