import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  Tag,
  Plus,
  Trash2,
  Star,
  StarOff,
  Eye,
  Edit3,
  Copy,
  RefreshCw,
  Loader2,
  Layout,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface LabelField {
  id: string;
  type: "text" | "image" | "qr" | "logo";
  label: string;
  source: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  font_size?: number;
  font_weight?: "normal" | "bold";
  prefix?: string;
  max_width_mm?: number;
  visible: boolean;
}

interface LabelLayout {
  card_width_mm: number;
  card_height_mm: number;
  border_color: string;
  border_radius_mm: number;
  border_width_mm: number;
  fields: LabelField[];
}

interface LabelTemplate {
  id: number;
  name: string;
  is_default: boolean;
  layout_json: LabelLayout;
  created_at: string;
  updated_at: string;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = (await res.json()) as { ok: boolean; error?: string } & T;
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// ─── Label Preview ────────────────────────────────────────────────────────────

const PREVIEW_SCALE = 3.5; // px per mm

function LabelPreview({ layout }: { layout: LabelLayout }) {
  const w = layout.card_width_mm * PREVIEW_SCALE;
  const h = layout.card_height_mm * PREVIEW_SCALE;

  return (
    <div
      className="relative overflow-hidden bg-white shadow-md"
      style={{
        width: w,
        height: h,
        border: `${layout.border_width_mm * PREVIEW_SCALE}px solid ${layout.border_color}`,
        borderRadius: layout.border_radius_mm * PREVIEW_SCALE,
      }}
    >
      {layout.fields
        .filter((f) => f.visible)
        .map((field) => {
          const left = field.x * PREVIEW_SCALE;
          const top = field.y * PREVIEW_SCALE;
          const fieldW = field.width ? field.width * PREVIEW_SCALE : undefined;
          const fieldH = field.height ? field.height * PREVIEW_SCALE : undefined;

          if (field.type === "image" || field.type === "logo") {
            return (
              <div
                key={field.id}
                className="absolute flex items-center justify-center rounded bg-gray-100 text-[8px] text-gray-400"
                style={{ left, top, width: fieldW, height: fieldH }}
                title={field.label}
              >
                {field.type === "logo" ? "Logo" : "Img"}
              </div>
            );
          }

          if (field.type === "qr") {
            return (
              <div
                key={field.id}
                className="absolute flex items-center justify-center rounded bg-gray-200 text-[7px] text-gray-500"
                style={{ left, top, width: fieldW, height: fieldH }}
                title={field.label}
              >
                QR
              </div>
            );
          }

          // text
          const fontSize = (field.font_size ?? 8) * PREVIEW_SCALE * 0.35;
          return (
            <div
              key={field.id}
              className="absolute truncate text-gray-800"
              style={{
                left,
                top,
                fontSize,
                fontWeight: field.font_weight === "bold" ? "bold" : "normal",
                maxWidth: field.max_width_mm
                  ? field.max_width_mm * PREVIEW_SCALE
                  : undefined,
              }}
              title={field.label}
            >
              {field.prefix ?? ""}{field.label}
            </div>
          );
        })}
    </div>
  );
}

// ─── Field Editor ─────────────────────────────────────────────────────────────

function FieldEditor({
  field,
  onChange,
}: {
  field: LabelField;
  onChange: (updated: LabelField) => void;
}) {
  function update<K extends keyof LabelField>(key: K, value: LabelField[K]) {
    onChange({ ...field, [key]: value });
  }

  return (
    <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm">
      <div className="col-span-2 flex items-center justify-between">
        <span className="font-medium text-foreground">{field.label}</span>
        <div className="flex items-center gap-2">
          <Label htmlFor={`vis-${field.id}`} className="text-xs text-muted-foreground">
            Visível
          </Label>
          <Switch
            id={`vis-${field.id}`}
            checked={field.visible}
            onCheckedChange={(v) => update("visible", v)}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">X (mm)</Label>
        <Input
          type="number"
          value={field.x}
          onChange={(e) => update("x", Number(e.target.value))}
          className="h-7 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Y (mm)</Label>
        <Input
          type="number"
          value={field.y}
          onChange={(e) => update("y", Number(e.target.value))}
          className="h-7 text-xs"
        />
      </div>

      {(field.type === "image" || field.type === "logo" || field.type === "qr") && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Largura (mm)</Label>
            <Input
              type="number"
              value={field.width ?? ""}
              onChange={(e) => update("width", Number(e.target.value))}
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Altura (mm)</Label>
            <Input
              type="number"
              value={field.height ?? ""}
              onChange={(e) => update("height", Number(e.target.value))}
              className="h-7 text-xs"
            />
          </div>
        </>
      )}

      {field.type === "text" && (
        <>
          <div className="space-y-1">
            <Label className="text-xs">Tamanho fonte</Label>
            <Input
              type="number"
              value={field.font_size ?? 8}
              onChange={(e) => update("font_size", Number(e.target.value))}
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Prefixo</Label>
            <Input
              value={field.prefix ?? ""}
              onChange={(e) => update("prefix", e.target.value)}
              className="h-7 text-xs"
              placeholder="Ex: SKU: "
            />
          </div>
        </>
      )}
    </div>
  );
}

