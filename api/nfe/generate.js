import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { generateNfe } from "./_lib/mercado-livre-faturador.js";
import { onNfeEmitted, onNfeFailed } from "../_lib/obsidian-sync.js";
import { recordAuditLog } from "../_lib/audit-log.js";

function parseBody(request) {
  if (!request.body) return {};
  if (typeof request.body === "string") {
    try {
      return JSON.parse(request.body);
    } catch {
      return {};
    }
  }
  return request.body;
}

export default async function handler(request, response) {
  let orderId = null;
  try {
    const { profile } = await requireAuthenticatedProfile(request);
    request.profile = profile;

    if (request.method !== "POST") {
      return response.status(405).json({ error: "Method not allowed" });
    }

    const body = parseBody(request);
    orderId = body.order_id || body.orderId;
    const payload = await generateNfe(orderId);
    onNfeEmitted(orderId, payload?.nfe_number || payload?.chave || "—").catch(() => {});
    recordAuditLog({
      req: request,
      action: "nfe.generate",
      targetType: "ml_order",
      targetId: String(orderId || ""),
      payload: {
        nfe_number: payload?.nfe_number || null,
        chave: payload?.chave || null,
      },
    });
    return response.status(200).json(payload);
  } catch (error) {
    const statusCode =
      error instanceof Error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;

    onNfeFailed(orderId, error).catch(() => {});
    recordAuditLog({
      req: request,
      action: "nfe.generate.failed",
      targetType: "ml_order",
      targetId: String(orderId || ""),
      payload: { error: error instanceof Error ? error.message : String(error) },
    });
    return response.status(statusCode).json({
      error: error instanceof Error ? error.message : "Unknown error",
      entity: "nfe_generate",
    });
  }
}
