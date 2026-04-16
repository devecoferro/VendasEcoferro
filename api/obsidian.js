/**
 * API Handler: /api/obsidian
 *
 * Integração com Obsidian — apenas notas permanentes que fazem sentido.
 *
 * Endpoints:
 *   GET  ?action=status                              → Verifica conexão
 *   GET  ?action=list&path=/EcoFerro                  → Lista notas
 *   GET  ?action=read&path=EcoFerro/Docs/CLAUDE.md    → Lê nota
 *   GET  ?action=search&q=palavra                     → Busca por texto
 *
 *   POST ?action=sync-docs                            → Exporta documentação técnica
 *   POST ?action=daily-report&date=2026-04-16         → Gera relatório diário (1x, não sobrescreve)
 *   POST ?action=log-problem  body: { title, description, severity, resolution }
 *                                                     → Registra problema/bug
 *
 *   POST ?action=create   body: { path, content }     → Cria nota livre
 *   POST ?action=append   body: { path, content }     → Anexa a nota
 *   DELETE ?action=delete&path=...                     → Deleta nota
 */

import {
  checkConnection,
  listNotes,
  readNote,
  createNote,
  appendToNote,
  prependToNote,
  deleteNote,
  searchNotes,
  openNote,
} from "./_lib/obsidian.js";
import {
  syncDocsToObsidian,
  generateDailyReport,
  logProblem,
} from "./_lib/obsidian-sync.js";

export default async function obsidianHandler(req, res) {
  try {
    const action = req.query.action || req.body?.action;

    if (!action) {
      return res.status(400).json({
        ok: false,
        error: "Ações: status, list, read, search, sync-docs, daily-report, log-problem, create, append, delete",
      });
    }

    switch (action) {
      // ─── Leitura ───────────────────────────────────────────────
      case "status": {
        const result = await checkConnection();
        return res.json({ ok: result.ok, ...result });
      }

      case "list": {
        const vaultPath = req.query.path || "/";
        const files = await listNotes(vaultPath);
        return res.json({ ok: true, path: vaultPath, files });
      }

      case "read": {
        const notePath = req.query.path;
        if (!notePath) {
          return res.status(400).json({ ok: false, error: "Parâmetro 'path' é obrigatório" });
        }
        const content = await readNote(notePath);
        return res.json({ ok: true, path: notePath, content });
      }

      case "search": {
        const query = req.query.q || req.body?.q;
        if (!query) {
          return res.status(400).json({ ok: false, error: "Parâmetro 'q' é obrigatório" });
        }
        const results = await searchNotes(query);
        return res.json({ ok: true, query, results });
      }

      // ─── Notas do Projeto ──────────────────────────────────────

      case "sync-docs": {
        const result = await syncDocsToObsidian();
        return res.json({ ok: true, action: "sync-docs", ...result });
      }

      case "daily-report": {
        const date = req.query.date || req.body?.date;
        const result = await generateDailyReport(date);
        return res.json({ ok: true, action: "daily-report", ...result });
      }

      case "log-problem": {
        const { title, description, severity, resolution, relatedOrderId } = req.body || {};
        if (!title || !description) {
          return res.status(400).json({
            ok: false,
            error: "Body precisa de 'title' e 'description'. Opcional: severity (baixa|media|alta|critica), resolution, relatedOrderId",
          });
        }
        const result = await logProblem({ title, description, severity, resolution, relatedOrderId });
        return res.json({ ok: true, action: "log-problem", ...result });
      }

      // ─── CRUD Genérico ─────────────────────────────────────────

      case "create": {
        const { path: createPath, content: createContent } = req.body || {};
        if (!createPath || createContent == null) {
          return res.status(400).json({ ok: false, error: "Body precisa de 'path' e 'content'" });
        }
        await createNote(createPath, createContent);
        return res.json({ ok: true, action: "created", path: createPath });
      }

      case "append": {
        const { path: appendPath, content: appendContent } = req.body || {};
        if (!appendPath || appendContent == null) {
          return res.status(400).json({ ok: false, error: "Body precisa de 'path' e 'content'" });
        }
        await appendToNote(appendPath, appendContent);
        return res.json({ ok: true, action: "appended", path: appendPath });
      }

      case "open": {
        const openPath = req.body?.path || req.query.path;
        if (!openPath) {
          return res.status(400).json({ ok: false, error: "Parâmetro 'path' é obrigatório" });
        }
        await openNote(openPath);
        return res.json({ ok: true, action: "opened", path: openPath });
      }

      case "delete": {
        const deletePath = req.query.path || req.body?.path;
        if (!deletePath) {
          return res.status(400).json({ ok: false, error: "Parâmetro 'path' é obrigatório" });
        }
        await deleteNote(deletePath);
        return res.json({ ok: true, action: "deleted", path: deletePath });
      }

      default:
        return res.status(400).json({
          ok: false,
          error: `Ação '${action}' não reconhecida. Use: status, list, read, search, sync-docs, daily-report, log-problem, create, append, delete`,
        });
    }
  } catch (error) {
    const status = error.message?.includes("404") ? 404 : 500;
    return res.status(status).json({
      ok: false,
      error: error.message || "Erro ao comunicar com Obsidian",
    });
  }
}
