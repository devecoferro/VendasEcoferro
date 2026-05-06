// ─── Geração de etiquetas ML em lote (server-side) ─────────────────────
//
// Endpoint que gera um PDF consolidado com todas as etiquetas de envio
// de um bucket (today/upcoming) ou de uma lista explícita de order_ids.
//
// MOTIVAÇÃO: O frontend precisava esperar o carregamento completo da
// listagem operacional antes de habilitar o botão de impressão em lote.
// Com este endpoint, o backend já tem todos os shipment_ids no banco e
// pode gerar o PDF diretamente — igual ao ML Seller Center faz.
//
// A API do ML `shipment_labels` aceita múltiplos shipment_ids separados
// por vírgula e retorna um PDF único com todas as etiquetas concatenadas.
// Porém há limite de ~50 IDs por request, então fazemos chunking.
//
// Endpoints:
//   POST /api/ml/labels-batch
//   Body: { bucket?: "today"|"upcoming", order_ids?: string[], connection_id?: string }
//
// Retorna: PDF binário (application/pdf) com todas as etiquetas.

import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { ensureValidAccessToken } from "./_lib/mercado-livre.js";
import { getLatestConnection, getConnectionById, getOperationalOrders } from "./_lib/storage.js";
import { recordAuditLog } from "../_lib/audit-log.js";

// Máximo de shipment_ids por request à API do ML (evita 414 URI Too Long)
const ML_BATCH_CHUNK_SIZE = 50;
// Concorrência máxima de chunks simultâneos
const CHUNK_CONCURRENCY = 3;
// Timeout por chunk (ms)
const CHUNK_TIMEOUT_MS = 30000;

function normalizeNullable(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

/**
 * Extrai shipment_id de um pedido (row do banco mapeado).
 */
function extractShipmentId(order) {
  return (
    normalizeNullable(order.shipment_id) ||
    normalizeNullable(order.shipping_id) ||
    normalizeNullable(order.raw_data?.shipping_id) ||
    normalizeNullable(order.raw_data?.shipment_snapshot?.id) ||
    null
  );
}

/**
 * Extrai logistic_type de um pedido.
 */
function extractLogisticType(order) {
  return (
    normalizeNullable(order.logistic_type) ||
    normalizeNullable(order.raw_data?.shipment_snapshot?.logistic_type) ||
    normalizeNullable(order.raw_data?.shipping?.logistic_type) ||
    null
  );
}

/**
 * Filtra pedidos elegíveis para impressão de etiqueta ML:
 * - Deve ter shipment_id
 * - NÃO pode ser fulfillment (Full não tem etiqueta pública)
 * - Status deve ser ready_to_ship ou shipped
 */
function filterPrintableOrders(orders) {
  const printable = [];
  const skipped = { no_shipment: 0, fulfillment: 0, wrong_status: 0 };

  for (const order of orders) {
    const shipmentId = extractShipmentId(order);
    if (!shipmentId) {
      skipped.no_shipment++;
      continue;
    }

    const logisticType = extractLogisticType(order);
    if (logisticType === "fulfillment") {
      skipped.fulfillment++;
      continue;
    }

    // Status check: ready_to_ship ou shipped
    const status = (
      order.raw_data?.shipment_snapshot?.status ||
      order.order_status ||
      ""
    ).toLowerCase();
    if (!["ready_to_ship", "shipped"].includes(status)) {
      skipped.wrong_status++;
      continue;
    }

    printable.push({ order, shipmentId });
  }

  return { printable, skipped };
}

/**
 * Busca etiquetas do ML em batch (chunk de até ML_BATCH_CHUNK_SIZE IDs).
 * Retorna ArrayBuffer do PDF.
 */
async function fetchLabelChunk(shipmentIds, accessToken) {
  const idsParam = shipmentIds.join(",");
  const url = `https://api.mercadolibre.com/shipment_labels?shipment_ids=${encodeURIComponent(idsParam)}&response_type=pdf`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHUNK_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/pdf, application/octet-stream",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `ML API retornou ${response.status}: ${errorText.slice(0, 200)}`
      );
    }

    const buffer = await response.arrayBuffer();
    return { success: true, buffer, count: shipmentIds.length };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Concatena múltiplos PDFs em um único PDF usando pdf-lib.
 * Se houver apenas 1 chunk, retorna diretamente sem merge.
 */
