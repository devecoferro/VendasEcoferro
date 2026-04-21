# 📚 Documentação — EcoFerro Vendas · Etiquetas

> Versão atual: **V 3.0** · Release: **2026-04-20**

Documentação completa do sistema de gestão de vendas e etiquetas da Ecoferro integrado ao Mercado Livre.

## 📂 Índice

### 🏛️ Fundamentos

| Arquivo | Conteúdo |
|---------|----------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Arquitetura técnica: stack, estrutura de diretórios, fluxo de dados |
| [API-ENDPOINTS.md](./API-ENDPOINTS.md) | Catálogo completo de endpoints HTTP (`/api/*`) |
| [DEVELOPMENT-HISTORY.md](./DEVELOPMENT-HISTORY.md) | Histórico narrativo de toda evolução do projeto |
| [CHANGELOG.md](./CHANGELOG.md) | Changelog estruturado por versão/data |

### 🔬 Deep dives técnicos

| Arquivo | Conteúdo |
|---------|----------|
| [ML-LIVE-SNAPSHOT.md](./ML-LIVE-SNAPSHOT.md) | Scraper Playwright + engenharia reversa do ML Seller Center |

### 📖 Guias

| Arquivo | Conteúdo |
|---------|----------|
| [OPERATOR-GUIDE.md](./OPERATOR-GUIDE.md) | Guia passo-a-passo do operador (fluxo do dia) |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Problemas comuns e soluções |

### 📊 Métricas

| Arquivo | Conteúdo |
|---------|----------|
| [PROJECT-METRICS.md](./PROJECT-METRICS.md) | Estatísticas: commits, dias ativos, linhas de código |

### 🔒 Histórico (arquivos legados)

| Arquivo | Conteúdo |
|---------|----------|
| [AUDIT.md](./AUDIT.md) | Auditoria de segurança (13+ fixes CRITICAL/HIGH aplicados) |
| [operations-backup.md](./operations-backup.md) | Procedimento de backup do DB SQLite |

---

## 🎯 Para onde ir primeiro

- **Sou operador novo**: leia [OPERATOR-GUIDE.md](./OPERATOR-GUIDE.md)
- **Sou dev querendo entender o projeto**: leia [ARCHITECTURE.md](./ARCHITECTURE.md) + [ML-LIVE-SNAPSHOT.md](./ML-LIVE-SNAPSHOT.md)
- **Algo está quebrado**: leia [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)
- **Quero ver o que mudou**: leia [CHANGELOG.md](./CHANGELOG.md)

---

## 📝 Como editar esta documentação

Todos os arquivos são Markdown. Editar pelo GitHub, VS Code ou qualquer editor de texto. Após commit, os arquivos ficam em `/docs/` do repositório.

Para **importar no Obsidian**: copie a pasta `/docs/` pra dentro de um vault Obsidian. Os links relativos `[...](./FILE.md)` funcionam direto.

---

_Última atualização: 2026-04-20_
