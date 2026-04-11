// SSE (Server-Sent Events) para notificar o frontend quando um sync termina.
// Isso evita polling pesado — o frontend recebe um push e recarrega os dados.

const clients = new Set();
let lastEventId = 0;

/**
 * Notifica todos os clientes SSE conectados que um sync foi concluído.
 * Chamado pelo auto-sync e pelo webhook de notificações.
 */
export function broadcastSyncComplete(details = {}) {
  lastEventId += 1;
  const payload = JSON.stringify({
    type: "sync_complete",
    id: lastEventId,
    timestamp: new Date().toISOString(),
    ...details,
  });

  for (const res of clients) {
    try {
      res.write(`id: ${lastEventId}\n`);
      res.write(`data: ${payload}\n\n`);
    } catch {
      clients.delete(res);
    }
  }
}

/**
 * Handler SSE — mantém conexão aberta e envia eventos quando sync completa.
 * GET /api/ml/sync-events
 */
export default function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  // Headers SSE
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // Desabilita buffering em proxies (nginx/coolify)
  });

  // Heartbeat a cada 30s para manter a conexão viva
  const heartbeat = setInterval(() => {
    try {
      response.write(": heartbeat\n\n");
    } catch {
      clearInterval(heartbeat);
      clients.delete(response);
    }
  }, 30000);

  // Envia evento inicial de conexão
  response.write(`data: ${JSON.stringify({ type: "connected", timestamp: new Date().toISOString() })}\n\n`);

  clients.add(response);

  // Limpa quando o cliente desconecta
  request.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(response);
  });
}
