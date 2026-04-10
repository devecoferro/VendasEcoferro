import { resolveAdminCredentials } from "./_lib/admin-credentials.mjs";

const baseUrl = process.env.ECOFERRO_CAPTURE_BASE_URL || "https://vendas.ecoferro.com.br";
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
  const startedAt = performance.now();
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
  const durationMs = Math.round(performance.now() - startedAt);
  const cookie = normalizeSetCookieHeader(
    response.headers.getSetCookie?.() || response.headers.get("set-cookie")
  );

  if (!response.ok || !cookie) {
    const payload = await response.text().catch(() => "");
    throw new Error(`Falha no login (${response.status}, ${durationMs}ms): ${payload}`);
  }

  return { cookie, durationMs };
}

async function requestJson(cookie, route) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${route}`, {
    headers: {
      Cookie: cookie,
    },
  });
  const durationMs = Math.round(performance.now() - startedAt);
  const text = await response.text();

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }

  return {
    route,
    ok: response.ok,
    status: response.status,
    duration_ms: durationMs,
    text_length: text.length,
    payload,
  };
}

const { cookie, durationMs: loginMs } = await loginAndGetCookie();

const routes = [
  "/api/ml/dashboard",
  "/api/ml/orders?scope=operational&view=dashboard",
  "/api/ml/orders?scope=operational&view=dashboard&limit=250",
  "/api/ml/private-seller-center-comparison",
];

const results = [];
for (const route of routes) {
  results.push(await requestJson(cookie, route));
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      login_ms: loginMs,
      results: results.map((entry) => ({
        route: entry.route,
        ok: entry.ok,
        status: entry.status,
        duration_ms: entry.duration_ms,
        text_length: entry.text_length,
        orders_count: Array.isArray(entry.payload?.orders) ? entry.payload.orders.length : null,
        deposits_count: Array.isArray(entry.payload?.deposits) ? entry.payload.deposits.length : null,
        views_count: Array.isArray(entry.payload?.views) ? entry.payload.views.length : null,
        error: entry.payload?.error || null,
      })),
    },
    null,
    2
  )
);