async function mergePdfBuffers(buffers) {
  if (buffers.length === 0) return null;
  if (buffers.length === 1) return Buffer.from(buffers[0]);

  // Importa pdf-lib dinamicamente (pode não estar instalado)
  let PDFDocument;
  try {
    const pdfLib = await import("pdf-lib");
    PDFDocument = pdfLib.PDFDocument;
  } catch {
    // Fallback: retorna apenas o primeiro chunk se pdf-lib não disponível
    return Buffer.from(buffers[0]);
  }

  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    try {
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const page of pages) {
        merged.addPage(page);
      }
    } catch (err) {
      // Skip corrupted PDFs silently
      console.warn("[labels-batch] Skipping corrupted PDF chunk:", err.message);
    }
  }

  const bytes = await merged.save();
  return Buffer.from(bytes);
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

  const body = request.body || {};
  const bucket = body.bucket || null; // "today" | "upcoming" | null
  const orderIds = Array.isArray(body.order_ids) ? body.order_ids : [];
  const connectionId = body.connection_id || null;

  if (!bucket && orderIds.length === 0) {
    return response.status(400).json({
      success: false,
      error: "Informe 'bucket' (today/upcoming) ou 'order_ids' (lista de IDs).",
    });
  }

  try {
    // ── Resolve conexão ──────────────────────────────────────────────
    let connection;
    if (connectionId) {
      connection = getConnectionById(connectionId);
    }
    if (!connection) {
      connection = getLatestConnection();
    }
    if (!connection) {
      return response.status(400).json({
        success: false,
        error: "Nenhuma conexao ML encontrada.",
      });
    }

    // ── Busca pedidos operacionais ───────────────────────────────────
    const allOrders = getOperationalOrders({ connectionId: connection.id });

    let targetOrders;
    if (orderIds.length > 0) {
      // Modo explícito: filtra pelos IDs informados
      const idSet = new Set(orderIds.map((id) => String(id).trim()));
      targetOrders = allOrders.filter(
        (o) =>
          idSet.has(o.id) ||
          idSet.has(o.order_id) ||
          idSet.has(String(o.shipping_id || ""))
      );
    } else {
      // Modo bucket: usa a classificação do dashboard para filtrar
      // Importa a função de classificação do dashboard
      const { fetchMLLiveChipBucketsDetailed } = await import("./dashboard.js");
      const classification = await fetchMLLiveChipBucketsDetailed(connection);

      const bucketOrderIds = classification?.order_ids_by_bucket?.[bucket];
      if (!bucketOrderIds || bucketOrderIds.size === 0) {
        return response.status(200).json({
          success: true,
          message: `Nenhum pedido no bucket '${bucket}'.`,
          total_orders: 0,
          printed: 0,
        });
      }

      targetOrders = allOrders.filter(
        (o) => bucketOrderIds.has(o.id) || bucketOrderIds.has(o.order_id)
      );
    }

    // ── Filtra pedidos elegíveis para etiqueta ML ────────────────────
    const { printable, skipped } = filterPrintableOrders(targetOrders);

    if (printable.length === 0) {
      return response.status(200).json({
        success: true,
        message: "Nenhum pedido elegivel para impressao de etiqueta ML.",
        total_orders: targetOrders.length,
        printed: 0,
        skipped,
      });
    }

    // ── Deduplica por shipment_id (pedidos no mesmo pack = mesma etiqueta)
    const uniqueShipmentIds = [...new Set(printable.map((p) => p.shipmentId))];

    // ── Garante access_token válido ──────────────────────────────────
    const freshConnection = await ensureValidAccessToken(connection);
    const accessToken = freshConnection.access_token;

    // ── Divide em chunks e busca em paralelo controlado ──────────────
    const chunks = [];
    for (let i = 0; i < uniqueShipmentIds.length; i += ML_BATCH_CHUNK_SIZE) {
      chunks.push(uniqueShipmentIds.slice(i, i + ML_BATCH_CHUNK_SIZE));
    }

    const pdfBuffers = [];
    const errors = [];

    for (let i = 0; i < chunks.length; i += CHUNK_CONCURRENCY) {
      const concurrentChunks = chunks.slice(i, i + CHUNK_CONCURRENCY);
      const results = await Promise.allSettled(
        concurrentChunks.map((chunk) => fetchLabelChunk(chunk, accessToken))
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value.success) {
          pdfBuffers.push(result.value.buffer);
        } else {
          const reason =
            result.status === "rejected"
              ? result.reason?.message || "Erro desconhecido"
              : "Chunk falhou";
          errors.push(reason);
        }
      }
    }

    if (pdfBuffers.length === 0) {
      return response.status(502).json({
        success: false,
        error: "Falha ao buscar etiquetas no ML.",
        details: errors.slice(0, 5),
        total_shipments: uniqueShipmentIds.length,
      });
    }

    // ── Merge dos PDFs ───────────────────────────────────────────────
    const mergedPdf = await mergePdfBuffers(pdfBuffers);

    if (!mergedPdf || mergedPdf.length === 0) {
      return response.status(500).json({
        success: false,
        error: "Falha ao consolidar PDFs das etiquetas.",
      });
    }

    // ── Audit log ────────────────────────────────────────────────────
    recordAuditLog({
      req: request,
      action: "labels_batch.generate",
      targetType: "ml_shipment",
      targetId: `batch:${uniqueShipmentIds.length}`,
      payload: {
        bucket,
        order_ids_requested: orderIds.length || null,
        total_orders: targetOrders.length,
        printable_orders: printable.length,
        unique_shipments: uniqueShipmentIds.length,
        pdf_chunks: chunks.length,
        pdf_chunks_ok: pdfBuffers.length,
        pdf_chunks_failed: errors.length,
        skipped,
      },
    });

    // ── Retorna PDF ──────────────────────────────────────────────────
    const filename = `etiquetas-ml-batch-${bucket || "custom"}-${new Date().toISOString().slice(0, 10)}.pdf`;
    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    response.setHeader("Content-Length", mergedPdf.length);
    response.setHeader("X-Labels-Total-Orders", String(targetOrders.length));
    response.setHeader("X-Labels-Printed", String(uniqueShipmentIds.length));
    response.setHeader("X-Labels-Skipped-Fulfillment", String(skipped.fulfillment));
    response.setHeader("X-Labels-Skipped-NoShipment", String(skipped.no_shipment));
    response.setHeader("X-Labels-Errors", String(errors.length));

    return response.status(200).end(mergedPdf);
  } catch (error) {
    console.error("[labels-batch] Error:", error);
    return response.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Erro interno.",
    });
  }
}
