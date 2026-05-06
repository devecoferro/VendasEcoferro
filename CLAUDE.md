# VendasEcoferro - Claude AI Instructions

Hello Claude! Before you start working on this project, you MUST read the following files to get the full context:

1. `docs/SYSTEM-MEMORY.md` (Architecture, history, and decisions)
2. `docs/CHANGELOG.md` (Current version)
3. `docs/sessions/` (Read the most recent file)

## Key Architectural Rules
- **No Playwright**: We use a direct HTTP Fetcher for Mercado Livre data. See `docs/ml-http-fetcher-memory.md`.
- **Multi-seller**: The system supports multiple accounts via `connection_id` (null/default for EcoFerro, "fantom" for Fantom).
- **Documentation**: After completing a task, create a session log in `docs/sessions/YYYY-MM-DD-description.md`.

## Stack
React, TypeScript, Vite, shadcn/ui, Node.js, Express, SQLite.
