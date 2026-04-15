// Endpoint de Conferencia de Venda.
// Recebe um codigo lido pelo leitor USB (QR/barcode) e devolve:
//   1) A venda consolidada (com itens agrupados, quando ha pack)
//   2) As fotos de referencia do anuncio ML para cada item_id
//   3) O permalink do anuncio ML para abrir em nova aba se precisar
//
// O codigo lido pelo leitor e' normalmente o `sale_number` (impresso no
// QR da etiqueta SaleCardPreview — ver mapMLOrderToSaleData:
//   saleQrcodeValue = order.sale_number || order.order_id),
// mas o endpoint tambem aceita `order_id` puro para cobrir o caso em
// que o operador bipa outro QR (p.ex. o da NFe).

import { requireAuthenticatedProfile } from "../_lib/auth-server.js";
import { db } from "../_lib/db.js";
import { getLatestConnection } from "./_lib/storage.js";
import { ensureValidAccessToken } from "./_lib/mercado-livre.js";
import { consolidateOrders } from "./orders.js";

const PICTURES_CACHE_TTL_MS = 60 * 60 * 1000; // 1h — fotos do anuncio sao estaveis
const ML_ITEM_TIMEOUT_MS = 15000;
const picturesCache = new Map();

// Sufixos de thumbnail do ML. Trocamos por -O.jpg pra pegar a versao ~500px.
function upgradeImageUrl(url) {
  if (!url) return url;
  return url
    .replace("http://", "https://")
    .replace(/-[IDCF]\.jpg$/i, "-O.jpg");
}

function fetchWithTimeout(url, init = {}, timeoutMs = ML_ITEM_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timeoutId)
  );
}

async function fetchItemDetailsFromML(accessToken, itemId) {
  if (!accessToken || !itemId) {
    return { pictures: [], title: null, permalink: null };
  }

  const cached = picturesCache.get(itemId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      const fallback = { pictures: [], title: null, permalink: null };
      picturesCache.set(itemId, {
        data: fallback,
        expiresAt: Date.now() + 60 * 1000, // 1min de cache negativo
      });
      return fallback;
    }

    const data = await response.json();
    const pictures = Array.isArray(data?.pictures)
      ? data.pictures
          .filter((p) => p?.secure_url || p?.url)
          .map((p) => upgradeImageUrl(p.secure_url || p.url))
      : [];
    const result = {
      pictures,
      title: data?.title || null,
      permalink: data?.permalink || null,
    };

    picturesCache.set(itemId, {
      data: result,
      expiresAt: Date.now() + PICTURES_CACHE_TTL_MS,
    });
    return result;
  } catch {
    return { pictures: [], title: null, permalink: null };
  }
}

function findOrderRowsByCode(code) {
  const normalized = String(code || "").trim();
  if (!normalized) return [];

  // 1. Tenta por sale_number (valor mais comum no QR impresso pelo sistema).
  const bySaleNumber = db
    .prepare(
      `SELECT * FROM ml_orders WHERE sale_number = ? ORDER BY id ASC`
    )
    .all(normalized);
  if (bySaleNumber.length > 0) return bySaleNumber;

  // 2. Tenta por order_id (fallback — alguns QRs ML tem order_id puro).
  const byOrderId = db
    .prepare(
      `SELECT * FROM ml_orders WHERE order_id = ? ORDER BY id ASC`
    )
    .all(normalized);
  if (byOrderId.length > 0) return byOrderId;

  return [];
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    await requireAuthenticatedProfile(request);

    const rawCode = request.query.code;
    const code = typeof rawCode === "string" ? rawCode.trim() : "";
    if (!code) {
      return response.status(400).json({ error: "Parametro 'code' obrigatorio." });
    }

    const rows = findOrderRowsByCode(code);
    if (rows.length === 0) {
      return response
        .status(404)
        .json({ error: `Nenhuma venda encontrada para o codigo '${code}'.` });
    }

    const consolidated = consolidateOrders(rows);
    const order = consolidated[0];
    if (!order) {
      return response
        .status(404)
        .json({ error: `Venda invalida para o codigo '${code}'.` });
    }

    // Tokens ML sao opcionais — se nao tiver conexao, o frontend
    // ainda exibe os dados da venda, so sem as fotos do anuncio.
    const pictures = {};
    const items = {};
    const baseConnection = getLatestConnection();
    const accessToken = baseConnection?.access_token
      ? (await ensureValidAccessToken(baseConnection)).access_token
      : null;

    if (accessToken) {
      const uniqueItemIds = [
        ...new Set(
          (order.items || [])
            .map((item) => item.item_id)
            .filter((id) => typeof id === "string" && id.trim().length > 0)
        ),
      ];

      // Busca em paralelo — sao 1 a 5 anuncios tipicamente.
      const results = await Promise.all(
        uniqueItemIds.map(async (itemId) => {
          const detail = await fetchItemDetailsFromML(accessToken, itemId);
          return { itemId, detail };
        })
      );

      for (const { itemId, detail } of results) {
        pictures[itemId] = detail.pictures;
        items[itemId] = {
          title: detail.title,
          permalink: detail.permalink,
        };
      }
    }

    return response.status(200).json({
      order,
      pictures,
      items,
      has_ml_connection: Boolean(accessToken),
    });
  } catch (error) {
    const status = error?.statusCode || 500;
    return response.status(status).json({
      error: error instanceof Error ? error.message : "Erro desconhecido.",
    });
  }
}
