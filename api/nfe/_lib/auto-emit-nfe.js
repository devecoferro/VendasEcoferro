// Emissão automática de NF-e: 30s depois que ML sinaliza invoice_pending,
// o sistema emite a NF-e pelo Faturador automaticamente.
//
// Rodado por cron no server/index.js a cada 30s.
// Usa o token da conexão ML ativa. Itera pedidos invoice_pending,
// verifica tempo desde que ficou pending, e tenta emitir.

import { db } from "../../_lib/db.js";
import { getLatestConnection } from "../../ml/_lib/storage.js";
import { getNfeDocumentByOrderId } from "./nfe-storage.js";
import { generateNfe } from "./mercado-livre-faturador.js";
import createLogger from "../../_lib/logger.js";

const log = createLogger("auto-emit-nfe");

// Tempo mínimo desde que ML marcou invoice_pending antes de tentar emitir.
// Evita disparar antes do ML ter propagado todos os dados fiscais.
const MIN_WAIT_MS = 30 * 1000; // 30 segundos

// Orders processadas recentemente (dedup) — evita re-tentar em loop curto.
// Ordem já emitida ou bloqueada fica aqui por 10 minutos.
const recentlyProcessed = new Map(); // order_id → timestamp
const PROCESSED_TTL_MS = 10 * 60 * 1000;

// Sweep periódico pra evitar crescimento indefinido do Map.
// Antes, cleanup só acontecia ao consultar order específica (wasRecentlyProcessed);
// em burst de muitas ordens com consulta esparsa depois, a memória não voltava.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - PROCESSED_TTL_MS;
  for (const [orderId, ts] of recentlyProcessed.entries()) {
    if (ts < cutoff) recentlyProcessed.delete(orderId);
  }
}, SWEEP_INTERVAL_MS).unref();

function nowMs() {
  return Date.now();
}

function wasRecentlyProcessed(orderId) {
  const ts = recentlyProcessed.get(String(orderId));
  if (!ts) return false;
  if (nowMs() - ts > PROCESSED_TTL_MS) {
    recentlyProcessed.delete(String(orderId));
    return false;
  }
  return true;
}

function markProcessed(orderId) {
  recentlyProcessed.set(String(orderId), nowMs());
}

// Busca pedidos com substatus invoice_pending no DB (sincronizados).
// Considera apenas pedidos recentes (últimos 7 dias) para evitar processar
// histórico antigo.
// NFE-3: exclui pedidos que JÁ têm NF-e em nfe_documents com status terminal
// ou em progresso (authorized/emitting/pending_configuration). Antes, o filtro
// só olhava raw_data que podia estar stale — causando tentativas redundantes
// de emissão em cima de NF-es já emitidas manualmente.
function findInvoicePendingOrders(connectionId) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return db
    .prepare(
      `SELECT o.order_id, o.sale_date, o.raw_data
       FROM ml_orders o
       WHERE o.connection_id = ?
         AND o.sale_date > ?
         AND lower(COALESCE(json_extract(o.raw_data, '$.shipment_snapshot.status'), '')) = 'ready_to_ship'
         AND lower(COALESCE(json_extract(o.raw_data, '$.shipment_snapshot.substatus'), '')) = 'invoice_pending'
         AND lower(COALESCE(json_extract(o.raw_data, '$.status'), o.order_status, '')) IN ('paid', 'confirmed')
         AND NOT EXISTS (
           SELECT 1 FROM nfe_documents n
            WHERE n.order_id = o.order_id
              AND lower(COALESCE(n.status, '')) IN ('authorized', 'emitting', 'pending_configuration')
         )
       ORDER BY o.sale_date DESC
       LIMIT 100`
    )
    .all(connectionId, sevenDaysAgo);
}

// Extrai timestamp mais recente de quando o pedido entrou em invoice_pending.
// Procura em status_history.date_ready_to_ship, fallback para sale_date.
function getInvoicePendingSince(order) {
  try {
    const rawData =
      typeof order.raw_data === "string"
        ? JSON.parse(order.raw_data)
        : order.raw_data || {};
    const history = rawData?.shipment_snapshot?.status_history || {};
    const whenReady = history.date_ready_to_ship;
    if (whenReady) return new Date(whenReady).getTime();
    if (order.sale_date) return new Date(order.sale_date).getTime();
  } catch {
    // fallthrough
  }
  return Date.now();
}

export async function runAutoEmitNfe() {
  const connection = getLatestConnection();
  if (!connection?.id || !connection?.seller_id) {
    return { skipped: true, reason: "no_connection" };
  }

  const orders = findInvoicePendingOrders(connection.id);
  if (orders.length === 0) {
    return { processed: 0, emitted: 0, skipped: 0, not_ready: 0 };
  }

  let emitted = 0;
  let skipped = 0;
  let notReady = 0;
  let failed = 0;
  let blocked = 0;
  const nowAt = nowMs();

  for (const order of orders) {
    const orderId = String(order.order_id);

    // Dedup: evita reprocessar mesmo pedido várias vezes em sequência
    if (wasRecentlyProcessed(orderId)) {
      skipped++;
      continue;
    }

    // Verifica se já passou o tempo mínimo desde que ficou invoice_pending
    const sinceMs = nowAt - getInvoicePendingSince(order);
    if (sinceMs < MIN_WAIT_MS) {
      notReady++;
      continue;
    }

    // Verifica se já existe NF-e emitida
    const existing = getNfeDocumentByOrderId(connection.seller_id, orderId);
    if (existing?.status === "authorized") {
      markProcessed(orderId);
      skipped++;
      continue;
    }

    // Tenta emitir
    try {
      const result = await generateNfe(orderId);
      markProcessed(orderId);

      if (result.action === "generate_requested" || result.action === "noop_existing_invoice") {
        emitted++;
        log.info(`NF-e emitida automaticamente: pedido ${orderId}`);
      } else if (result.action === "blocked") {
        blocked++;
      } else if (result.action === "generate_failed") {
        failed++;
      }
    } catch (error) {
      failed++;
      log.warn(`Auto-emit NF-e falhou para pedido ${orderId}: ${error?.message || error}`);
    }
  }

  if (emitted > 0 || failed > 0 || blocked > 0) {
    log.info(
      `Auto-emit NF-e: ${emitted} emitida(s), ${blocked} bloqueada(s), ${failed} falha(s), ${skipped} ignorada(s), ${notReady} aguardando tempo mínimo (de ${orders.length} invoice_pending)`
    );
  }

  return { processed: orders.length, emitted, blocked, failed, skipped, not_ready: notReady };
}
