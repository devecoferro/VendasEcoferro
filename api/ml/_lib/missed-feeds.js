// ═══════════════════════════════════════════════════════════════════
// Missed Feeds Recovery — busca notificacoes ML que nosso webhook nao
// recebeu (rede, downtime, ML desativou tópico por timeout, etc.).
//
// FONTE: developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes
//   ML guarda notificacoes nao confirmadas (sem HTTP 200 em 500ms) e
//   expoe endpoint pra recuperar:
//     GET /missed_feeds?app_id={app}&topic={topic}
//   Retorna ate N notificacoes ainda nao confirmadas. Cada uma tem mesmo
//   shape do webhook normal — basta processar via mesmo handler.
//
// USO: chamado de cron a cada 1h em server/index.js como safety net
// quando webhook desativa silenciosamente.
//
// Doc: https://developers.mercadolivre.com.br/pt_br/produto-receba-notificacoes
// ═══════════════════════════════════════════════════════════════════

import { ML_CLIENT_ID } from "../../_lib/app-config.js";
import { listConnections, getConnectionBySellerId } from "./storage.js";
import { ensureValidAccessToken } from "./mercado-livre.js";
import createLogger from "../../_lib/logger.js";
import { runMercadoLivreSync } from "../sync.js";
import { syncClaims, syncReturns } from "./mirror-sync.js";
import { refreshNfeFromNotification } from "../../nfe/_lib/mercado-livre-faturador.js";

const log = createLogger("ml-missed-feeds");

const RECOVERY_TOPICS = ["orders_v2", "shipments", "post_purchase", "invoices"];

/**
 * Busca notificacoes perdidas pra um topic especifico via ML API.
 * Retorna { items, status } — status permite ao caller distinguir 401
 * (token bad — abortar polling do seller) de outros erros transitorios.
 */
async function fetchMissedFeedsForTopic(accessToken, topic) {
  if (!ML_CLIENT_ID) {
    log.warn("ML_CLIENT_ID nao configurado — recovery desativado");
    return { items: [], status: 0 };
  }

  const url = `https://api.mercadolibre.com/missed_feeds?app_id=${encodeURIComponent(ML_CLIENT_ID)}&topic=${encodeURIComponent(topic)}`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) {
      log.warn(`missed_feeds nao OK (status ${response.status})`, {
        topic,
        status: response.status,
      });
      return { items: [], status: response.status };
    }
    const data = await response.json();
    // Schema: array de notificacoes ou objeto { messages: [...] }
    if (Array.isArray(data)) return { items: data, status: 200 };
    if (Array.isArray(data?.messages)) return { items: data.messages, status: 200 };
    return { items: [], status: 200 };
  } catch (err) {
    log.error(
      `Erro ao buscar missed_feeds topic=${topic}`,
      err instanceof Error ? err : new Error(String(err))
    );
    return { items: [], status: 0 };
  }
}

/**
 * Processa 1 notificacao perdida — replica logica do handler em
 * api/ml/notifications.js:104-162 mas chamando direto (sem HTTP).
 */
async function processNotification(notification) {
  const topic = String(notification?.topic || "");
  const sellerId = String(
    notification?.user_id ||
      notification?.resource?.match?.(/\/users\/(\d+)/i)?.[1] ||
      ""
  ).trim();

  if (!topic || !sellerId || !RECOVERY_TOPICS.includes(topic)) {
    return { processed: false, reason: "invalid_or_unsupported_topic" };
  }

  const connection = await getConnectionBySellerId(sellerId);
  if (!connection?.id) {
    return { processed: false, reason: "connection_not_found" };
  }

  const updatedFrom =
    connection.last_sync_at ||
    new Date(Date.now() - 15 * 60 * 1000).toISOString();

  try {
    if (topic === "post_purchase") {
      const claims = await syncClaims({
        connectionId: connection.id,
        updatedFrom,
        pageLimit: 3,
      });
      await syncReturns({ connectionId: connection.id, claims: claims.records });
      return { processed: true, topic };
    }
    if (topic === "invoices") {
      await refreshNfeFromNotification(notification, { sellerId });
      return { processed: true, topic };
    }
    // orders_v2 / shipments → sync incremental
    await runMercadoLivreSync({
      connectionId: connection.id,
      updatedFrom,
      pageLimit: 3,
    });
    return { processed: true, topic };
  } catch (err) {
    log.error(
      `Erro ao processar notificacao topic=${topic} seller=${sellerId}`,
      err instanceof Error ? err : new Error(String(err))
    );
    return { processed: false, reason: "process_error" };
  }
}

/**
 * Recupera notificacoes perdidas de TODOS os topics relevantes pra TODOS
 * os sellers conectados. Usa o token de cada conexao (cada seller tem o seu).
 *
 * Retorna estatistica agregada pra log/monitoramento.
 */
export async function recoverMissedFeeds() {
  const startedAt = Date.now();
  const connections = listConnections().filter((c) => c?.id);

  if (connections.length === 0) {
    return {
      ok: true,
      reason: "no_connections",
      total_recovered: 0,
      total_processed: 0,
      duration_ms: 0,
    };
  }

  let totalRecovered = 0;
  let totalProcessed = 0;
  const errors = [];

  for (const conn of connections) {
    try {
      const validConn = await ensureValidAccessToken(conn);
      if (!validConn?.access_token) continue;

      for (const topic of RECOVERY_TOPICS) {
        const { items: notifications, status } = await fetchMissedFeedsForTopic(
          validConn.access_token,
          topic
        );
        // 401: token bad apesar do refresh. ML rejeitou — refresh_token
        // tambem expirou ou conexao revogada. Pula os outros 3 topics
        // (mesmo seller, mesmo token, mesmo 401) e marca o erro pra log.
        if (status === 401) {
          errors.push({
            seller_id: conn.seller_id,
            connection_id: conn.id,
            reason: "token_unauthorized",
            topic,
          });
          log.warn(
            `seller=${conn.seller_id} (conn=${conn.id}) retornou 401 no topic ${topic} — abortando recovery dos demais topics. Reconectar a conta.`
          );
          break;
        }
        if (notifications.length === 0) continue;

        totalRecovered += notifications.length;
        log.info(
          `recovery: ${notifications.length} notificacoes perdidas seller=${conn.seller_id} topic=${topic}`
        );

        for (const notification of notifications) {
          const result = await processNotification(notification);
          if (result.processed) totalProcessed += 1;
          else if (result.reason !== "invalid_or_unsupported_topic") {
            errors.push({ topic, reason: result.reason });
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ seller_id: conn.seller_id, error: msg });
      log.error(
        `Erro no recovery seller=${conn.seller_id}`,
        err instanceof Error ? err : new Error(msg)
      );
    }
  }

  const duration_ms = Date.now() - startedAt;
  log.info(
    `recovery concluido: ${totalRecovered} encontradas, ${totalProcessed} processadas em ${duration_ms}ms`
  );

  return {
    ok: true,
    total_recovered: totalRecovered,
    total_processed: totalProcessed,
    errors: errors.slice(0, 10),
    duration_ms,
  };
}
