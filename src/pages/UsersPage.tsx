import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { ALL_LOCATIONS_ACCESS, type AuthUser, type SaveUserInput, type UserRole } from "@/types/auth";
import { toast } from "sonner";
import { ShieldCheck, UserCog, UserPlus, Trash2 } from "lucide-react";

interface UserFormState {
  id?: string;
  username: string;
  password: string;
  role: UserRole;
  active: boolean;
  allowedLocations: string[];
  customLocation: string;
}

const initialFormState: UserFormState = {
  username: "",
  password: "",
  role: "operator",
  active: true,
  allowedLocations: [],
  customLocation: "",
};

function buildFormState(user?: AuthUser): UserFormState {
  if (!user) {
    return initialFormState;
  }

  return {
    id: user.id,
    username: user.username,
    password: "",
    role: user.role,
    active: user.active,
    allowedLocations: user.allowedLocations.includes(ALL_LOCATIONS_ACCESS)
      ? [ALL_LOCATIONS_ACCESS]
      : user.allowedLocations,
    customLocation: "",
  };
}

export default function UsersPage() {
  const { users, saveUser, toggleUserActive, deleteUser, locationOptions } = useAuth();
  const [form, setForm] = useState<UserFormState>(initialFormState);
  const [submitting, setSubmitting] = useState(false);
  const [togglingUserId, setTogglingUserId] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const editableLocations = useMemo(() => {
    const dynamic = form.allowedLocations.filter(
      (location) => location !== ALL_LOCATIONS_ACCESS && !locationOptions.includes(location)
    );
    return [...locationOptions, ...dynamic];
  }, [form.allowedLocations, locationOptions]);

  const resetForm = () => setForm(initialFormState);

  const toggleLocation = (location: string) => {
    setForm((current) => {
      const selected = current.allowedLocations.includes(location);
      return {
        ...current,
        allowedLocations: selected
          ? current.allowedLocations.filter((value) => value !== location)
          : [...current.allowedLocations, location],
      };
    });
  };

  const handleAllLocationsChange = (checked: boolean) => {
    setForm((current) => ({
      ...current,
      allowedLocations: checked ? [ALL_LOCATIONS_ACCESS] : [],
    }));
  };

  const addCustomLocation = () => {
    const customLocation = form.customLocation.trim();
    if (!customLocation) return;

    setForm((current) => ({
      ...current,
      customLocation: "",
      allowedLocations: current.allowedLocations.includes(customLocation)
        ? current.allowedLocations
        : [...current.allowedLocations.filter((value) => value !== ALL_LOCATIONS_ACCESS), customLocation],
    }));
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);

    try {
      const payload: SaveUserInput = {
        id: form.id,
        username: form.username,
        password: form.password || undefined,
        role: form.role,
        active: form.active,
        allowedLocations: form.allowedLocations,
      };

      await saveUser(payload);
      toast.success(form.id ? "Usuario atualizado." : "Novo usuario cadastrado.");
      resetForm();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao salvar usuario.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (userId: string) => {
    setTogglingUserId(userId);
    try {
      await toggleUserActive(userId);
      toast.success("Status do usuario atualizado.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao atualizar o usuario.");
    } finally {
      setTogglingUserId(null);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    setDeletingUserId(userId);
    try {
      await deleteUser(userId);
      toast.success("Usuario removido.");
      if (form.id === userId) {
        resetForm();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao remover o usuario.");
    } finally {
      setDeletingUserId(null);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Usuarios e acesso</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Cadastre usuarios, defina o perfil e escolha os locais que cada um pode operar no sistema centralizado.
            </p>
          </div>
          <Badge variant="secondary" className="gap-2 px-3 py-1.5">
            <ShieldCheck className="h-4 w-4" />
            Controle de acesso ativo
          </Badge>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
          <Card className="glass-card border-white/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <UserPlus className="h-5 w-5 text-primary" />
                {form.id ? "Editar usuario" : "Novo usuario"}
              </CardTitle>
              <CardDescription>
                {form.id
                  ? "Atualize senha, status e locais liberados para o usuario."
                  : "Crie um novo acesso para a operacao."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={handleSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="user-login">Usuario</Label>
                  <Input
                    id="user-login"
                    value={form.username}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, username: event.target.value }))
                    }
                    placeholder="nome.do.usuario"
                  />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="user-password">
                      {form.id ? "Nova senha" : "Senha"}
                    </Label>
                    <Input
                      id="user-password"
                      type="password"
                      value={form.password}
                      onChange={(event) =>
                        setForm((current) => ({ ...current, password: event.target.value }))
                      }
                      placeholder={form.id ? "Deixe em branco para manter" : "Senha do usuario"}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Perfil</Label>
                    <Select
                      value={form.role}
                      onValueChange={(value: UserRole) =>
                        setForm((current) => ({
                          ...current,
                          role: value,
                          allowedLocations:
                            value === "admin" ? [ALL_LOCATIONS_ACCESS] : current.allowedLocations,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Administrador</SelectItem>
                        <SelectItem value="operator">Operador</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-3 rounded-2xl border border-border/60 bg-secondary/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Permissao por local</p>
                      <p className="text-xs text-muted-foreground">
                        Selecione os locais que este usuario pode acessar.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="all-locations"
                        checked={form.allowedLocations.includes(ALL_LOCATIONS_ACCESS)}
                        onCheckedChange={(checked) => handleAllLocationsChange(Boolean(checked))}
                      />
                      <Label htmlFor="all-locations" className="text-sm">
                        Todos os locais
                      </Label>
                    </div>
                  </div>

                  {!form.allowedLocations.includes(ALL_LOCATIONS_ACCESS) && (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {editableLocations.map((location) => (
                          <label
                            key={location}
                            className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/80 px-3 py-2 text-sm"
                          >
                            <Checkbox
                              checked={form.allowedLocations.includes(location)}
                              onCheckedChange={() => toggleLocation(location)}
                            />
                            <span>{location}</span>
                          </label>
                        ))}
                      </div>

                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input
                          value={form.customLocation}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              customLocation: event.target.value,
                            }))
                          }
                          placeholder="Adicionar outro local"
                        />
                        <Button type="button" variant="outline" onClick={addCustomLocation}>
                          Adicionar local
                        </Button>
                      </div>
                    </>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Checkbox
                    id="user-active"
                    checked={form.active}
                    onCheckedChange={(checked) =>
                      setForm((current) => ({ ...current, active: Boolean(checked) }))
                    }
                  />
                  <Label htmlFor="user-active" className="text-sm">
                    Usuario ativo
                  </Label>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Salvando..." : form.id ? "Atualizar usuario" : "Cadastrar usuario"}
                  </Button>
                  {form.id && (
                    <Button type="button" variant="outline" onClick={resetForm}>
                      Cancelar edicao
                    </Button>
                  )}
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="glass-card border-white/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <UserCog className="h-5 w-5 text-primary" />
                Usuarios cadastrados
              </CardTitle>
              <CardDescription>
                Ative, desative e revise as permissoes de cada usuario.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {users.map((user) => {
                const allLocations = user.allowedLocations.includes(ALL_LOCATIONS_ACCESS);

                return (
                  <div
                    key={user.id}
                    className="rounded-2xl border border-border/60 bg-background/80 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">{user.username}</p>
                          <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                            {user.role === "admin" ? "Admin" : "Operador"}
                          </Badge>
                          <Badge variant={user.active ? "outline" : "destructive"}>
                            {user.active ? "Ativo" : "Inativo"}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {allLocations
                            ? "Acesso a todos os locais"
                            : `Locais: ${user.allowedLocations.join(", ")}`}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setForm(buildFormState(user))}
                        >
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void handleToggleActive(user.id)}
                          disabled={togglingUserId === user.id}
                        >
                          {togglingUserId === user.id
                            ? "Atualizando..."
                            : user.active
                              ? "Desativar"
                              : "Ativar"}
                        </Button>
                        {user.username !== "admin.ecoferro" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            onClick={() => void handleDeleteUser(user.id)}
                            disabled={deletingUserId === user.id}
                          >
                            <Trash2 className="mr-1 h-4 w-4" />
                            {deletingUserId === user.id ? "Removendo..." : "Remover"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
