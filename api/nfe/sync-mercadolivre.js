import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { syncNfeWithMercadoLivre } from "./_lib/mercado-livre-faturador.js";

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
  try {
    await requireAuthenticatedProfile(request);

    if (request.method !== "POST") {
      return response.status(405).json({ error: "Method not allowed" });
    }

    const body = parseBody(request);
    const orderId = body.order_id || body.orderId;
    const payload = await syncNfeWithMercadoLivre(orderId);
    return response.status(200).json(payload);
  } catch (error) {
    const statusCode =
      error instanceof Error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;

    return response.status(statusCode).json({
      error: error instanceof Error ? error.message : "Unknown error",
      entity: "nfe_sync_mercadolivre",
    });
  }
}
