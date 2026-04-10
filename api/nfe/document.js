import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { getNfeDocument } from "./_lib/mercado-livre-faturador.js";

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
  }
  return false;
}

export default async function handler(request, response) {
  try {
    await requireAuthenticatedProfile(request);

    if (request.method !== "GET") {
      return response.status(405).json({ error: "Method not allowed" });
    }

    const orderId = request.query?.order_id || request.query?.orderId;
    const payload = await getNfeDocument(orderId, {
      forceRefresh: parseBoolean(request.query?.refresh),
    });
    return response.status(200).json(payload);
  } catch (error) {
    const statusCode =
      error instanceof Error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;

    return response.status(statusCode).json({
      error: error instanceof Error ? error.message : "Unknown error",
      entity: "nfe_document",
    });
  }
}
