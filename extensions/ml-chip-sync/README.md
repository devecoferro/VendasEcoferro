# ML Chip Sync - Extensão Chrome

Extensão Chrome que sincroniza automaticamente os chips do Mercado Livre Seller Center com o VendasEcoferro.

## Como funciona

1. A extensão roda em background no Chrome do usuário
2. A cada 5 minutos, faz uma requisição para o endpoint interno do ML (`operations-dashboard/tabs`)
3. Usa os cookies da sessão do browser (o usuário já está logado no ML)
4. Envia os números exatos dos chips para o servidor VendasEcoferro
5. O servidor usa esses números como fonte de verdade (TTL de 12 horas)

## Instalação

### Passo 1: Baixar a extensão

A pasta `extensions/ml-chip-sync` contém todos os arquivos necessários.

### Passo 2: Instalar no Chrome

1. Abra o Chrome e vá para `chrome://extensions/`
2. Ative o **Modo de desenvolvedor** (toggle no canto superior direito)
3. Clique em **Carregar sem compactação**
4. Selecione a pasta `extensions/ml-chip-sync`
5. A extensão aparecerá na barra de extensões com o ícone "ML"

### Passo 3: Configurar para duas contas

Como o VendasEcoferro opera com duas contas ML (Ecoferro e Fantom Motoparts), você precisa instalar a extensão em **dois perfis de Chrome** diferentes:

- **Perfil 1**: Logado na conta Ecoferro (`ecoferro02@gmail.com`)
- **Perfil 2**: Logado na conta Fantom Motoparts (`alinepk80@hotmail.com`)

Cada perfil terá sua própria instância da extensão, sincronizando a conta respectiva.

**Alternativa**: Se usar o mesmo perfil com duas janelas, a extensão sincronizará a conta que estiver logada no momento.

## Verificação

1. Clique no ícone da extensão na barra do Chrome
2. O popup mostra:
   - Status da última sincronização
   - Conta ML detectada
   - Números dos chips sincronizados
3. Badge verde (✓) = sincronizando normalmente
4. Badge vermelho (!) = erro (sessão expirada ou servidor indisponível)

## Solução de problemas

### Badge vermelho com "Sessão ML expirada"
- Faça login no Mercado Livre neste browser
- A próxima sincronização (em até 5 min) resolverá automaticamente

### Números não aparecem no VendasEcoferro
- Verifique se o servidor está online (vendas.ecoferro.com.br)
- Clique no botão "Sincronizar Agora" no popup da extensão
- Verifique o console do service worker em `chrome://extensions/` → Detalhes → "Inspecionar visualizações"

## Detalhes técnicos

- **Intervalo**: 5 minutos (configurável em `SYNC_INTERVAL_MINUTES`)
- **TTL no servidor**: 12 horas (se a extensão parar, os dados permanecem válidos por 12h)
- **Endpoint ML**: `/sales-omni/packs/marketshops/operations-dashboard/tabs`
- **Endpoint servidor**: `POST /api/ml/admin/sync-from-ml`
- **Autenticação**: credenciais admin no body do POST (CORS aberto)
- **Detecção de conta**: automática via HTML da página de vendas ou cookies

## Segurança

- As credenciais admin estão hardcoded na extensão (aceitável pois é instalação local)
- A extensão só se comunica com `mercadolivre.com.br` e `vendas.ecoferro.com.br`
- Nenhum dado é enviado para terceiros
- Os cookies do ML nunca saem do browser (a extensão usa `credentials: include` para fetch same-origin)
