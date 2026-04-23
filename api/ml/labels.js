// ─── Marcacao de etiquetas impressas ─────────────────────────────────────
//
// Rastreia quais pedidos ja tiveram a etiqueta baixada/impressa pelo
// operador. A MercadoLivrePage usa essa marcacao para filtrar pedidos
// "sem etiqueta impressa" (fila de trabalho do dia) vs "com etiqueta
// impressa" (auditoria de ja feitos).
//
// Endpoints:
//   POST /api/ml/labels/mark-printed    body: { order_ids: string[] }
//   POST /api/ml/labels/mark-unprinted  body: { order_ids: string[] }
//
// A UI chama mark-printed automaticamente depois do download do PDF em
// lote (ReviewPage.handleBatchExport) ou individual (handleExport).
// mark-unprinted existe pra corrigir o caso de alguem clicar por engano
// ou precisar reimprimir marcando como "pendente" de novo.

import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { setOrdersLabelPrinted } from "./_lib/storage.js";
import { recordAuditLog } from "../_lib/audit-log.js";
import { validate, LabelsMarkSchema } from "../_lib/validation.js";

function normalizeOrderIds(input) {
  if (!Array.isArray(input)) return [];
  return [
    ...new Set(
      input
        .map((value) => String(value ?? "").trim())
        .filter((value) => value.length > 0 && value.length < 64)
    ),
  ];
}

export default async function handler(request, response) {
  try {
    const { profile } = await requireAuthenticatedProfile(request);
    request.profile = profile;
  } catch (error) {
    const status = error?.statusCode || 401;
    return response
      .status(status)
      .json({ success: false, error: error?.message || "Nao autenticado." });
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({
      success: false,
      error: "Metodo nao suportado. Use POST.",
    });
  }

  // Sub-path: /api/ml/labels/mark-printed ou /mark-unprinted
  const rawPath = String(request.path || request.url || "");
  const markAsPrinted = /\/mark-printed(\?|$)/.test(rawPath);
  const markAsUnprinted = /\/mark-unprinted(\?|$)/.test(rawPath);

  if (!markAsPrinted && !markAsUnprinted) {
    return response.status(404).json({
      success: false,
      error: "Rota nao encontrada. Use /mark-printed ou /mark-unprinted.",
    });
  }

  const body = request.body || {};
  const rawIds = body.order_ids || body.orderIds || [];
  // Normaliza antes de validar pra zod aceitar ids com espaco/vazios
  const orderIds = normalizeOrderIds(rawIds);
  const validated = validate(LabelsMarkSchema, { order_ids: orderIds });
  if (!validated.ok) {
    return response.status(400).json({
      success: false,
      error: validated.error,
    });
  }

  const printedAt = markAsPrinted ? new Date().toISOString() : null;
  const affected = setOrdersLabelPrinted(orderIds, printedAt);

  recordAuditLog({
    req: request,
    action: markAsPrinted ? "labels.mark_printed" : "labels.mark_unprinted",
    targetType: "ml_order",
    targetId: orderIds.length === 1 ? orderIds[0] : `batch:${orderIds.length}`,
    payload: { order_ids: orderIds, printed_at: printedAt, affected },
  });

  return response.json({
    success: true,
    action: markAsPrinted ? "mark-printed" : "mark-unprinted",
    printed_at: printedAt,
    requested: orderIds.length,
    affected,
  });
}
