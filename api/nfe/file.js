import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { getNfeFile } from "./_lib/mercado-livre-faturador.js";

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
    const variant = request.query?.variant;
    const disposition = String(request.query?.disposition || "inline").trim().toLowerCase();
    const file = await getNfeFile(orderId, {
      variant,
      forceRefresh: parseBoolean(request.query?.refresh),
    });

    response.setHeader("Content-Type", file.contentType || "application/octet-stream");
    response.setHeader(
      "Content-Disposition",
      `${disposition === "attachment" ? "attachment" : "inline"}; filename=\"${file.fileName}\"`
    );
    return response.status(200).send(file.buffer);
  } catch (error) {
    const statusCode =
      error instanceof Error && typeof error.statusCode === "number"
        ? error.statusCode
        : 500;

    return response.status(statusCode).json({
      error: error instanceof Error ? error.message : "Unknown error",
      entity: "nfe_file",
    });
  }
}
