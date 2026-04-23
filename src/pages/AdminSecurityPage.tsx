// Tela admin pra gerenciar 2FA do próprio usuário admin.
// /admin/security (ProtectedRoute requireAdmin).

import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ShieldCheck, ShieldAlert, Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface EnrollStartResponse {
  success: boolean;
  secret: string;
  otpauth_url: string;
  message: string;
}

interface EnrollConfirmResponse {
  success: boolean;
  backup_codes: string[];
  message: string;
}

export default function AdminSecurityPage() {
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState<"idle" | "enrolling" | "done">("idle");
  const [secret, setSecret] = useState("");
  const [otpauthUrl, setOtpauthUrl] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  async function startEnroll() {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/totp/enroll-start", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as EnrollStartResponse;
      setSecret(data.secret);
      setOtpauthUrl(data.otpauth_url);
      setStage("enrolling");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao iniciar enroll");
    } finally {
      setLoading(false);
    }
  }

  async function confirmEnroll() {
    if (!/^\d{6}$/.test(code.trim())) {
      toast.error("Digite os 6 dígitos do app TOTP.");
      return;
    }
    setLoading(true);
    try {
      const r = await fetch("/api/admin/totp/enroll-confirm", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = (await r.json()) as EnrollConfirmResponse & { error?: string };
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setBackupCodes(data.backup_codes);
      setStage("done");
      toast.success("2FA ativado!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao confirmar enroll");
    } finally {
      setLoading(false);
    }
  }

  async function disable() {
    const disableCode = window.prompt(
      "Digite seu código 2FA atual (6 dígitos) pra desativar:"
    );
    if (!disableCode) return;
    setLoading(true);
    try {
      const r = await fetch("/api/admin/totp/disable", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: disableCode.trim() }),
      });
      const data = (await r.json()) as { success?: boolean; error?: string };
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      toast.success("2FA desativado");
      setStage("idle");
      setSecret("");
      setBackupCodes([]);
      setCode("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao desativar");
    } finally {
      setLoading(false);
    }
  }

  function copyBackupCodes() {
    navigator.clipboard
      .writeText(backupCodes.join("\n"))
      .then(() => {
        setCopied(true);
        toast.success("Códigos copiados pro clipboard");
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => toast.error("Falha ao copiar"));
  }

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6 p-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Segurança da conta
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure autenticação em 2 fatores (2FA) com TOTP.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-4">
          {stage === "idle" && (
            <>
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-yellow-500" />
                  2FA desativado
                </h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Sua conta está protegida apenas por senha. Ativar 2FA adiciona
                  uma segunda camada via app autenticador (Google Authenticator,
                  Authy, 1Password, etc).
                </p>
              </div>
              <Button onClick={startEnroll} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Ativar 2FA
              </Button>
              <div className="border-t pt-3">
                <button
                  type="button"
                  onClick={disable}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  Desativar 2FA existente (se já ativou antes)
                </button>
              </div>
            </>
          )}

          {stage === "enrolling" && (
            <>
              <h2 className="text-lg font-semibold">Passo 1: escaneie o QR</h2>
              <p className="text-sm text-muted-foreground">
                Abra seu app autenticador e adicione uma nova conta escaneando
                o QR code abaixo.
              </p>
              <div className="flex flex-col items-center gap-3 py-4">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(otpauthUrl)}`}
                  alt="QR code 2FA"
                  className="border rounded-lg"
                  width={220}
                  height={220}
                />
                <details className="text-xs text-muted-foreground text-center">
                  <summary className="cursor-pointer">
                    Ou digite o secret manualmente
                  </summary>
                  <code className="mt-2 block px-2 py-1 bg-muted rounded font-mono text-xs break-all">
                    {secret}
                  </code>
                </details>
              </div>

              <div className="border-t pt-4 space-y-3">
                <h3 className="font-semibold">Passo 2: confirme</h3>
                <p className="text-sm text-muted-foreground">
                  Digite o código de 6 dígitos que aparece no seu app:
                </p>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="000000"
                    autoFocus
                    className="w-40 text-center font-mono text-lg tracking-widest"
                  />
                  <Button onClick={confirmEnroll} disabled={loading}>
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar"}
                  </Button>
                </div>
              </div>
            </>
          )}

          {stage === "done" && (
            <>
              <div className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">
                <ShieldCheck className="inline h-4 w-4 mr-1" />
                <strong>2FA ativado!</strong> No próximo login você vai precisar
                do código do seu app autenticador.
              </div>

              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  Códigos de backup
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Guarde em local seguro (ex: gerenciador de senhas). Cada código
                  funciona 1 vez. Use se perder o acesso ao app autenticador.
                </p>
              </div>

              <div className="rounded-md border bg-muted p-4 font-mono text-sm">
                <div className="grid grid-cols-2 gap-2">
                  {backupCodes.map((bc) => (
                    <div key={bc} className="tracking-wider">
                      {bc}
                    </div>
                  ))}
                </div>
              </div>

              <Button onClick={copyBackupCodes} variant="outline">
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2" /> Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" /> Copiar todos pro clipboard
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
