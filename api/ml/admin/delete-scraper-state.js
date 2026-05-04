// Endpoint temporário para deletar storage state per-connection
// DELETE /api/ml/admin/delete-scraper-state?connection_id=X
import fs from "node:fs";
import path from "node:path";
import { requireAdmin } from "../../_lib/auth-server.js";
import { DATA_DIR } from "../../_lib/app-config.js";

export default async function handler(request, response) {
  try {
    await requireAdmin(request);
  } catch (error) {
    return response.status(401).json({ error: "Acesso negado." });
  }
  if (request.method !== "DELETE" && request.method !== "POST") {
    return response.status(405).json({ error: "Use DELETE ou POST." });
  }
  const connectionId = request.query?.connection_id || request.body?.connection_id;
  if (!connectionId) {
    return response.status(400).json({ error: "connection_id é obrigatório." });
  }
  const statePath = path.join(
    DATA_DIR, "playwright",
    `ml-seller-center-state-${connectionId}.json`
  );
  if (!fs.existsSync(statePath)) {
    return response.status(404).json({ error: "Arquivo não encontrado.", path: statePath });
  }
  try {
    fs.unlinkSync(statePath);
    return response.status(200).json({ success: true, deleted: statePath });
  } catch (err) {
    return response.status(500).json({ error: "Falha ao deletar.", detail: err.message });
  }
}
