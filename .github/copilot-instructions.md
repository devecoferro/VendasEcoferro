# VendasEcoferro - Copilot Instructions

Before suggesting code or answering questions about this project, please read:
1. `docs/SYSTEM-MEMORY.md`
2. `docs/CHANGELOG.md`

This project uses React, TypeScript, Node.js, and SQLite.
Key architectural rule: We use a direct HTTP Fetcher for Mercado Livre data, NOT Playwright. See `docs/ml-http-fetcher-memory.md` for details.
Always handle `connection_id` for multi-seller support.
