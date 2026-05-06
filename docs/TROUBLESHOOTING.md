---
title: "🛠️ Troubleshooting — Solução de Problemas"
date: 2026-05-06
tags:
  - ecoferro
  - docs
  - troubleshooting
---

# 🛠️ Troubleshooting — Solução de Problemas

Guia de problemas comuns e como resolver. Dividido por tipo: **operador** (quem usa) e **admin** (quem mantém).

---

## 👷 Problemas do operador

### ❌ "Não consigo logar"

**Sintomas**: senha rejeitada, tela de login sem avançar.

**Soluções**:
1. Confirme o **usuário** (sensível a maiúsculas/minúsculas)
2. Se é primeiro acesso, peça a **senha temporária** pro admin
3. Se esqueceu, só admin pode **resetar senha**
4. Depois de 10 tentativas erradas, o IP fica bloqueado por 1 min (rate limit)

---

### ⚠️ Aparece "Fallback local (ML offline)" no banner

**O que significa**: o scraper Playwright que pega os dados ao vivo do ML não está funcionando. Os números mostrados são do nosso backup local (podem estar desatualizados).

**Causas possíveis**:
- Sessão ML do admin expirou
- Chromium não instalado no container
- VPS sem RAM pra rodar Playwright
- ML mudou o HTML da página

**O que fazer**: avisa o admin. Enquanto isso, os números ainda funcionam — só podem divergir um pouco do que o ML mostra.

---

### 🔕 Botão "Etiqueta ML + DANFe" está cinza

**O que significa**: o ML ainda não gerou a etiqueta pra esse pedido.

**Causas comuns**:
1. Pagamento ainda não aprovado pelo ML (aguarda até 10 min)
2. Comprador não escolheu forma de envio
3. Pedido muito recente (aguarda processamento interno do ML)

**O que fazer**:
1. Clica **↻ Atualizar agora** no banner ML ao vivo
2. Aguarda 2-3 min e tenta de novo
3. Se persistir > 30 min, avisa o admin (pode ser problema na conta ML)

---

### 🐛 "Marquei impressa por engano"

1. Filtro → **Impressas**
2. Acha o pedido
3. Clica **Desmarcar** (no topo)
4. Volta pra "Sem etiqueta"

---

### 📄 PDF de separação/etiqueta não baixa

**Soluções**:
1. Verifica se tem **bloqueador de pop-up** ativo (desativa pra vendas.ecoferro.com.br)
2. Tenta outro navegador (Chrome → Edge, por ex)
3. Limpa cache do navegador (Ctrl+Shift+Del)
4. Se ainda não baixa, avisa o admin pra checar logs do servidor

---

### 🖼️ Imagens dos produtos aparecem como placeholder cinza no PDF

**Causa**: CORS — o navegador bloqueou o download da imagem do Mercado Livre.

**Solução**: atualiza a página (F5) e tenta gerar o PDF de novo. Se persistir, avisa o admin. O sistema tem **proxy backend** (`/api/ml/image-proxy`) que resolve isso — se tá falhando, pode ser timeout.

---

### 📊 Os números dos chips estão errados / não batem com ML

**Primeiro**: confere se o indicador **"🟢 ML ao vivo"** está verde com timestamp recente (menos de 5 min atrás).

**Se verde e os números divergem**:
- Abre o ML Seller Center em outra aba
- Clica **↻ Atualizar agora** no nosso sistema
- Aguarda 90s
- Compara os 4 chips

**Se ainda divergem**:
- Tire print dos 2 painéis (nosso + ML Seller Center)
- Envia em **Report Debug** pro admin investigar

---

## 🔧 Problemas do admin

### 🔑 "Scraper não configurado" no `/api/ml/live-snapshot`

**Mensagem**: `{"error": "no_state", "message": "Storage state não configurado"}`

**Causa**: o arquivo `ml-seller-center-state.json` não existe em `/app/data/playwright/`.

**Solução**:

1. **Localmente**, roda:
   ```bash
   npm run setup:ml-scraper
   ```
2. Abre o Chromium que aparece
3. Faz login no Mercado Livre Seller Center
4. Fecha a janela
5. Procura o arquivo em `data/playwright/ml-seller-center-state.json` do projeto local
6. **Upload** via browser em:
   ```
   https://vendas.ecoferro.com.br/api/ml/admin/upload-scraper-state
   ```

> ⚠️ **Segurança**: esse arquivo tem cookies/JWTs válidos da sua sessão ML. Não compartilhe em canais públicos (git, discord, whatsapp). Quando terminar de usar, pode deletar local.

---

### 🎭 Chromium não instalado / "Executable doesn't exist"

**Mensagem no log**: `Error: Chromium distribution 'chrome' is not found`

