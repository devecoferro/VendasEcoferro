/**
 * Obsidian Sync — Notas permanentes do VendasEcoferro no vault.
 *
 * Notas que fazem sentido como registro permanente:
 *   1. Documentação técnica (CLAUDE.md, docs/) — manual, sob demanda
 *   2. Relatório diário de vendas — 1 nota por dia, não sobrescrita
 *   3. Registro de problemas/bugs — automático quando o sistema detecta
 *   4. Log de eventos importantes — automático (drift, sync, NF-e, erros)
 *
 * Estrutura no vault:
 *   EcoFerro/
 *   ├── Docs/                          ← documentação técnica
 *   ├── Vendas/2026-04/                ← relatórios diários
 *   ├── Problemas/2026-04/             ← registro de bugs/incidentes
 *   └── Log/2026-04/                   ← eventos automáticos do sistema
 */

import { db } from "./db.js";
import createLogger from "./logger.js";
import { createNote, appendToNote, readNote, checkConnection } from "./obsidian.js";

const log = createLogger("obsidian-sync");

const VAULT_ROOT = process.env.OBSIDIAN_VAULT_ROOT || "EcoFerro";
const OPERATIONAL_TIMEZONE = "America/Sao_Paulo";

// ─── Helpers ───────────────────────────────────────────────────────

function todaySP() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: OPERATIONAL_TIMEZONE });
}

function nowSP() {
  return new Date().toLocaleString("pt-BR", { timeZone: OPERATIONAL_TIMEZONE });
}

function monthFolder(dateStr) {
  return (dateStr || todaySP()).slice(0, 7);
}

function formatCurrency(value) {
  return `R$ ${Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

function statusLabel(status) {
  const labels = {
    pending: "Pendente",
    confirmed: "Confirmado",
    paid: "Pago",
    ready_to_ship: "Pronto p/ envio",
    shipped: "Enviado",
    delivered: "Entregue",
    cancelled: "Cancelado",
    not_delivered: "Não entregue",
    returned: "Devolvido",
  };
  return labels[status] || status || "—";
}

// ─── 1. Documentação Técnica ───────────────────────────────────────

/**
 * Exporta CLAUDE.md e docs/ para o vault. Chamado manualmente.
 */
export async function syncDocsToObsidian() {
  const connected = await checkConnection();
  if (!connected.ok) throw new Error("Obsidian não disponível");

  const { readFileSync, readdirSync, existsSync } = await import("node:fs");
  const { resolve, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const __filename = fileURLToPath(import.meta.url);
  const projectRoot = resolve(__filename, "../../..");
  let synced = 0;

  // CLAUDE.md
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  if (existsSync(claudeMdPath)) {
    const content = readFileSync(claudeMdPath, "utf-8");
    const header = `---\ntags: [ecoferro, docs, arquitetura]\natualizado: "${nowSP()}"\n---\n\n`;
    await createNote(`${VAULT_ROOT}/Docs/CLAUDE.md`, header + content);
    synced++;
  }

  // docs/*.md
  const docsDir = join(projectRoot, "docs");
  if (existsSync(docsDir)) {
    const files = readdirSync(docsDir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const content = readFileSync(join(docsDir, file), "utf-8");
      const header = `---\ntags: [ecoferro, docs]\natualizado: "${nowSP()}"\n---\n\n`;
      await createNote(`${VAULT_ROOT}/Docs/${file}`, header + content);
      synced++;
    }
  }

  log.info(`Documentação sincronizada: ${synced} arquivo(s)`);
  return { synced };
}

// ─── 2. Relatório Diário de Vendas ─────────────────────────────────

/**
 * Gera relatório de vendas de uma data específica.
 * Cria a nota APENAS se ainda não existe (não sobrescreve).
 * @param {string} [date] - Data no formato YYYY-MM-DD (default: hoje)
 */
export async function generateDailyReport(date) {
  const connected = await checkConnection();
  if (!connected.ok) throw new Error("Obsidian não disponível");

  const targetDate = date || todaySP();
  const month = monthFolder(targetDate);
  const notePath = `${VAULT_ROOT}/Vendas/${month}/relatorio-${targetDate}.md`;

  // Verifica se já existe para não sobrescrever
  try {
    await readNote(notePath);
    log.info(`Relatório ${targetDate} já existe — pulando`);
    return { created: false, path: notePath, message: "Relatório já existe" };
  } catch {
    // Nota não existe — vamos criar
  }

  const orders = db
    .prepare(
      `SELECT order_id, sale_number, sale_date, buyer_name, buyer_nickname,
              item_title, sku, quantity, amount, order_status,
              json_extract(raw_data, '$.shipment_snapshot.status') AS shipping_status
       FROM ml_orders
       WHERE date(sale_date) = ?
       ORDER BY datetime(sale_date) ASC`
    )
    .all(targetDate);

  const totalRevenue = orders.reduce((sum, o) => sum + (o.amount || 0), 0);
  const totalQuantity = orders.reduce((sum, o) => sum + (o.quantity || 0), 0);

  // Agrupa por SKU
  const bySku = {};
  for (const o of orders) {
    const sku = o.sku || "SEM-SKU";
    if (!bySku[sku]) bySku[sku] = { title: o.item_title, qty: 0, revenue: 0 };
    bySku[sku].qty += o.quantity || 1;
    bySku[sku].revenue += o.amount || 0;
  }

  let content = `---
tags: [ecoferro, relatorio, vendas]
data: "${targetDate}"
total_pedidos: ${orders.length}
total_faturamento: ${totalRevenue}
criado: "${nowSP()}"
---

# Relatório de Vendas — ${targetDate}

## Resumo

| Métrica | Valor |
|---------|-------|
| Total de pedidos | ${orders.length} |
| Total de itens | ${totalQuantity} |
| Faturamento | ${formatCurrency(totalRevenue)} |
| Ticket médio | ${formatCurrency(orders.length > 0 ? totalRevenue / orders.length : 0)} |

## Vendas por Produto

| SKU | Produto | Qtd | Faturamento |
|-----|---------|-----|-------------|
`;

  for (const [sku, data] of Object.entries(bySku).sort((a, b) => b[1].revenue - a[1].revenue)) {
    content += `| ${sku} | ${data.title?.slice(0, 50) || "—"} | ${data.qty} | ${formatCurrency(data.revenue)} |\n`;
  }

  content += `\n## Pedidos\n\n`;
  content += `| # | Comprador | Produto | Valor | Status |\n`;
  content += `|---|-----------|---------|-------|--------|\n`;

  for (const o of orders) {
    content += `| ${o.sale_number || o.order_id} | ${o.buyer_nickname || "—"} | ${o.sku || "—"} | ${formatCurrency(o.amount)} | ${statusLabel(o.shipping_status || o.order_status)} |\n`;
  }

  await createNote(notePath, content);
  log.info(`Relatório ${targetDate} criado: ${orders.length} pedidos, ${formatCurrency(totalRevenue)}`);
  return { created: true, path: notePath, orders: orders.length, revenue: totalRevenue };
}

