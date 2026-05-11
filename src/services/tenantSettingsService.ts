/**
 * Serviço de configurações de branding por tenant.
 * Lê/salva company_name, logo_url, primary_color e label_footer
 * via /api/tenant-settings.
 */

export interface TenantSettings {
  company_name: string;
  logo_url: string;
  primary_color: string;
  label_footer: string;
  updated_at: string | null;
}

export interface TenantSettingsResponse {
  ok: boolean;
  settings: TenantSettings;
}

const DEFAULT_SETTINGS: TenantSettings = {
  company_name: "",
  logo_url: "",
  primary_color: "#16a34a",
  label_footer: "",
  updated_at: null,
};

export async function getTenantSettings(): Promise<TenantSettings> {
  try {
    const res = await fetch("/api/tenant-settings", {
      method: "GET",
      credentials: "include",
    });
    if (!res.ok) return { ...DEFAULT_SETTINGS };
    const data: TenantSettingsResponse = await res.json();
    return data.settings ?? { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveTenantSettings(
  settings: Partial<TenantSettings>
): Promise<TenantSettings> {
  const res = await fetch("/api/tenant-settings", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Erro ao salvar configurações");
  }
  const data: TenantSettingsResponse = await res.json();
  return data.settings;
}
