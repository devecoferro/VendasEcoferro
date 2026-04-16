#!/usr/bin/env node
/**
 * Print Agent — Serviço local de impressão silenciosa.
 *
 * Roda na máquina do operador (onde a impressora está conectada).
 * O frontend envia o PDF via POST e o agente imprime direto na
 * impressora padrão sem mostrar nenhum diálogo.
 *
 * Uso:
 *   node scripts/print-agent.mjs
 *
 * O agente escuta em http://localhost:9120 e aceita:
 *   POST /print  — body = PDF binário (application/pdf)
 *   GET  /status — health check (retorna { ok: true, printer: "..." })
 *
 * Estratégias de impressão (Windows, tenta em ordem):
 *   1. SumatraPDF -print-to-default (se instalado — mais confiável)
 *   2. PDFtoPrinter.exe (se presente na pasta scripts/)
 *   3. PowerShell Out-Printer via conversão (fallback nativo)
 *
 * Para Linux/Mac: usa lp/lpr.
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync, exec } from "node:child_process";

const PORT = Number(process.env.PRINT_AGENT_PORT || 9120);
const TEMP_DIR = path.join(os.tmpdir(), "ecoferro-print");

// Garante diretório temporário
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ─── Detectar estratégia de impressão ────────────────────────────────

function findCommand(name) {
  try {
    if (process.platform === "win32") {
      execSync(`where ${name}`, { stdio: "pipe" });
    } else {
      execSync(`which ${name}`, { stdio: "pipe" });
    }
    return true;
  } catch {
    return false;
  }
}

const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Z]:)/, "$1");
const PDF_TO_PRINTER_PATH = path.join(SCRIPT_DIR, "PDFtoPrinter.exe");

function detectPrintStrategy() {
  if (process.platform === "win32") {
    if (findCommand("SumatraPDF")) return "sumatra";
    if (fs.existsSync(PDF_TO_PRINTER_PATH)) return "pdftoprinter";
    return "powershell";
  }
  if (findCommand("lp")) return "lp";
  if (findCommand("lpr")) return "lpr";
  return "none";
}

const strategy = detectPrintStrategy();
console.log(`[Print Agent] Estratégia de impressão: ${strategy}`);

// ─── Obter nome da impressora padrão ─────────────────────────────────

function getDefaultPrinter() {
  try {
    if (process.platform === "win32") {
      const output = execSync(
        'powershell -Command "(Get-CimInstance -ClassName Win32_Printer | Where-Object {$_.Default -eq $true}).Name"',
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      ).trim();
      return output || "Desconhecida";
    }
    const output = execSync("lpstat -d 2>/dev/null || echo unknown", {
      encoding: "utf-8",
    }).trim();
    return output.replace(/^.*:\s*/, "") || "Desconhecida";
  } catch {
    return "Desconhecida";
  }
}

const defaultPrinter = getDefaultPrinter();
console.log(`[Print Agent] Impressora padrão: ${defaultPrinter}`);

// ─── Função de impressão ─────────────────────────────────────────────

function printPdf(filePath) {
  return new Promise((resolve, reject) => {
    let cmd;

    switch (strategy) {
      case "sumatra":
        cmd = `SumatraPDF -print-to-default -silent "${filePath}"`;
        break;
      case "pdftoprinter":
        cmd = `"${PDF_TO_PRINTER_PATH}" "${filePath}"`;
        break;
      case "powershell":
        // Usa o verbo Print do Windows — abre e imprime via shell association
        cmd = `powershell -Command "Start-Process -FilePath '${filePath.replace(/'/g, "''")}' -Verb Print -WindowStyle Hidden"`;
        break;
      case "lp":
        cmd = `lp "${filePath}"`;
        break;
      case "lpr":
        cmd = `lpr "${filePath}"`;
        break;
      default:
        return reject(new Error("Nenhuma ferramenta de impressão encontrada"));
    }

    console.log(`[Print Agent] Imprimindo: ${cmd}`);
    exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
      // Limpa o arquivo temporário após um delay
      setTimeout(() => {
        try { fs.unlinkSync(filePath); } catch { /* ok */ }
      }, 10000);

      if (error) {
        console.error(`[Print Agent] Erro: ${error.message}`);
        return reject(error);
      }
      console.log(`[Print Agent] ✓ Enviado para impressora`);
      resolve({ ok: true, strategy, printer: defaultPrinter });
    });
  });
}

// ─── Servidor HTTP ───────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS — permite que o frontend em qualquer origem se comunique
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && req.url === "/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      strategy,
      printer: defaultPrinter,
      platform: process.platform,
    }));
    return;
  }

  // Impressão
  if (req.method === "POST" && req.url === "/print") {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", async () => {
      try {
        const buffer = Buffer.concat(chunks);
        if (buffer.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "PDF vazio" }));
          return;
        }

        // Salva PDF em arquivo temporário
        const filename = `etiqueta-${Date.now()}.pdf`;
        const filePath = path.join(TEMP_DIR, filename);
        fs.writeFileSync(filePath, buffer);
        console.log(`[Print Agent] PDF recebido: ${buffer.length} bytes → ${filePath}`);

        const result = await printPdf(filePath);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error(`[Print Agent] Falha:`, err.message);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: false,
          error: err.message,
          strategy,
        }));
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  🖨️  Print Agent rodando em http://localhost:${PORT}`);
  console.log(`  Impressora: ${defaultPrinter}`);
  console.log(`  Estratégia: ${strategy}`);
  console.log(`  Ctrl+C para parar`);
  console.log(`══════════════════════════════════════════════\n`);
});