// ─── 3. Registro de Problemas ──────────────────────────────────────

/**
 * Registra um problema/bug/incidente como nota permanente no vault.
 * @param {object} params
 * @param {string} params.title - Título curto do problema
 * @param {string} params.description - O que aconteceu
 * @param {string} [params.severity] - "baixa" | "media" | "alta" | "critica"
 * @param {string} [params.resolution] - Como foi resolvido (se já resolvido)
 * @param {string} [params.relatedOrderId] - ID do pedido relacionado (se houver)
 */
export async function logProblem({ title, description, severity, resolution, relatedOrderId }) {
  const connected = await checkConnection();
  if (!connected.ok) throw new Error("Obsidian não disponível");

  if (!title || !description) {
    throw new Error("'title' e 'description' são obrigatórios");
  }

  const today = todaySP();
  const month = monthFolder(today);
  const timestamp = Date.now();
  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

  const notePath = `${VAULT_ROOT}/Problemas/${month}/${today}-${slug}.md`;

  const content = `---
tags: [ecoferro, problema${severity ? `, ${severity}` : ""}${resolution ? ", resolvido" : ", aberto"}]
data: "${today}"
hora: "${nowSP()}"
severidade: "${severity || "media"}"
status: "${resolution ? "resolvido" : "aberto"}"
${relatedOrderId ? `order_id: "${relatedOrderId}"` : ""}
---

# ${title}

## O que aconteceu

${description}

${resolution ? `## Resolução\n\n${resolution}\n` : "## Resolução\n\n_Pendente_\n"}
${relatedOrderId ? `## Pedido Relacionado\n\nOrder ID: ${relatedOrderId}\n` : ""}
---
_Registrado em ${nowSP()}_
`;

  await createNote(notePath, content);
  log.info(`Problema registrado: "${title}" (${severity || "media"})`);
  return { created: true, path: notePath };
}

// ─── 4. Auto-Log de Eventos Importantes ────────────────────────────
//
// Sistema fire-and-forget: chame logEvent() de qualquer lugar do código
// e ele grava no Obsidian sem bloquear. Se o Obsidian estiver fechado,
// o evento é silenciosamente descartado (não quebra nada).

// Dedup: evita registrar o mesmo evento repetidamente
const recentEvents = new Map();
const EVENT_DEDUP_MS = 5 * 60_000; // 5 min entre eventos iguais

// Limpa dedup a cada 10 min
setInterval(() => {
  const cutoff = Date.now() - EVENT_DEDUP_MS * 2;
  for (const [key, ts] of recentEvents) {
    if (ts < cutoff) recentEvents.delete(key);
  }
}, 10 * 60_000).unref();

/**
 * Registra um evento importante automaticamente no vault.
 * Fire-and-forget — nunca lança erro, nunca bloqueia.
 *
 * @param {"erro"|"correcao"|"melhoria"|"alerta"|"info"} type
 * @param {string} title - Título curto
 * @param {string} detail - Descrição do que aconteceu
 * @param {object} [meta] - Dados extras (ex: { orderId, diff, duration })
 */
export async function logEvent(type, title, detail, meta = {}) {
  try {
    // Dedup por tipo+título
    const dedupKey = `${type}:${title}`;
    const lastTime = recentEvents.get(dedupKey);
    if (lastTime && Date.now() - lastTime < EVENT_DEDUP_MS) return;
    recentEvents.set(dedupKey, Date.now());

    const connected = await checkConnection();
    if (!connected.ok) return; // Obsidian fechado — ignora silenciosamente

    const today = todaySP();
    const month = monthFolder(today);
    const time = new Date().toLocaleTimeString("pt-BR", { timeZone: OPERATIONAL_TIMEZONE });
    const logPath = `${VAULT_ROOT}/Log/${month}/${today}.md`;

    const emoji = {
      erro: "🔴",
      correcao: "🟢",
      melhoria: "🔵",
      alerta: "🟡",
      info: "⚪",
    }[type] || "⚪";

    // Monta a entrada como bloco para anexar
    let entry = `\n### ${emoji} ${title}\n`;
    entry += `**${time}** — _${type}_\n\n`;
    entry += `${detail}\n`;

    if (Object.keys(meta).length > 0) {
      entry += `\n<details><summary>Detalhes</summary>\n\n`;
      entry += "```json\n" + JSON.stringify(meta, null, 2) + "\n```\n";
      entry += `</details>\n`;
    }

    entry += `\n---\n`;

    // Tenta anexar; se a nota do dia não existe, cria com header
    try {
      await appendToNote(logPath, entry);
    } catch {
      // Nota não existe — cria com frontmatter
      const header = `---\ntags: [ecoferro, log, ${month}]\ndata: "${today}"\n---\n\n# Log EcoFerro — ${today}\n\n---\n`;
      await createNote(logPath, header + entry);
    }
  } catch {
    // Silencioso — nunca quebra o fluxo principal
  }
}

