import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { getLatestConnection } from "./_lib/storage.js";
import {
  getLatestPrivateSellerCenterSnapshotByStore,
  getLatestPrivateSellerCenterSnapshotsByStoreAndTab,
  getLatestPrivateSellerCenterSnapshotsByStore,
  getPrivateSellerCenterSnapshotStatus,
  insertPrivateSellerCenterSnapshots,
  listPrivateSellerCenterSnapshots,
} from "./_lib/private-seller-center-storage.js";

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
      const store = request.query?.store;
      const selectedTab = request.query?.selected_tab || request.query?.selectedTab;
      const latestOnly = String(request.query?.latest || "").toLowerCase() === "true";

      const records = latestOnly
        ? store
          ? [
              getLatestPrivateSellerCenterSnapshotByStore({
                sellerId,
                store,
                selectedTab,
              }),
            ].filter(Boolean)
          : getLatestPrivateSellerCenterSnapshotsByStoreAndTab({ sellerId })
        : listPrivateSellerCenterSnapshots({
            sellerId,
            store,
            selectedTab,
            limit: request.query?.limit,
          });

      return response.status(200).json({
        status: "ok",
        seller_id: sellerId,
        snapshot_status: getPrivateSellerCenterSnapshotStatus({ sellerId }),
        records,
      });
    }

    if (request.method === "POST") {
      const body = parseRequestBody(request);
      const records = Array.isArray(body?.snapshots)
        ? body.snapshots
        : body?.snapshot
          ? [body.snapshot]
          : [body];

      const inserted = insertPrivateSellerCenterSnapshots(records, {
        connection_id: latestConnection?.id || null,
        seller_id: sellerId,
      });

      return response.status(200).json({
        status: "ok",
        inserted_count: inserted.length,
        snapshot_status: getPrivateSellerCenterSnapshotStatus({ sellerId }),
        records: inserted,
      });
    }

    return response.status(405).json({ error: "Method not allowed" });
  } catch (error) {
    const statusCode =
      error instanceof Error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;

    return response.status(statusCode).json({
      error: error instanceof Error ? error.message : "Unknown error",
      entity: "private_seller_center_snapshot",
    });
  }
}
