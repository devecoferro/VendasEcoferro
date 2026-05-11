/**
 * Hook para carregar e atualizar as configurações de branding do tenant.
 * Faz cache em memória para evitar requests repetidos durante a sessão.
 */

import { useState, useEffect, useCallback } from "react";
import {
  getTenantSettings,
  saveTenantSettings,
  type TenantSettings,
} from "@/services/tenantSettingsService";

interface UseTenantSettingsState {
  settings: TenantSettings | null;
  loading: boolean;
  error: string | null;
  save: (patch: Partial<TenantSettings>) => Promise<void>;
  reload: () => Promise<void>;
}

// Cache em memória para a sessão atual — evita fetch repetido ao navegar.
let _cachedSettings: TenantSettings | null = null;

export function useTenantSettings(): UseTenantSettingsState {
  const [settings, setSettings] = useState<TenantSettings | null>(_cachedSettings);
  const [loading, setLoading] = useState(!_cachedSettings);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTenantSettings();
      _cachedSettings = data;
      setSettings(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar configurações");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!_cachedSettings) {
      void load();
    }
  }, [load]);

  const save = useCallback(async (patch: Partial<TenantSettings>) => {
    setError(null);
    try {
      const updated = await saveTenantSettings(patch);
      _cachedSettings = updated;
      setSettings(updated);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro ao salvar";
      setError(msg);
      throw e;
    }
  }, []);

  return { settings, loading, error, save, reload: load };
}
