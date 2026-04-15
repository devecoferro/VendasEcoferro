#!/usr/bin/env node
/**
 * verify-ml-chips.mjs — CLI watcher for ML chip count drift.
 *
 * Continuously polls /api/ml/diagnostics and logs divergences between
 * the ML Seller Center live chip counts and the app's internal classification.
 *
 * Usage:
 *   node scripts/verify-ml-chips.mjs                         # one-shot
 *   node scripts/verify-ml-chips.mjs --watch                 # continuous (60s)
 *   node scripts/verify-ml-chips.mjs --watch --interval=120  # every 2 minutes
 *   node scripts/verify-ml-chips.mjs --threshold=5           # alerts only if diff > 5
 *   node scripts/verify-ml-chips.mjs --log-file=chip.jsonl   # append JSON lines
 *   node scripts/verify-ml-chips.mjs --save                  # persist to DB
 *   node scripts/verify-ml-chips.mjs --fresh                 # bypass dashboard cache
 *   node scripts/verify-ml-chips.mjs --url=https://vendas.ecoferro.com.br
 *   node scripts/verify-ml-chips.mjs --deposit=logistic:fulfillment
 *   node scripts/verify-ml-chips.mjs --logistic-type=fulfillment
 *
 * Env vars:
 *   ECOFERRO_CAPTURE_BASE_URL  — base URL (default: https://vendas.ecoferro.com.br)
 *   ECOFERRO_ADMIN_USERNAME    — login username (or ECOFERRO_CAPTURE_USERNAME)
 *   ECOFERRO_ADMIN_PASSWORD    — login password (or ECOFERRO_CAPTURE_PASSWORD)
 *
 * Exit codes:
 *   0 — in sync (all diffs <= threshold), or watch mode exited cleanly
 *   1 — drift detected on last poll (only for --once or final poll)
 *   2 — ML API unavailable
 *   3 — auth/network error
 */

import fs from "node:fs";
import path from "node:path";
import { resolveAdminCredentials } from "./_lib/admin-credentials.mjs";

const DEFAULT_BASE_URL =
  process.env.ECOFERRO_CAPTURE_BASE_URL || "https://vendas.ecoferro.com.br";
// 30s = cadencia do cache do dashboard e do cron do servidor.
// ML muda status de pedidos com frequencia, intervalos maiores ficam em atraso.
const DEFAULT_INTERVAL_SECONDS = 30;
const DEFAULT_THRESHOLD = 2;