// ─── Template Editor Dialog ───────────────────────────────────────────────────

interface EditorDialogProps {
  open: boolean;
  template: LabelTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}

function EditorDialog({ open, template, onClose, onSaved }: EditorDialogProps) {
  const [name, setName] = useState("");
  const [layout, setLayout] = useState<LabelLayout | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (template) {
      setName(template.name);
      setLayout(JSON.parse(JSON.stringify(template.layout_json)) as LabelLayout);
    }
  }, [template]);

  const updateField = useCallback((updated: LabelField) => {
    setLayout((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        fields: prev.fields.map((f) => (f.id === updated.id ? updated : f)),
      };
    });
  }, []);

  async function handleSave() {
    if (!template || !layout) return;
    setSaving(true);
    try {
      await apiFetch(`/api/label-templates/${template.id}`, {
        method: "PUT",
        body: JSON.stringify({ name, layout_json: layout }),
      });
      toast.success("Template salvo com sucesso!");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar template");
    } finally {
      setSaving(false);
    }
  }

  if (!template || !layout) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit3 className="h-4 w-4" />
            Editar Template de Etiqueta
          </DialogTitle>
          <DialogDescription>
            Ajuste posições, tamanhos e visibilidade de cada campo da etiqueta.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Coluna esquerda: campos */}
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Nome do template</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Etiqueta Padrão Ecoferro"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Largura cartão (mm)</Label>
                <Input
                  type="number"
                  value={layout.card_width_mm}
                  onChange={(e) =>
                    setLayout((l) =>
                      l ? { ...l, card_width_mm: Number(e.target.value) } : l
                    )
                  }
                  className="h-7 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Altura cartão (mm)</Label>
                <Input
                  type="number"
                  value={layout.card_height_mm}
                  onChange={(e) =>
                    setLayout((l) =>
                      l ? { ...l, card_height_mm: Number(e.target.value) } : l
                    )
                  }
                  className="h-7 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cor da borda</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={layout.border_color}
                    onChange={(e) =>
                      setLayout((l) =>
                        l ? { ...l, border_color: e.target.value } : l
                      )
                    }
                    className="h-7 w-10 cursor-pointer rounded border"
                  />
                  <Input
                    value={layout.border_color}
                    onChange={(e) =>
                      setLayout((l) =>
                        l ? { ...l, border_color: e.target.value } : l
                      )
                    }
                    className="h-7 flex-1 text-xs"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Campos da etiqueta</p>
              <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
                {layout.fields.map((field) => (
                  <FieldEditor key={field.id} field={field} onChange={updateField} />
                ))}
              </div>
            </div>
          </div>

          {/* Coluna direita: preview */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Pré-visualização</p>
            <div className="overflow-auto rounded-lg border bg-gray-50 p-4">
              <LabelPreview layout={layout} />
            </div>
            <p className="text-xs text-muted-foreground">
              Escala aproximada. Posições em milímetros. Conteúdo real varia por pedido.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar template"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Dialog ────────────────────────────────────────────────────────────

function CreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleCreate() {
    if (!name.trim()) {
      toast.error("Informe um nome para o template.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/api/label-templates", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      toast.success("Template criado com sucesso!");
      setName("");
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao criar template");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Novo Template de Etiqueta
          </DialogTitle>
          <DialogDescription>
            Um novo template será criado com o layout padrão da Ecoferro. Você poderá
            personalizar os campos em seguida.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Nome do template</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Etiqueta Compacta"
            onKeyDown={(e) => e.key === "Enter" && void handleCreate()}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void handleCreate()} disabled={saving || !name.trim()}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Criando...
              </>
            ) : (
              "Criar template"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function LabelTemplatesPage() {
  const { currentUser } = useAuth();
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingTemplate, setEditingTemplate] = useState<LabelTemplate | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<LabelTemplate | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<LabelTemplate | null>(null);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ templates: LabelTemplate[] }>("/api/label-templates");
      setTemplates(data.templates);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar templates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  async function handleSetDefault(template: LabelTemplate) {
    setActionLoading(template.id);
    try {
      await apiFetch(`/api/label-templates/${template.id}/set-default`, {
        method: "POST",
      });
      toast.success(`"${template.name}" definido como template padrão.`);
      await loadTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao definir padrão");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(template: LabelTemplate) {
    setActionLoading(template.id);
    try {
      await apiFetch(`/api/label-templates/${template.id}`, { method: "DELETE" });
      toast.success(`Template "${template.name}" removido.`);
      setDeleteTarget(null);
      await loadTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover template");
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDuplicate(template: LabelTemplate) {
    setActionLoading(template.id);
    try {
      await apiFetch("/api/label-templates", {
        method: "POST",
        body: JSON.stringify({
          name: `${template.name} (cópia)`,
          layout_json: template.layout_json,
        }),
      });
      toast.success("Template duplicado com sucesso.");
      await loadTemplates();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao duplicar template");
    } finally {
      setActionLoading(null);
    }
  }

  if (currentUser?.role !== "admin") {
    return (
      <AppLayout>
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          Acesso restrito a administradores.
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Tag className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-xl font-bold tracking-tight">Templates de Etiqueta</h1>
              <p className="text-sm text-muted-foreground">
                Crie e personalize layouts de etiqueta para expedição.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadTemplates()}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Novo template
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty */}
        {!loading && templates.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-12">
              <Layout className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Nenhum template criado ainda.
              </p>
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Criar primeiro template
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Template list */}
        {!loading && templates.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {templates.map((template) => (
              <Card
                key={template.id}
                className={
                  template.is_default
                    ? "border-primary/50 ring-1 ring-primary/20"
                    : ""
                }
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="truncate text-base">
                        {template.name}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {template.layout_json.card_width_mm}×
                        {template.layout_json.card_height_mm} mm ·{" "}
                        {template.layout_json.fields.filter((f) => f.visible).length} campos
                        visíveis
                      </CardDescription>
                    </div>
                    {template.is_default && (
                      <Badge variant="default" className="shrink-0 text-xs">
                        <Star className="mr-1 h-3 w-3" />
                        Padrão
                      </Badge>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  {/* Mini preview */}
                  <div className="overflow-hidden rounded border bg-gray-50 p-2">
                    <div className="scale-[0.45] origin-top-left" style={{ height: template.layout_json.card_height_mm * 3.5 * 0.45 }}>
                      <LabelPreview layout={template.layout_json} />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setPreviewTemplate(template)}
                    >
                      <Eye className="mr-1 h-3 w-3" />
                      Ver
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setEditingTemplate(template)}
                    >
                      <Edit3 className="mr-1 h-3 w-3" />
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleDuplicate(template)}
                      disabled={actionLoading === template.id}
                    >
                      {actionLoading === template.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                    {!template.is_default && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleSetDefault(template)}
                        disabled={actionLoading === template.id}
                        title="Definir como padrão"
                      >
                        {actionLoading === template.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <StarOff className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => setDeleteTarget(template)}
                      disabled={template.is_default || actionLoading === template.id}
                      title={
                        template.is_default
                          ? "Não é possível remover o template padrão"
                          : "Remover template"
                      }
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <CreateDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => void loadTemplates()}
      />

      <EditorDialog
        open={Boolean(editingTemplate)}
        template={editingTemplate}
        onClose={() => setEditingTemplate(null)}
        onSaved={() => void loadTemplates()}
      />

      {/* Preview dialog */}
      <Dialog
        open={Boolean(previewTemplate)}
        onOpenChange={(v) => !v && setPreviewTemplate(null)}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              {previewTemplate?.name}
            </DialogTitle>
            <DialogDescription>
              Pré-visualização do layout em escala real.
            </DialogDescription>
          </DialogHeader>
          {previewTemplate && (
            <div className="overflow-auto rounded-lg border bg-gray-50 p-6">
              <LabelPreview layout={previewTemplate.layout_json} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover template?</AlertDialogTitle>
            <AlertDialogDescription>
              O template <strong>{deleteTarget?.name}</strong> será removido permanentemente.
              Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && void handleDelete(deleteTarget)}
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
