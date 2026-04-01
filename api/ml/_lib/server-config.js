export const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://gyaddryvtuzllcggorjc.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_USdCDZTlvuXFTOBlAvYSpQ_ne5ka8Ee";

export const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  "";

export function getSupabaseHeaders({ service = false, extra = {} } = {}) {
  const key =
    service && SUPABASE_SERVICE_ROLE_KEY
      ? SUPABASE_SERVICE_ROLE_KEY
      : SUPABASE_PUBLISHABLE_KEY;

  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra,
  };
}

export function hasServiceRoleKey() {
  return Boolean(SUPABASE_SERVICE_ROLE_KEY);
}