function parseArgs(argv) {
  const args = {
    watch: false,
    once: true,
    interval: DEFAULT_INTERVAL_SECONDS,
    threshold: DEFAULT_THRESHOLD,
    logFile: null,
    save: false,
    fresh: false,
    url: DEFAULT_BASE_URL,
    depositKey: null,
    logisticType: null,
    includeBreakdown: true,
    quiet: false,
  };

  for (const arg of argv.slice(2)) {
    if (arg === "--watch") {
      args.watch = true;
      args.once = false;
    } else if (arg === "--once") {
      args.once = true;
      args.watch = false;
    } else if (arg.startsWith("--interval=")) {
      const n = Number(arg.slice("--interval=".length));
      if (Number.isFinite(n) && n > 0) args.interval = n;
    } else if (arg.startsWith("--threshold=")) {
      const n = Number(arg.slice("--threshold=".length));
      if (Number.isFinite(n) && n >= 0) args.threshold = n;
    } else if (arg.startsWith("--log-file=")) {
      args.logFile = arg.slice("--log-file=".length);
    } else if (arg === "--save") {
      args.save = true;
    } else if (arg === "--fresh") {
      args.fresh = true;
    } else if (arg.startsWith("--url=")) {
      args.url = arg.slice("--url=".length);
    } else if (arg.startsWith("--deposit=")) {
      args.depositKey = arg.slice("--deposit=".length);
    } else if (arg.startsWith("--logistic-type=")) {
      args.logisticType = arg.slice("--logistic-type=".length);
    } else if (arg === "--no-breakdown") {
      args.includeBreakdown = false;
    } else if (arg === "--quiet" || arg === "-q") {
      args.quiet = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return args;
}

function printHelp() {
  console.log(`verify-ml-chips.mjs — ML chip drift watcher

Usage:
  node scripts/verify-ml-chips.mjs [flags]

Flags:
  --watch                    Poll continuously (default: one-shot)
  --once                     Single check and exit (default)
  --interval=N               Seconds between polls in watch mode (default: 30)
  --threshold=N              Alert threshold for |diff| (default: 2)
  --log-file=PATH            Append JSONL logs to this file
  --save                     Persist each snapshot to ml_chip_drift_history
  --fresh                    Bypass 30s dashboard cache (slower, live from ML API)
  --url=URL                  Base URL (default: env ECOFERRO_CAPTURE_BASE_URL)
  --deposit=KEY              Filter internal counts to deposit KEY
  --logistic-type=TYPE       Filter to "fulfillment" or "cross_docking"
  --no-breakdown             Skip per-deposit breakdown (smaller payload)
  --quiet, -q                Suppress OK rows (only drift lines in stdout)
  --help, -h                 This message

Exit codes: 0=in sync, 1=drift, 2=ML API unavailable, 3=auth/network error`);
}

function normalizeSetCookieHeader(headerValue) {
  if (!headerValue) return "";
  const rawHeaders = Array.isArray(headerValue) ? headerValue : [headerValue];
  return rawHeaders
    .map((entry) => String(entry || "").split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function loginAndGetCookie(baseUrl, credentials) {
  const response = await fetch(`${baseUrl}/api/app-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login",
      username: credentials.username,
      password: credentials.password,
    }),
  });

  const cookie = normalizeSetCookieHeader(
    response.headers.getSetCookie?.() || response.headers.get("set-cookie")
  );
  if (!response.ok || !cookie) {
    const payload = await response.text().catch(() => "");
    throw new Error(
      `Login failed (${response.status}): ${payload.slice(0, 200)}`
    );
  }
  return cookie;
}

function buildVerifyUrl(baseUrl, args) {
  const params = new URLSearchParams();
  params.set("tolerance", String(args.threshold));
  if (args.fresh) params.set("fresh", "true");
  if (args.save) params.set("save", "true");
  if (!args.includeBreakdown) params.set("breakdown", "false");
  if (args.depositKey) params.set("deposit_key", args.depositKey);
  if (args.logisticType) params.set("logistic_type", args.logisticType);
  return `${baseUrl}/api/ml/diagnostics?${params.toString()}`;
}

async function fetchDiff(baseUrl, cookie, args) {
  const response = await fetch(buildVerifyUrl(baseUrl, args), {
    headers: { Cookie: cookie },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `Diagnostics API error (${response.status}): ${
        payload?.error || "unknown"
      }`
    );
  }
  return payload;
}

function formatDiffLine(diff) {
  const sign = (n) => (n > 0 ? `+${n}` : String(n));
  return [
    `today=${sign(diff.today)}`,
    `upcoming=${sign(diff.upcoming)}`,
    `in_transit=${sign(diff.in_transit)}`,
    `finalized=${sign(diff.finalized)}`,
    `cancelled=${sign(diff.cancelled)}`,
  ].join(" ");
}

function formatCountsLine(label, counts) {
  return `${label} today=${counts.today} upcoming=${counts.upcoming} in_transit=${counts.in_transit} finalized=${counts.finalized} cancelled=${counts.cancelled}`;
}

function appendLog(logFile, entry) {
  if (!logFile) return;
  try {
    const dir = path.dirname(path.resolve(logFile));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (err) {
    console.error(
      `[verify-ml-chips] log write failed: ${err instanceof Error ? err.message : err}`
    );
  }
}

function renderResult(result, args) {
  const ts = result.timestamp;
  if (result.status === "ML_API_UNAVAILABLE") {
    console.error(`[${ts}] ML_API_UNAVAILABLE — ${result.error || "unknown"}`);
    return;
  }

  const statusIcon =
    result.status === "IN_SYNC"
      ? args.quiet
        ? null
        : "[OK]"
      : "[DRIFT]";
  if (!statusIcon) return;

  const lines = [
    `${statusIcon} ${ts} | max_abs_diff=${result.max_abs_diff} (threshold=${result.tolerance})`,
    `  ${formatCountsLine("ML:  ", result.ml_seller_center)}`,
    `  ${formatCountsLine("APP: ", result.app_internal)}`,
    `  DIFF: ${formatDiffLine(result.diff)}`,
  ];
  if (result.filter_applied) {
    lines.push(`  FILTERS: ${JSON.stringify(result.filters)}`);
    if (result.filter_warning) {
      lines.push(`  WARN:    ${result.filter_warning}`);
    }
  }
  if (result.status === "DRIFT_DETECTED" && Array.isArray(result.breakdown_by_deposit)) {
    const offenders = result.breakdown_by_deposit
      .filter((d) => {
        const c = d.counts || {};
        return (
          c.today || c.upcoming || c.in_transit || c.finalized || c.cancelled
        );
      })
      .slice(0, 10);
    if (offenders.length > 0) {
      lines.push(`  BREAKDOWN (top ${offenders.length} deposits):`);
      for (const d of offenders) {
        lines.push(
          `    - ${d.label} (${d.logistic_type}): ${formatDiffLine(d.counts)}`
        );
      }
    }
  }
  const stream =
    result.status === "DRIFT_DETECTED" ? process.stdout : process.stdout;
  stream.write(lines.join("\n") + "\n");
}

async function runOnce(args, baseUrl, cookie) {
  const result = await fetchDiff(baseUrl, cookie, args);
  renderResult(result, args);
  appendLog(args.logFile, result);
  return result;
}

async function main() {
  const args = parseArgs(process.argv);

  const credentials = resolveAdminCredentials();
  if (!credentials.username || !credentials.password) {
    console.error(
      "Credenciais de admin nao encontradas. Set ECOFERRO_ADMIN_USERNAME / ECOFERRO_ADMIN_PASSWORD."
    );
    process.exit(3);
  }

  let cookie;
  try {
    cookie = await loginAndGetCookie(args.url, credentials);
  } catch (err) {
    console.error(
      `[verify-ml-chips] Login falhou: ${err instanceof Error ? err.message : err}`
    );
    process.exit(3);
  }

  if (args.once) {
    try {
      const result = await runOnce(args, args.url, cookie);
      if (result.status === "ML_API_UNAVAILABLE") process.exit(2);
      if (result.status === "DRIFT_DETECTED") process.exit(1);
      process.exit(0);
    } catch (err) {
      console.error(
        `[verify-ml-chips] Falha: ${err instanceof Error ? err.message : err}`
      );
      process.exit(3);
    }
  }

  // Watch mode — loop forever, re-login on 401
  console.log(
    `[verify-ml-chips] watch mode — interval=${args.interval}s threshold=${args.threshold} url=${args.url}`
  );
  let lastResult = null;
  let shouldStop = false;

  const stop = () => {
    shouldStop = true;
    console.log("\n[verify-ml-chips] shutdown requested, exiting after current tick...");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  while (!shouldStop) {
    try {
      lastResult = await runOnce(args, args.url, cookie);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[verify-ml-chips] tick falhou: ${msg}`);
      // On auth-like errors, try re-login once
      if (/401|unauthorized|login/i.test(msg)) {
        try {
          cookie = await loginAndGetCookie(args.url, credentials);
          console.log("[verify-ml-chips] re-login ok");
        } catch (reErr) {
          console.error(
            `[verify-ml-chips] re-login falhou: ${reErr instanceof Error ? reErr.message : reErr}`
          );
        }
      }
    }
    if (shouldStop) break;
    await new Promise((resolve) => setTimeout(resolve, args.interval * 1000));
  }

  // Clean exit from watch mode
  process.exit(0);
}

main().catch((err) => {
  console.error(
    `[verify-ml-chips] Unhandled: ${err instanceof Error ? err.stack || err.message : err}`
  );
  process.exit(3);
});