**Causa**: a primeira vez que o container sobe em um novo volume, o Chromium não está instalado (usamos volume persistente pra sobreviver a rebuilds, mas começa vazio).

**Solução**:

1. Acessa como admin:
   ```
   https://vendas.ecoferro.com.br/api/ml/admin/install-chromium
   ```
2. Clica **Instalar Chromium**
3. Aguarda ~2-5 min (download de ~200MB)
4. Aparece "✅ Chromium instalado" e "✅ Chromium Headless Shell instalado"
5. Agora o scraper funciona

---

### 💾 OOM / container reinicia durante scrape

**Sintoma**: 502 Bad Gateway ou logs mostrando "container restarted".

**Causa**: Chromium consome muita RAM. VPS pequena não suporta.

**Otimizações já aplicadas** (por padrão):
- `--single-process` (roda renderer + browser juntos)
- `--disable-gpu`
- Viewport 1280x720 (não 1920x1080)
- Route blocks pra imagens, fontes, vídeo

**Se ainda crasha**:
- Aumenta RAM da VPS pra pelo menos **1GB livre**
- Considera implementar scrape incremental (1 tab por vez)
- Ou configura `SCRAPE_DISABLED=true` e usa só API pública (fallback)

---

### 🔄 "Sessão ML expirada"

**Mensagem**: `{"error": "session_expired", "redirected_to": "https://.../login"}`

**Causa**: cookies do storage state expiraram (ML desloga sessões inativas depois de X dias).

**Solução**: refazer o setup (ver **"Scraper não configurado"** acima).

> 💡 **Dica**: marca no calendário pra renovar a sessão a cada 30 dias, antes de expirar.

---

### ⚠️ Coolify não faz deploy automático depois do push

**Sintoma**: push no main mas commit não aparece em produção.

**Soluções em ordem**:
1. Espera 5 min (às vezes demora)
2. Verifica se **Coolify webhook** está ativo (Settings → Webhooks)
3. **Redeploy manual**: Coolify → aplicação → botão **Redeploy** (laranja, canto direito)
4. Se falhou: ver logs do build (Coolify → Deployments → clica no deploy falho)

---

### 🔐 Usuário admin esquecido / travado

**Acesso default**: variáveis de ambiente
```bash
APP_DEFAULT_ADMIN_USERNAME=admin.ecoferro
APP_DEFAULT_ADMIN_PASSWORD=<seed_inicial>
```

Se perder TODOS os admins:
1. SSH no servidor
2. `rm /app/data/ecoferro.db` (CUIDADO — apaga TUDO do DB)
3. Reinicia container
4. Admin default é recriado pelas env vars

> ⚠️ Isso apaga **todos os pedidos, leads, customers, labels printed**, etc. Use só como último recurso. Melhor restaurar backup.

---

### 📦 Restaurar backup do DB

Backups automáticos ficam em `/app/data/backups/`.

```bash
# SSH no servidor
cd /app/data
ls -la backups/

# Restaura o mais recente
cp backups/ecoferro_2026-04-19.db ecoferro.db

# Reinicia container
```

---

## 🔬 Problemas técnicos (dev)

### TypeScript build falha

```bash
npm run build
```

Procure no output:
- **`error TS2345`**: type mismatch. Confere os types esperados.
- **`Module not found`**: import de arquivo que não existe. Confere path.
- **`Cannot find name`**: variável/import esquecido. Adiciona.

---

### SQLite "database locked"

**Causa**: 2 processos tentando escrever no DB ao mesmo tempo.

**Solução**: no nosso setup, só 1 container roda. Se aparecer, pode ser:
- Backup rolando enquanto cron de sync escreve
- Duas réplicas do container (NÃO deveria acontecer)

Verifica `docker ps` e mata duplicatas.

---

### Endpoint `/api/ml/admin/live-cards-debug` retorna 200 mas sem dados

**Significa**: scraper rodou mas não capturou XHRs. Possíveis causas:
1. **Sessão ML expirada** — ver "Sessão ML expirada" acima
2. **ML mudou estrutura do HTML** — abrir `?format=html&run=1&wait=20000` e ver o DOM debug
3. **Timeout** — scraper demorou demais, Playwright abortou antes de capturar

Logs do Coolify mostram mensagens `[live-snapshot]` com timestamps de cada passo.

---

## 📞 Contato / Escalação

- **Operador → Supervisor local**: erros de fluxo (pegou produto errado, impressora quebrada)
- **Supervisor → Admin**: problemas sistêmicos (muitos operadores com mesmo erro)
- **Admin → Dev**: bugs no sistema, scraper quebrado, novos requisitos

Use o **🐛 Report Debug** pra registrar tudo formalmente — fica histórico auditável.

---

_Última atualização: 2026-04-20 (V 3.0)_