// ─── Funções prontas para os hooks do servidor ─────────────────────

/** Sync ML falhou */
export async function onSyncFailed(sellerName, error) {
  await logEvent("erro", `Sync ML falhou — ${sellerName}`,
    `O sync incremental com o Mercado Livre falhou para o seller "${sellerName}".`,
    { error: error?.message || String(error) }
  );
}

/** Drift detectado entre app e ML Seller Center */
export async function onDriftDetected(maxDiff, diff) {
  await logEvent("alerta", `Drift detectado (diff: ${maxDiff})`,
    `Divergência entre os dados do app e o ML Seller Center. Diferença máxima: ${maxDiff} pedidos.`,
    { max_abs_diff: maxDiff, diff }
  );
}

/** Auto-heal resolveu o drift */
export async function onDriftHealed(refreshedOrders, beforeDiff, afterDiff) {
  await logEvent("correcao", `Auto-heal corrigiu drift`,
    `O sistema detectou divergência e corrigiu automaticamente refreshando ${refreshedOrders} pedidos. Diff antes: ${beforeDiff}, depois: ${afterDiff}.`,
    { refreshed_orders: refreshedOrders, before: beforeDiff, after: afterDiff }
  );
}

/** Auto-heal NÃO resolveu — provável bug */
export async function onDriftPersistent(refreshedOrders, maxDiff, reason) {
  await logEvent("erro", `Drift persistente — possível bug`,
    `Auto-heal refreshou ${refreshedOrders} pedidos mas o drift persiste (diff: ${maxDiff}). Isso indica um possível bug de classificação.`,
    { refreshed_orders: refreshedOrders, max_abs_diff: maxDiff, reason }
  );
}

/** NF-e emitida com sucesso */
export async function onNfeEmitted(orderId, nfeNumber) {
  await logEvent("info", `NF-e emitida — ${nfeNumber}`,
    `Nota fiscal ${nfeNumber} emitida para o pedido ${orderId}.`,
    { order_id: orderId, nfe_number: nfeNumber }
  );
}

/** NF-e falhou */
export async function onNfeFailed(orderId, error) {
  await logEvent("erro", `NF-e falhou — pedido ${orderId}`,
    `Falha ao emitir nota fiscal para o pedido ${orderId}.`,
    { order_id: orderId, error: error?.message || String(error) }
  );
}

/** Erro não tratado (uncaughtException / unhandledRejection) */
export async function onUnhandledError(type, error) {
  await logEvent("erro", `${type}`,
    `Erro não tratado capturado pelo processo Node.`,
    { type, error: error?.message || String(error), stack: error?.stack?.slice(0, 500) }
  );
}

/** Servidor iniciou/reiniciou */
export async function onServerStart(port) {
  await logEvent("info", `Servidor iniciado`,
    `EcoFerro iniciou na porta ${port}.`
  );
}

/** Backup falhou */
export async function onBackupFailed(error) {
  await logEvent("erro", `Backup falhou`,
    `O backup automático do banco de dados falhou.`,
    { error: error?.message || String(error) }
  );
}
