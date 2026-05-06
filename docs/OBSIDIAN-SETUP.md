---
title: "Configuração do Obsidian Git"
date: 2026-05-06
tags:
  - ecoferro
  - obsidian
  - setup
---

# Configuração do Obsidian para Sincronizar com o Repositório

Este guia explica como conectar seu vault do Obsidian ao repositório GitHub do VendasEcoferro, permitindo que toda a documentação técnica e memória do sistema fiquem sincronizadas automaticamente.

## Pré-requisitos

Antes de iniciar, certifique-se de que você possui o Git instalado no seu computador e que o Obsidian está funcionando com o vault "EcoFerro" (que aparece na screenshot do seu Obsidian). Além disso, é necessário ter acesso ao repositório `devecoferro/VendasEcoferro` no GitHub.

## Opção 1: Obsidian Git Plugin (Recomendada)

Esta opção sincroniza apenas a pasta `docs/` do repositório diretamente dentro do seu vault existente.

### Passo 1 — Instalar o plugin Obsidian Git

Abra o Obsidian, vá em **Configurações → Plugins da comunidade → Buscar** e procure por "Obsidian Git". Instale e ative o plugin.

### Passo 2 — Clonar o repositório dentro do vault

Abra o PowerShell na pasta do seu vault Obsidian (provavelmente `C:\Users\SeuUsuario\Documents\Obsidian Vault\` ou similar) e execute:

```powershell
cd "C:\caminho\para\seu\vault\EcoFerro"
git init
git remote add origin https://github.com/devecoferro/VendasEcoferro.git
git fetch origin
git checkout origin/main -- docs/
```

Isso vai trazer apenas a pasta `docs/` para dentro do seu vault, sem sobrescrever nada que já exista.

### Passo 3 — Configurar auto-pull no plugin

Nas configurações do plugin Obsidian Git:

| Configuração | Valor recomendado |
|---|---|
| Auto pull interval (minutes) | 5 |
| Pull on startup | true |
| Auto push interval (minutes) | 0 (desativado) |
| Commit message | `obsidian: {{date}}` |

Com `Auto push` desativado, o Obsidian apenas **recebe** atualizações do GitHub (quando o Manus faz push de novas memórias), mas não envia nada de volta. Isso evita conflitos.

### Passo 4 — Verificar a sincronização

Após configurar, você deve ver a pasta `docs/` no seu vault com todos os arquivos de memória. O arquivo `000-Index.md` serve como ponto de entrada (Map of Content) com wikilinks para todos os outros documentos.

## Opção 2: Git Submodule (Avançada)

Se você já tem um vault Obsidian com Git configurado e quer manter o repositório VendasEcoferro como um submódulo:

```powershell
cd "C:\caminho\para\seu\vault\EcoFerro"
git submodule add https://github.com/devecoferro/VendasEcoferro.git VendasEcoferro
```

Neste caso, a pasta `VendasEcoferro/docs/` ficará disponível como uma subpasta do vault.

## Opção 3: Sparse Checkout (Apenas docs/)

Se preferir ter apenas a pasta `docs/` sem o código-fonte:

```powershell
mkdir EcoFerro-Docs
cd EcoFerro-Docs
git init
git remote add origin https://github.com/devecoferro/VendasEcoferro.git
git config core.sparseCheckout true
echo "docs/" > .git/info/sparse-checkout
git pull origin main
```

Depois basta apontar o vault do Obsidian para esta pasta.

## Estrutura dos Arquivos no Obsidian

Todos os arquivos de documentação seguem o formato compatível com Obsidian:

| Elemento | Formato |
|---|---|
| Frontmatter | YAML com `title`, `date`, `tags` |
| Links internos | Wikilinks `[[NomeDoArquivo]]` |
| Tags | `#ecoferro`, `#docs`, `#http-fetcher`, etc. |
| Índice | `000-Index.md` (Map of Content) |

## Fluxo de Atualização

Quando o Manus faz alterações na documentação do projeto (correções, novas features, troubleshooting), o fluxo é:

1. Manus edita os arquivos em `docs/` no repositório GitHub.
2. Manus faz commit e push para `main`.
3. O plugin Obsidian Git faz pull automático a cada 5 minutos.
4. Os arquivos atualizados aparecem no seu vault instantaneamente.

Isso significa que toda vez que uma sessão de trabalho resultar em aprendizados ou correções, a memória do Obsidian é atualizada automaticamente sem nenhuma ação manual da sua parte.

## Solução de Problemas

Se o pull automático falhar, verifique se o token de acesso ao GitHub está configurado. O plugin Obsidian Git usa as credenciais do Git global do sistema. Para configurar:

```powershell
git config --global credential.helper manager
```

Na primeira vez que fizer pull, o Windows pedirá login no GitHub. Após isso, as credenciais ficam salvas.

---
*Documento gerado pelo Manus AI Operator — 06 de Maio de 2026.*
