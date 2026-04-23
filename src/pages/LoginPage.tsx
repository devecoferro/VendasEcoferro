import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Eye, EyeOff, Loader2, Lock, ShieldCheck, User } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { APP_VERSION_LABEL } from "@/lib/version";
import { TotpRequiredError } from "@/services/appAuthService";

const LOGIN_BACKGROUND = "/ChatGPT Image 2 de abr. de 2026, 11_27_17.png";
const LOGO_PATH = "/login-ecoferro-logo-transparent.png";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberUser, setRememberUser] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // S9: quando backend responde 428 (totp_required), mostra campo pro código.
  // Mantém username/password pra re-enviar junto com o código.
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode] = useState("");

  const redirectTarget = useMemo(() => {
    const state = location.state as { from?: string } | null;
    return state?.from || "/mercado-livre";
  }, [location.state]);

  useEffect(() => {
    if (currentUser) {
      navigate(redirectTarget, { replace: true });
    }
  }, [currentUser, navigate, redirectTarget]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await login(username.trim(), password, totpRequired ? totpCode.trim() : undefined);
      navigate(redirectTarget, { replace: true });
    } catch (loginError) {
      if (loginError instanceof TotpRequiredError) {
        // Backend pediu TOTP — ativa campo e espera próxima submit.
        setTotpRequired(true);
        setError("");
        return;
      }
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Nao foi possivel validar o acesso. Tente novamente.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#071635] text-white"
      style={{
        backgroundImage: `url("${LOGIN_BACKGROUND}")`,
        backgroundSize: "cover",
        backgroundPosition: "62% center",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="absolute inset-0 bg-[rgba(7,17,39,0.24)]" />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1500px] items-center justify-center px-5 py-8 sm:px-8 lg:px-14 xl:px-20 2xl:px-24">
        <div className="w-full max-w-[440px]">
          <div className="mb-6 flex flex-col items-center text-center">
            <img
              src={LOGO_PATH}
              alt="EcoFerro"
              className="mb-3 h-[76px] w-[76px] object-contain sm:h-[84px] sm:w-[84px]"
            />
            <div className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-white">
              EcoFerro
              <span className="inline-flex items-center rounded-full bg-emerald-500/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-200 ring-1 ring-inset ring-emerald-400/40">
                {APP_VERSION_LABEL}
              </span>
            </div>
          </div>

          <h1 className="text-center text-[33px] font-semibold leading-[1.06] tracking-[-0.03em] text-white sm:text-[42px]">
            Acesse seu painel
          </h1>

          <p className="mx-auto mt-4 max-w-[380px] text-center text-[15px] leading-7 text-white/80 sm:text-[16px]">
            Sistema integrado com Mercado Livre para gestao de etiquetas e operacoes
            logisticas.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div className="space-y-2.5">
              <FieldLabel>Usuario</FieldLabel>
              <InputShell>
                <User className="h-5 w-5 text-slate-400" />
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder=""
                  autoComplete="off"
                  className="w-full bg-transparent text-[16px] text-slate-900 outline-none placeholder:text-slate-500"
                />
              </InputShell>
            </div>

            <div className="space-y-2.5">
              <FieldLabel>Senha</FieldLabel>
              <InputShell>
                <Lock className="h-5 w-5 text-slate-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Digite sua senha"
                  autoComplete="current-password"
                  className="w-full bg-transparent text-[16px] text-slate-900 outline-none placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((previous) => !previous)}
                  className="text-slate-400 transition hover:text-slate-700"
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </InputShell>
            </div>

            <label className="flex items-center gap-2.5 pt-0.5 text-[14px] text-white">
              <button
                type="button"
                onClick={() => setRememberUser((previous) => !previous)}
                className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                  rememberUser
                    ? "border-[#67b1ff] bg-[#3f98ff] text-white"
                    : "border-white/30 bg-white/10 text-transparent"
                }`}
                aria-label={rememberUser ? "Desmarcar lembrar usuario" : "Lembrar usuario"}
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <span>Lembrar usuario</span>
            </label>

            {/* S9: campo de código 2FA só aparece quando backend pede. */}
            {totpRequired && (
              <div className="space-y-2">
                <label className="text-[14px] font-medium text-white/90">
                  Código 2FA
                </label>
                <InputShell>
                  <ShieldCheck className="h-5 w-5 text-slate-400" />
                  <input
                    type="text"
                    inputMode="numeric"
                    autoFocus
                    autoComplete="one-time-code"
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="000000 ou código de backup"
                    maxLength={16}
                    className="h-[52px] w-full border-0 bg-transparent px-0 text-[17px] text-slate-900 placeholder:text-slate-400 focus:outline-none"
                  />
                </InputShell>
                <p className="text-[12px] text-white/70">
                  Digite o código de 6 dígitos do seu app TOTP ou um dos códigos
                  de backup gerados na ativação.
                </p>
              </div>
            )}

            {error && (
              <div className="rounded-2xl border border-rose-300/25 bg-rose-500/14 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex h-[56px] w-full items-center justify-center gap-2.5 rounded-[16px] bg-gradient-to-r from-[#3e7cff] to-[#8a49ff] px-5 text-[17px] font-semibold text-white shadow-[0_14px_26px_rgba(77,94,255,0.24)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-85"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-5 w-5" />
                  Validando acesso...
                </>
              ) : (
                <>
                  <span>Entrar no painel</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="block text-[16px] font-semibold text-white">{children}</label>;
}

function InputShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-[58px] items-center gap-3 rounded-[16px] border border-white/28 bg-[linear-gradient(180deg,#f9fbff_0%,#edf3ff_100%)] px-5 shadow-[0_8px_16px_rgba(8,20,47,0.15)]">
      {children}
    </div>
  );
}
