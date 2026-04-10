import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { getLatestConnection } from "./_lib/storage.js";
import { listMirrorEntities, getSellerCenterMirrorOverview } from "./_lib/mirror-storage.js";
import { syncClaims } from "./_lib/mirror-sync.js";

function parseRequestBody(request) {
  if (!request.body) return {};
  return typeof request.body === "string" ? JSON.parse(request.body) : request.body;
}

export default async function handler(request, response) {
  try {
    await requireAuthenticatedProfile(request);

    const latestConnection = getLatestConnection();
    const sellerId = latestConnection?.seller_id || null;

    if (request.method === "GET") {
      const limit = request.query?.limit;
      return response.status(200).json({
        entity: "claims",
        status: "partial",
        incomplete: true,
        seller_id: sellerId,
        note: "Sincronizacao oficial de reclamacoes habilitada. O espelhamento Seller Center continua parcial ate a calibracao completa da regra de paridade.",
        records: listMirrorEntities("claims", { sellerId, limit }),
        overview: getSellerCenterMirrorOverview(sellerId),
      });
    }

    if (request.method === "POST") {
      const body = parseRequestBody(request);
      if ((body?.action || "sync") !== "sync") {
        return response.status(400).json({ error: "Unsupported action" });
      }

      const result = await syncClaims({
        connectionId: latestConnection?.id || null,
        sellerId,
        updatedFrom: body?.updated_from || null,
        pageLimit: body?.page_limit || null,
      });
      return response.status(200).json(result);
    }

    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    return response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error",
      entity: "claims",
    });
  }
}
