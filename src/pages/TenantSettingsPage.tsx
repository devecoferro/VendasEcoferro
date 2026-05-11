import { useState, useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Settings2, ImageIcon, Palette, FileText, Save, RefreshCw } from "lucide-react";
import { useTenantSettings } from "@/hooks/useTenantSettings";
import { useAuth } from "@/contexts/AuthContext";

export default function TenantSettingsPage() {
  const { currentUser } = useAuth();
  const { settings, loading, error, save, reload } = useTenantSettings();

  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#16a34a");
  const [labelFooter, setLabelFooter] = useState("");
  const [saving, setSaving] = useState(false);

  // Preenche o formulário quando as configurações são carregadas
  useEffect(() => {
    if (settings) {
      setCompanyName(settings.company_name ?? "");
      setLogoUrl(settings.logo_url ?? "");
      setPrimaryColor(settings.primary_color ?? "#16a34a");
      setLabelFooter(settings.label_footer ?? "");
    }
  }, [settings]);

  if (currentUser?.role !== "admin") {
    return (
      <AppLayout>
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          Acesso restrito a administradores.
        </div>
      </AppLayout>
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await save({
        company_name: companyName,
        logo_url: logoUrl,
        primary_color: primaryColor,
        label_footer: labelFooter,
      });
      toast.success("Configurações salvas com sucesso!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar configurações");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Settings2 className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Configurações do Painel</h1>
            <p className="text-sm text-muted-foreground">
              Personalize o nome da empresa, logo e identidade visual do painel.
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <form onSubmit={(e) => void handleSave(e)} className="space-y-4">
          {/* Identidade Visual */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <ImageIcon className="h-4 w-4" />
                Identidade Visual
              </CardTitle>
              <CardDescription>
                Nome e logo exibidos no menu lateral e nas etiquetas internas.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="company_name">Nome da Empresa</Label>
                <Input
                  id="company_name"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Ex: EcoFerro"
                  maxLength={200}
                  disabled={loading || saving}
                />
                <p className="text-xs text-muted-foreground">
                  Exibido no topo do menu lateral e no cabeçalho das etiquetas.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="logo_url">URL do Logo</Label>
                <Input
                  id="logo_url"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="Ex: /menu-ecoferro-logo-96.png ou https://..."
                  maxLength={512}
                  disabled={loading || saving}
                />
                <p className="text-xs text-muted-foreground">
                  Caminho relativo (ex: <code>/logo.png</code>) ou URL absoluta HTTPS.
                  Tamanho recomendado: 96×96px.
                </p>
              </div>

              {/* Preview do logo */}
              {logoUrl && (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-white shadow-sm">
                    <img
                      src={logoUrl}
                      alt="Preview do logo"
                      className="h-10 w-10 object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{companyName || "Nome da empresa"}</p>
                    <p className="text-xs text-muted-foreground">Preview do menu lateral</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cor Primária */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Palette className="h-4 w-4" />
                Cor Primária
              </CardTitle>
              <CardDescription>
                Cor de destaque usada nos botões e elementos ativos do painel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  id="primary_color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  disabled={loading || saving}
                  className="h-10 w-16 cursor-pointer rounded border border-input bg-background p-0.5"
                />
                <Input
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  placeholder="#16a34a"
                  maxLength={7}
                  className="w-32 font-mono text-sm"
                  disabled={loading || saving}
                />
                <div
                  className="h-8 w-8 rounded-full border shadow-sm"
                  style={{ backgroundColor: primaryColor }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Formato hexadecimal: <code>#rrggbb</code>. Padrão: <code>#16a34a</code> (verde EcoFerro).
              </p>
            </CardContent>
          </Card>

          {/* Rodapé das Etiquetas */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Rodapé das Etiquetas Internas
              </CardTitle>
              <CardDescription>
                Texto exibido no rodapé das etiquetas PDF geradas pelo sistema.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1.5">
                <Label htmlFor="label_footer">Texto do Rodapé</Label>
                <Input
                  id="label_footer"
                  value={labelFooter}
                  onChange={(e) => setLabelFooter(e.target.value)}
                  placeholder="Ex: EcoFerro Comércio de Ferragens Ltda"
                  maxLength={200}
                  disabled={loading || saving}
                />
                <p className="text-xs text-muted-foreground">
                  Razão social ou texto livre. Máximo 200 caracteres.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Ações */}
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void reload()}
              disabled={loading || saving}
            >
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Recarregar
            </Button>
            <Button type="submit" disabled={loading || saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Salvando..." : "Salvar Configurações"}
            </Button>
          </div>

          {settings?.updated_at && (
            <p className="text-center text-xs text-muted-foreground">
              Última atualização:{" "}
              {new Date(settings.updated_at).toLocaleString("pt-BR", {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </p>
          )}
        </form>
      </div>
    </AppLayout>
  );
}
