// ─── Debug Reports Service ───────────────────────────────────────────
//
// Cliente pra /api/debug-reports. Permite criar, listar, atualizar e
// deletar reports de bugs/sugestões/dúvidas.

export type DebugReportType = "bug" | "suggestion" | "question";
export type DebugReportStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "closed";
export type DebugReportPriority = "low" | "medium" | "high";

export interface DebugReport {
  id: string;
  user_id: string;
  username: string;
  type: DebugReportType;
  title: string;
  description: string;
  screen: string | null;
  priority: DebugReportPriority;
  screenshots: string[]; // filenames
  status: DebugReportStatus;
  admin_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DebugReportCreateInput {
  type: DebugReportType;
  title: string;
  description: string;
  screen?: string | null;
  priority?: DebugReportPriority;
  screenshots?: string[]; // data URLs (base64)
}

export interface DebugReportsSummary {
  total: number;
  by_status: Record<DebugReportStatus, number>;
  by_type: Record<DebugReportType, number>;
  by_priority: Record<DebugReportPriority, number>;
}

async function jsonOrThrow<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => null)) as
    | (T & { success?: boolean; error?: string })
    | null;
  if (!response.ok || !data || data.success === false) {
    const message =
      data?.error || `Erro HTTP ${response.status} ao chamar debug-reports.`;
    throw new Error(message);
  }
  return data;
}

export async function listDebugReports(params?: {
  status?: DebugReportStatus;
  type?: DebugReportType;
}): Promise<{ reports: DebugReport[]; is_admin: boolean }> {
  const query = new URLSearchParams();
  if (params?.status) query.set("status", params.status);
  if (params?.type) query.set("type", params.type);
  const qs = query.toString();
  const url = `/api/debug-reports${qs ? `?${qs}` : ""}`;
  const response = await fetch(url, { credentials: "include" });
  const data = await jsonOrThrow<{
    success: true;
    reports: DebugReport[];
    is_admin: boolean;
  }>(response);
  return { reports: data.reports, is_admin: data.is_admin };
}

export async function createDebugReport(
  input: DebugReportCreateInput
): Promise<DebugReport> {
  const response = await fetch("/api/debug-reports", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await jsonOrThrow<{ success: true; report: DebugReport }>(
    response
  );
  return data.report;
}

export async function updateDebugReport(
  id: string,
  updates: Partial<Pick<DebugReport, "status" | "admin_notes" | "priority">>
): Promise<DebugReport> {
  const response = await fetch(
    `/api/debug-reports?id=${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    }
  );
  const data = await jsonOrThrow<{ success: true; report: DebugReport }>(
    response
  );
  return data.report;
}

export async function deleteDebugReport(id: string): Promise<void> {
  const response = await fetch(
    `/api/debug-reports?id=${encodeURIComponent(id)}`,
    { method: "DELETE", credentials: "include" }
  );
  await jsonOrThrow<{ success: true }>(response);
}

/** URL pra exibir imagem (usa credenciais do cookie de sessão). */
export function getScreenshotUrl(filename: string): string {
  return `/api/debug-reports/screenshot?file=${encodeURIComponent(filename)}`;
}

/**
 * Converte um File (input type=file) em data URL base64.
 * Throws se o arquivo for > 2MB ou não for imagem.
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Apenas imagens são aceitas."));
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      reject(new Error("Imagem muito grande (máx 2 MB)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("Falha ao ler arquivo."));
    };
    reader.onerror = () => reject(new Error("Falha ao ler arquivo."));
    reader.readAsDataURL(file);
  });
}
