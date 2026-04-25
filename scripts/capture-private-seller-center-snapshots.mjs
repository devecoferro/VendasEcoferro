// ═══════════════════════════════════════════════════════════════════
// Capture Seller Center Snapshots — CLI (auditoria/diagnostico)
//
// REESCRITO 2026-04-24: agora usa scrapeMlLiveSnapshot diretamente do
// scraper de producao (api/ml/_lib/seller-center-scraper.js). Antes
// tinha collector proprio de XHR que ficou defasado quando ML mudou
// estrutura — gerava tab_counts={0,0,0,0} sempre. Agora herda toda a
// logica que ja funciona em prod, sem duplicacao.
//
// Garantia de manutenibilidade: quando ML muda estrutura, basta
// atualizar UM local (seller-center-scraper.js) e ambos prod + CLI
// continuam funcionando.
//
// Telemetria: cada execucao registra em ml_scrape_history (tabela DB).
// Auto-deteccao de drift: compara assinaturas de XHR contra runs
// historicas; alerta se um endpoint conhecido sumir ou novo aparecer.
//
// Uso:
//   node scripts/capture-private-seller-center-snapshots.mjs
//     [--scope all|without_deposit|full|ourinhos]    (default: all)
//     [--all-scopes]                                  (captura todos)
//     [--output-dir <path>]                           (default: tmp-ml-audit3/)
//     [--no-telemetry]                                (nao grava em DB)
// ═══════════════════════════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Carrega .env se existir (mesma logica de outros scripts do repo)
function loadEnvFile() {
  const envPath = path.join(REPO_ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    if (process.env[k] != null && process.env[k] !== "") continue;
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

loadEnvFile();

// Imports apos loadEnv (modulos que leem env vars no top-level).
// Em Windows, dynamic import precisa de URL file:// ao inves de path Win.
const scraperModule = await import(
  pathToFileURL(path.join(REPO_ROOT, "api/ml/_lib/seller-center-scraper.js")).href
);
const { scrapeMlLiveSnapshot, VALID_SNAPSHOT_SCOPES } = scraperModule;

const telemetryModule = await import(
  pathToFileURL(path.join(REPO_ROOT, "api/_lib/scrape-telemetry.js")).href
);
const { recordScrapeHistory, detectXhrDrift } = telemetryModule;

function parseArgs(argv) {
  const args = {
    scope: "all",
    allScopes: false,
    outputDir: path.join(REPO_ROOT, "tmp-ml-audit3"),
    telemetry: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--scope" && argv[i + 1]) {
      args.scope = argv[++i];
      args.scopeExplicit = true;
      continue;
    }
    if (a === "--all-scopes") {
      args.allScopes = true;
      continue;
    }
    if (a === "--output-dir" && argv[i + 1]) {
      args.outputDir = path.resolve(argv[++i]);
      continue;
    }
    if (a === "--no-telemetry") {
      args.telemetry = false;
      continue;
    }
    if (a === "--help" || a === "-h") {
      console.log(`Uso: node scripts/capture-private-seller-center-snapshots.mjs [opcoes]

Opcoes:
  --scope <s>          all | without_deposit | full | ourinhos (default: all)
  --all-scopes         captura todos os scopes em sequencia
  --output-dir <path>  default: tmp-ml-audit3/
  --no-telemetry       nao grava em ml_scrape_history (DB)
  -h, --help           mostra ajuda
`);
      process.exit(0);
    }
  }
  return args;
}

function redactString(value, maxLen = 3) {
  // Substitui caracteres por "*" mantendo apenas N inicial pra debug.
  if (typeof value !== "string" || !value) return value;
  if (value.length <= maxLen) return "*".repeat(value.length);
  return value.slice(0, maxLen) + "*".repeat(Math.max(3, value.length - maxLen));
}

function maskSensitive(snap) {
  // Sanitiza snapshot antes de escrever em disco. Risco real: orders[]
  // contem buyer_name / buyer_nickname (PII de compradores). Tambem
  // possivelmente cookies em headers de XHRs (mas scraper atual nao
  // grava headers — ver seller-center-scraper.js:643).
  //
  // Estrategia: structuredClone (mais robusto que JSON.parse(JSON.stringify))
  // + redact PII em orders[].
  let cloned;
  try {
    cloned = structuredClone(snap);
  } catch {
    cloned = JSON.parse(JSON.stringify(snap));
  }

  // Redact PII em orders por aba
  if (cloned?.orders && typeof cloned.orders === "object") {
    for (const tab of Object.values(cloned.orders)) {
      if (!Array.isArray(tab)) continue;
      for (const order of tab) {
        if (!order || typeof order !== "object") continue;
        if (order.buyer_name) order.buyer_name = redactString(order.buyer_name);
        if (order.buyer_nickname) order.buyer_nickname = redactString(order.buyer_nickname);
        if (order.buyer_email) order.buyer_email = "***@***";
        if (order.buyer_phone) order.buyer_phone = "+**********";
        // Manten order_id, pack_id, status — uteis pra cross-reference,
        // nao sao PII.
      }
    }
  }

  return cloned;
}

function sanitizeError(err) {
  // Tira tokens de URLs em mensagens de erro antes de gravar no DB.
  if (!err) return null;
  const msg = typeof err === "string" ? err : err.message || String(err);
  return msg.replace(
    /[?&](access_token|token|auth|authorization|api_key)=[^&\s]+/gi,
    (m) => m.split("=")[0] + "=<redacted>"
  );
}

async function captureOne(scope, opts) {
  const startedAt = Date.now();
  console.log(`[capture] scope=${scope} iniciando...`);
  let snap;
  let error = null;
  try {
    snap = await scrapeMlLiveSnapshot({ scope, timeoutMs: 180_000 });
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    snap = { ok: false, error };
  }
  const elapsedMs = Date.now() - startedAt;

  if (!snap.ok) {
    console.error(`  ❌ falhou em ${elapsedMs}ms: ${snap.error || error}`);
  } else {
    console.log(
      `  ✓ ok em ${elapsedMs}ms — counters=${JSON.stringify(snap.counters)} ` +
        `orders=${snap.stats.total_orders} xhrs=${snap.stats.xhr_count} ` +
        `signatures=${snap.xhr_signatures?.length || 0}`
    );

    // Salva snapshot em disco (sanitizado)
    if (opts.outputDir) {
      fs.mkdirSync(opts.outputDir, { recursive: true });
      const filename = `${scope}.json`;
      fs.writeFileSync(
        path.join(opts.outputDir, filename),
        JSON.stringify(maskSensitive(snap), null, 2)
      );
    }
  }

  // Telemetria — grava SEMPRE (sucesso ou falha) pra construir historico
  if (opts.telemetry) {
    try {
      recordScrapeHistory({
        scope,
        ok: snap.ok === true,
        counters: snap.counters || null,
        total_orders: snap.stats?.total_orders || 0,
        xhr_count: snap.stats?.xhr_count || 0,
        detected_store_ids: snap.stats?.detected_store_ids || [],
        xhr_signatures: snap.xhr_signatures || [],
        elapsed_ms: elapsedMs,
        error: sanitizeError(snap.error || error),
        triggered_by: "cli",
      });

      const drift = detectXhrDrift(scope);
      if (drift.has_drift) {
        console.log(`  ⚠ drift detectado: ${drift.message}`);
        for (const change of drift.changes || []) {
          console.log(`     - ${change}`);
        }
      }
    } catch (err) {
      console.warn(`  (telemetry falhou: ${err?.message || err})`);
    }
  }

  return snap;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Path traversal check: outputDir tem que ficar dentro do REPO_ROOT
  // (evita operador local salvar pra OneDrive/cloud-sync sem perceber).
  const resolvedOutputDir = path.resolve(args.outputDir);
  if (!resolvedOutputDir.startsWith(REPO_ROOT)) {
    console.error(
      `Output dir fora do repo: ${resolvedOutputDir}. Use um path dentro de ${REPO_ROOT}.`
    );
    process.exit(2);
  }
  args.outputDir = resolvedOutputDir;

  // Validacao mutex: --scope + --all-scopes nao fazem sentido juntos.
  // Se ambos passados sem default, --all-scopes vence; mas --scope nao default
  // junto com --all-scopes e erro de uso.
  if (args.allScopes && args.scopeExplicit) {
    console.error(
      `--scope e --all-scopes sao mutuamente exclusivos. Escolha um.`
    );
    process.exit(2);
  }

  const scopes = args.allScopes ? VALID_SNAPSHOT_SCOPES : [args.scope];
  for (const s of scopes) {
    if (!VALID_SNAPSHOT_SCOPES.includes(s)) {
      console.error(`Scope invalido: ${s}. Validos: ${VALID_SNAPSHOT_SCOPES.join(", ")}`);
      process.exit(2);
    }
  }

  const aggregate = {
    generated_at: new Date().toISOString(),
    scopes: {},
  };

  for (const scope of scopes) {
    const snap = await captureOne(scope, args);
    aggregate.scopes[scope] = {
      ok: snap.ok === true,
      counters: snap.counters || null,
      total_orders: snap.stats?.total_orders || 0,
      xhr_count: snap.stats?.xhr_count || 0,
      detected_store_ids: snap.stats?.detected_store_ids || [],
      error: snap.error || null,
      file: snap.ok ? `${scope}.json` : null,
    };
  }

  if (args.outputDir) {
    fs.mkdirSync(args.outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(args.outputDir, "_aggregate.json"),
      JSON.stringify(aggregate, null, 2)
    );
    console.log(`\nConcluido. Output: ${args.outputDir}/_aggregate.json`);
  }

  // Force exit pra warmBrowser idleTimer nao bloquear (caso unref() falhe)
  setTimeout(() => process.exit(0), 100).unref();
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
