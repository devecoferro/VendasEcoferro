import fs from "node:fs/promises";
import path from "node:path";
import { resolveAdminCredentials } from "./_lib/admin-credentials.mjs";

const projectRoot = process.cwd();
const reportPath =
  process.argv[2] ||
  path.join(projectRoot, "data", "playwright", "seller-center-live-audit.json");
const baseUrl = process.env.ECOFERRO_CAPTURE_BASE_URL || "https://vendas.ecoferro.com.br";
const comparisonPath = path.join(
  projectRoot,
  "data",
  "playwright",
  "seller-center-comparison.json"
);
const reconciliationCsvPath = path.join(
  projectRoot,
  "data",
  "reports",
  "seller-center-reconciliation.csv"
);
const adminCredentials = resolveAdminCredentials();

function normalizeSetCookieHeader(headerValue) {
  if (!headerValue) return "";
  const rawHeaders = Array.isArray(headerValue) ? headerValue : [headerValue];
  return rawHeaders
    .map((entry) => String(entry || "").split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function readSnapshots() {
  const rawText = await fs.readFile(reportPath, "utf8");
  const parsed = JSON.parse(rawText);
  return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
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

async function postSnapshots(cookie, snapshots) {
  const response = await fetch(`${baseUrl}/api/ml/private-seller-center-snapshots`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({ snapshots }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Falha ao enviar snapshots (${response.status}): ${JSON.stringify(payload || {})}`
    );
  }

  return payload;
}

async function getComparison(cookie) {
  const response = await fetch(`${baseUrl}/api/ml/private-seller-center-comparison`, {
    headers: {
      Cookie: cookie,
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Falha ao consultar comparacao (${response.status}): ${JSON.stringify(payload || {})}`
    );
  }

  return payload;
}

function escapeCsvCell(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function buildReconciliationRows(report, comparison) {
  const snapshotIndex = new Map();
  for (const snapshot of report.snapshots || []) {
    snapshotIndex.set(`${snapshot.store}::${snapshot.selected_tab}`, snapshot);
  }

  const rows = [
    [
      "store",
      "tab",
      "ml_today",
      "ml_upcoming",
      "ml_in_transit",
      "ml_finalized",
      "ml_post_sale",
      "grid_count",
      "internal_today",
      "internal_upcoming",
      "internal_in_transit",
      "internal_finalized",
      "mirror_today",
      "mirror_upcoming",
      "mirror_in_transit",
      "mirror_finalized",
      "diff_internal_today",
      "diff_internal_upcoming",
      "diff_internal_in_transit",
      "diff_internal_finalized",
      "diff_mirror_today",
      "diff_mirror_upcoming",
      "diff_mirror_in_transit",
      "diff_mirror_finalized",
      "captured_at",
    ],
  ];

  for (const view of comparison?.views || []) {
    const snapshot = snapshotIndex.get(`${view.store}::${view.selected_tab}`) || null;
    const privateCounts = view.private_snapshot?.counts || {};
    const internalCounts = view.internal_operational?.counts || {};
    const mirrorCounts = view.seller_center_mirror?.counts || {};
    const diffInternal = view.differences?.internal_minus_private || {};
    const diffMirror = view.differences?.mirror_minus_private || {};

    rows.push([
      view.store,
      view.selected_tab,
      privateCounts.today ?? 0,
      privateCounts.upcoming ?? 0,
      privateCounts.in_transit ?? 0,
      privateCounts.finalized ?? 0,
      view.private_snapshot?.post_sale_count ?? 0,
      snapshot?.grid_count ?? 0,
      internalCounts.today ?? 0,
      internalCounts.upcoming ?? 0,
      internalCounts.in_transit ?? 0,
      internalCounts.finalized ?? 0,
      mirrorCounts.today ?? 0,
      mirrorCounts.upcoming ?? 0,
      mirrorCounts.in_transit ?? 0,
      mirrorCounts.finalized ?? 0,
      diffInternal.today ?? 0,
      diffInternal.upcoming ?? 0,
      diffInternal.in_transit ?? 0,
      diffInternal.finalized ?? 0,
      diffMirror.today ?? 0,
      diffMirror.upcoming ?? 0,
      diffMirror.in_transit ?? 0,
      diffMirror.finalized ?? 0,
      view.captured_at || "",
    ]);
  }

  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

const report = await readSnapshots();
const cookie = await loginAndGetCookie();
const postResult = await postSnapshots(cookie, report.snapshots || []);
const comparison = await getComparison(cookie);

await fs.mkdir(path.dirname(comparisonPath), { recursive: true });
await fs.mkdir(path.dirname(reconciliationCsvPath), { recursive: true });
await fs.writeFile(comparisonPath, JSON.stringify(comparison, null, 2), "utf8");
await fs.writeFile(
  reconciliationCsvPath,
  buildReconciliationRows(report, comparison),
  "utf8"
);

console.log(
  JSON.stringify(
    {
      status: "ok",
      report_path: reportPath,
      comparison_path: comparisonPath,
      reconciliation_csv_path: reconciliationCsvPath,
      inserted_count: postResult?.inserted_count || 0,
      snapshot_status: postResult?.snapshot_status || null,
      comparison_generated_at: comparison?.generated_at || null,
      comparison_views: Array.isArray(comparison?.views) ? comparison.views.length : 0,
    },
    null,
    2
  )
);
