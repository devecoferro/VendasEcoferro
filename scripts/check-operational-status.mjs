import { resolveAdminCredentials } from "./_lib/admin-credentials.mjs";

const baseUrl = process.env.ECOFERRO_CAPTURE_BASE_URL || "https://vendas.ecoferro.com.br";
const orderId = process.argv[2] || "2000015863492838";
const adminCredentials = resolveAdminCredentials();

function normalizeSetCookieHeader(headerValue) {
  if (!headerValue) return "";
  const rawHeaders = Array.isArray(headerValue) ? headerValue : [headerValue];
  return rawHeaders
    .map((entry) => String(entry || "").split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function loginAndGetCookie() {
  const response = await fetch(`${baseUrl}/api/app-auth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
      body: JSON.stringify({
        action: "login",
        username: adminCredentials.username,
        password: adminCredentials.password,
      }),
    });

  const cookie = normalizeSetCookieHeader(response.headers.getSetCookie?.() || response.headers.get("set-cookie"));
  if (!response.ok || !cookie) {
    const payload = await response.text().catch(() => "");
    throw new Error(`Falha no login do Ecoferro (${response.status}): ${payload}`);
  }

  return cookie;
}

async function requestJson(cookie, method, route, body = null) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(body
        ? {
            "Content-Type": "application/json",
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => null);
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

const cookie = await loginAndGetCookie();
const nfeDocument = await requestJson(
  cookie,
  "GET",
  `/api/nfe/document?order_id=${encodeURIComponent(orderId)}&refresh=true`
);
const nfeSync = await requestJson(cookie, "POST", "/api/nfe/sync-mercadolivre", {
  order_id: orderId,
});
const claimsSync = await requestJson(cookie, "POST", "/api/ml/claims", { action: "sync" });
const returnsSync = await requestJson(cookie, "POST", "/api/ml/returns", { action: "sync" });
const dashboard = await requestJson(cookie, "GET", "/api/ml/dashboard");

console.log(
  JSON.stringify(
    {
      status: "ok",
      order_id: orderId,
      nfe_document: {
        ok: nfeDocument.ok,
        status: nfeDocument.status,
        summary: nfeDocument.payload
          ? {
              status: nfeDocument.payload.status,
              invoice_number: nfeDocument.payload.invoice_number,
              invoice_series: nfeDocument.payload.invoice_series,
              invoice_key: nfeDocument.payload.invoice_key,
              authorization_protocol: nfeDocument.payload.authorization_protocol,
              ml_sync_status: nfeDocument.payload.ml_sync_status,
              has_danfe: Boolean(nfeDocument.payload.danfe?.available),
              has_xml: Boolean(nfeDocument.payload.xml?.available),
            }
          : null,
      },
      nfe_sync: {
        ok: nfeSync.ok,
        status: nfeSync.status,
        payload: nfeSync.payload,
      },
      claims_sync: {
        ok: claimsSync.ok,
        status: claimsSync.status,
        payload: claimsSync.payload,
      },
      returns_sync: {
        ok: returnsSync.ok,
        status: returnsSync.status,
        payload: returnsSync.payload,
      },
      dashboard_queues: dashboard.payload?.operational_queues || null,
      post_sale_overview: dashboard.payload?.post_sale_overview || null,
    },
    null,
    2
  )
);
