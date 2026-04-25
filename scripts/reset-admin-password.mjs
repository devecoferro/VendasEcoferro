#!/usr/bin/env node
/**
 * Reset de senha de emergencia — roda direto contra o banco SQLite.
 *
 * Uso:
 *   node scripts/reset-admin-password.mjs <username> <nova-senha>
 *   node scripts/reset-admin-password.mjs --list                  (lista usuarios)
 *
 * Exemplos:
 *   node scripts/reset-admin-password.mjs admin.ecoferro NovaSenha@2026
 *   node scripts/reset-admin-password.mjs --list
 *
 * Este script:
 *   - NAO depende de env vars (le o DATA_DIR direto do default ou DATA_DIR env)
 *   - Gera hash scrypt compativel com o formato que auth-server.js verifica
 *     (prefixo "scrypt:<salt>:<hash>" com os mesmos params)
 *   - Garante active = 1 (se estava desativado, reativa)
 *   - Se o usuario nao existe, CRIA como admin com acesso a todos os locais
 *
 * Executar direto na VPS:
 *   cd /app  (ou onde esta montado)
 *   node scripts/reset-admin-password.mjs admin.ecoferro MinhaNovaSenha123
 *
 * Apos rodar, faca login com a nova senha. NAO precisa reiniciar o container —
 * o hash e lido do banco a cada tentativa de login.
 *
 * IMPORTANTE: a senha passa pela linha de comando, entao fica no history do
 * shell. Depois de usar, limpe com `history -c` ou use a opcao interativa
 * via variavel de ambiente:
 *
 *   NEW_ADMIN_PASSWORD=MinhaNovaSenha123 node scripts/reset-admin-password.mjs admin.ecoferro
 */

import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import path from "node:path";
import process from "node:process";
import fs from "node:fs";
import Database from "better-sqlite3";

// Mesmos params do auth-server.js (N=32768, r=8, p=1, maxmem 64MB)
// Qualquer mudanca aqui DEVE ser sincronizada com createPasswordHash() em
// api/_lib/auth-server.js — senao a verificacao vai falhar no proximo login.
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const ALL_LOCATIONS_ACCESS = "__all_locations__";

function nowIso() {
  return new Date().toISOString();
}

function createPasswordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = scryptSync(String(password), salt, 64, SCRYPT_PARAMS).toString("hex");
  return `scrypt:${salt}:${derivedKey}`;
}

function resolveDbPath() {
  // Mesma logica do api/_lib/app-config.js: DATA_DIR ou default ./data.
  // Banco real e ecoferro.db (nao app.db — bug original do script de
  // reset; corrigido em 2026-04-25 apos reset de senha em prod ter
  // falhado com "Banco nao encontrado: /app/data/app.db").
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dataDir, "ecoferro.db");
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(`
Uso:
  node scripts/reset-admin-password.mjs <username> <nova-senha>
  node scripts/reset-admin-password.mjs <username>    (usa NEW_ADMIN_PASSWORD env)
  node scripts/reset-admin-password.mjs --list

Exemplos:
  node scripts/reset-admin-password.mjs admin.ecoferro MinhaSenha@2026
  NEW_ADMIN_PASSWORD=SegredoSecreto node scripts/reset-admin-password.mjs admin.ecoferro
  node scripts/reset-admin-password.mjs --list

Para ver o banco:
  DATA_DIR=${process.env.DATA_DIR || "./data"}
`);
    process.exit(0);
  }

  const dbPath = resolveDbPath();
  if (!fs.existsSync(dbPath)) {
    console.error(`[erro] Banco nao encontrado: ${dbPath}`);
    console.error(`       Defina DATA_DIR=/caminho/pro/diretorio se necessario.`);
    process.exit(1);
  }

  console.log(`[reset] Conectando ao banco: ${dbPath}`);
  const db = new Database(dbPath);

  // Listar usuarios
  if (args[0] === "--list") {
    const rows = db
      .prepare(
        `SELECT id, username, login_email, role, active, created_at, updated_at
         FROM app_user_profiles
         ORDER BY role DESC, username ASC`
      )
      .all();

    if (rows.length === 0) {
      console.log("[info] Nenhum usuario cadastrado.");
    } else {
      console.log(`\n${rows.length} usuario(s):\n`);
      console.log("Username".padEnd(24) + "Role".padEnd(12) + "Ativo".padEnd(8) + "Criado");
      console.log("─".repeat(70));
      for (const r of rows) {
        console.log(
          r.username.padEnd(24) +
            r.role.padEnd(12) +
            (r.active ? "sim" : "NAO").padEnd(8) +
            (r.created_at || "—").slice(0, 19)
        );
      }
    }
    db.close();
    process.exit(0);
  }

  const username = String(args[0] || "").trim();
  const newPassword = String(args[1] || process.env.NEW_ADMIN_PASSWORD || "").trim();

  if (!username) {
    console.error("[erro] username obrigatorio.");
    process.exit(1);
  }

  if (!newPassword || newPassword.length < 8) {
    console.error("[erro] Senha obrigatoria e deve ter >= 8 caracteres.");
    console.error("       Passe como 2o argumento ou defina NEW_ADMIN_PASSWORD.");
    process.exit(1);
  }

  const existing = db
    .prepare(`SELECT id, active FROM app_user_profiles WHERE username = ? LIMIT 1`)
    .get(username);

  const hash = createPasswordHash(newPassword);
  const now = nowIso();

  if (existing) {
    db.prepare(
      `UPDATE app_user_profiles
       SET password_hash = ?, active = 1, updated_at = ?
       WHERE id = ?`
    ).run(hash, now, existing.id);

    const wasInactive = !existing.active;
    console.log(`[ok] Senha resetada para "${username}".`);
    if (wasInactive) {
      console.log(`[ok] Usuario estava DESATIVADO — foi reativado.`);
    }
  } else {
    // Cria novo admin com acesso total
    const id = randomUUID();
    db.prepare(
      `INSERT INTO app_user_profiles (
         id, username, login_email, password_hash, role, allowed_locations,
         active, created_at, updated_at
       ) VALUES (?, ?, NULL, ?, 'admin', ?, 1, ?, ?)`
    ).run(id, username, hash, JSON.stringify([ALL_LOCATIONS_ACCESS]), now, now);

    console.log(`[ok] Usuario "${username}" criado como admin com acesso total.`);
  }

  db.close();
  console.log(`\n[pronto] Faca login em https://vendas.ecoferro.com.br/login`);
  console.log(`         Username: ${username}`);
  console.log(`         Senha: <a que voce passou como argumento>`);
  console.log(`\nNAO precisa reiniciar o container. Troque a senha de novo depois`);
  console.log(`pelo painel /users (pra sair do history do shell).`);
}

try {
  main();
} catch (error) {
  console.error(`[erro] ${error.message}`);
  if (error.stack) console.error(error.stack);
  process.exit(1);
}
