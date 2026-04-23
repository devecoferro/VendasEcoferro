// ─── Proxy de imagens do Mercado Livre ──────────────────────────────────
//
// Browser bloqueia leitura de pixels (canvas / fetch+blob) de imagens
// servidas com CORS restrito. ML serve thumbnails em http2.mlstatic.com
// e nem sempre tem header CORS adequado.
//
// Quando o frontend precisa do BYTE da imagem (pra colocar em PDF via
// jsPDF, por exemplo), passa pelo proxy. O servidor faz fetch da URL,
// valida o host contra a whitelist (defesa SSRF), e devolve o conteudo.
//
// Whitelist EXIGIDA — sem ela qualquer um podia usar o proxy pra varrer
// a rede interna ou esconder origin de requests maliciosos. So liberamos
// hosts de imagem do ML porque sao os unicos que precisam.
//
// Endpoint:
//   GET /api/ml/image-proxy?url=https://http2.mlstatic.com/...
//
// Autenticado (requer sessao valida) pra impedir uso anonimo do proxy.

import { requireAuthenticatedProfile } from "../_lib/auth-server.js";

// Hosts permitidos. Subdominios validados via endsWith ("." + base).
const ALLOWED_HOSTS = [
  "mlstatic.com",
  "mercadolibre.com",
  "mercadolivre.com.br",
];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB
const FETCH_TIMEOUT_MS = 10_000;

// Cache LRU em memoria — evita re-fetch da mesma thumbnail em cada geracao
// de PDF. Thumbnails do ML sao imutaveis pro mesmo hash na URL, entao cache
// longo e seguro. Limite por numero de entries (nao bytes) pra evitar leak
// em caso de uso anormal.
const IMAGE_CACHE_MAX_ENTRIES = 500;
const IMAGE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const imageCache = new Map(); // url → { buffer, contentType, expiresAt }

function cacheGet(url) {
  const entry = imageCache.get(url);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    imageCache.delete(url);
    return null;
  }
  // LRU: re-insere no final (hash preserva ordem de insercao)
  imageCache.delete(url);
  imageCache.set(url, entry);
  return entry;
}

function cacheSet(url, buffer, contentType) {
  // Evict LRU (primeiro entry) quando atinge o limite
  while (imageCache.size >= IMAGE_CACHE_MAX_ENTRIES) {
    const firstKey = imageCache.keys().next().value;
    if (firstKey == null) break;
    imageCache.delete(firstKey);
  }
  imageCache.set(url, {
    buffer,
    contentType,
    expiresAt: Date.now() + IMAGE_CACHE_TTL_MS,
  });
}

function isHostAllowed(hostname) {
  const lower = String(hostname || "").toLowerCase();
  return ALLOWED_HOSTS.some(
    (allowed) => lower === allowed || lower.endsWith("." + allowed)
  );
}

export default async function handler(request, response) {
  try {
    await requireAuthenticatedProfile(request);
  } catch (error) {
    const status = error?.statusCode || 401;
    return response
      .status(status)
      .json({ error: error?.message || "Nao autenticado." });
  }

  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Use GET." });
  }

  const rawUrl = String(request.query?.url || "").trim();
  if (!rawUrl) {
    return response.status(400).json({ error: "Parametro url obrigatorio." });
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return response.status(400).json({ error: "URL invalida." });
  }

  // Apenas https — evita downgrade pra http inseguro
  if (parsed.protocol !== "https:") {
    return response.status(400).json({ error: "Apenas https e suportado." });
  }

  if (!isHostAllowed(parsed.hostname)) {
    return response.status(403).json({
      error: `Host nao permitido: ${parsed.hostname}. Whitelist: ${ALLOWED_HOSTS.join(", ")}`,
    });
  }

  // Cache hit — serve direto da memoria sem tocar o upstream
  const normalizedUrl = parsed.toString();
  const cached = cacheGet(normalizedUrl);
  if (cached) {
    response.setHeader("Content-Type", cached.contentType);
    response.setHeader("Cache-Control", "public, max-age=3600, immutable");
    response.setHeader("Content-Length", String(cached.buffer.length));
    response.setHeader("X-Image-Cache", "HIT");
    return response.status(200).send(cached.buffer);
  }

  // Fetch com timeout pra evitar hang em URL morta
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(parsed.toString(), {
      signal: controller.signal,
      headers: {
        // Mascara como browser regular pra evitar bloqueio por user-agent
        "User-Agent":
          "Mozilla/5.0 (compatible; VendasEcoferro/1.0; image-proxy)",
        Accept: "image/*,*/*;q=0.8",
      },
    });

    if (!upstream.ok) {
      return response.status(upstream.status).json({
        error: `Upstream retornou ${upstream.status}`,
      });
    }

    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    if (!contentType.toLowerCase().startsWith("image/")) {
      return response.status(415).json({
        error: `Tipo nao suportado: ${contentType}`,
      });
    }

    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (contentLength > MAX_IMAGE_BYTES) {
      return response.status(413).json({
        error: `Imagem muito grande: ${contentLength} bytes (max ${MAX_IMAGE_BYTES})`,
      });
    }

    const arrayBuffer = await upstream.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_IMAGE_BYTES) {
      return response.status(413).json({
        error: `Imagem muito grande apos download: ${arrayBuffer.byteLength} bytes`,
      });
    }

    const buffer = Buffer.from(arrayBuffer);

    // Popula cache in-memory pro proximo request da mesma URL
    cacheSet(normalizedUrl, buffer, contentType);

    // Cache no browser por 1h — thumbnails do ML sao imutaveis pra mesmo
    // hash na URL, entao seguro cachear forte.
    response.setHeader("Content-Type", contentType);
    response.setHeader("Cache-Control", "public, max-age=3600, immutable");
    response.setHeader("Content-Length", String(buffer.length));
    response.setHeader("X-Image-Cache", "MISS");
    return response.status(200).send(buffer);
  } catch (error) {
    if (error?.name === "AbortError") {
      return response.status(504).json({ error: "Timeout ao buscar imagem." });
    }
    console.error("[image-proxy] Falha:", error);
    return response.status(502).json({
      error: error?.message || "Falha ao buscar imagem do upstream.",
    });
  } finally {
    clearTimeout(timeout);
  }
}
